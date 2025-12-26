// src/models/A2ARMetric.js
const mongoose = require('mongoose');

const A2ARMetricSchema = new mongoose.Schema({
  // Date for daily aggregation
  date: {
    type: Date,
    required: true,
    index: true
  },

  // Advertiser reference
  advertiser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Grouping dimensions
  publisher: {
    type: String,
    index: true
  },
  programTitle: {
    type: String,
    index: true
  },

  // Metrics
  pauseOpportunities: {
    type: Number,
    default: 0
  },
  qrScans: {
    type: Number,
    default: 0
  },
  verifiedConversions: {
    type: Number,
    default: 0
  },

  // Calculated A2AR
  a2arPercentage: {
    type: Number,
    default: 0
  },
  a2arTier: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  tier: {
    type: String,
    enum: ['N/A', 'Low', 'Fair', 'Average', 'Strong', 'Exceptional'],
    default: 'Low'
  },

  // ASV (Attention Scan Velocity)
  averageAsvSeconds: {
    type: Number,
    default: null
  },
  asvTier: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  asvLabel: {
    type: String,
    enum: ['N/A', 'Low', 'Fair', 'Average', 'Strong', 'Exceptional'],
    default: 'N/A'
  },

  // ACI (Attention Composite Index)
  aciRaw: {
    type: Number,
    default: 0
  },
  aciScaled: {
    type: Number,
    default: 0
  },
  aciLevel: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  aciLabel: {
    type: String,
    enum: ['N/A', 'Low', 'Fair', 'Average', 'Strong', 'Exceptional'],
    default: 'N/A'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Unique compound index for daily metrics
A2ARMetricSchema.index(
  { date: 1, advertiser: 1, publisher: 1, programTitle: 1 },
  { unique: true }
);

/**
 * Calculate A2AR tier based on percentage (UPDATED RANGES)
 */
A2ARMetricSchema.statics.getA2ARTier = function(a2ar) {
  // Handle edge cases by snapping to nearest tier
  if (a2ar < 0.2) return { tier: 1, label: 'Low' };
  if (a2ar <= 0.4) return { tier: 1, label: 'Low' };          // 0.2-0.4
  if (a2ar < 0.5) return { tier: 1, label: 'Low' };           // Gap: 0.41-0.49
  if (a2ar <= 0.7) return { tier: 2, label: 'Fair' };         // 0.5-0.7
  if (a2ar < 0.8) return { tier: 2, label: 'Fair' };          // Gap: 0.71-0.79
  if (a2ar <= 1.5) return { tier: 3, label: 'Average' };      // 0.8-1.5
  if (a2ar < 1.6) return { tier: 3, label: 'Average' };       // Gap: 1.51-1.59
  if (a2ar <= 2.5) return { tier: 4, label: 'Strong' };       // 1.6-2.5
  if (a2ar < 2.6) return { tier: 4, label: 'Strong' };        // Gap: 2.51-2.59
  return { tier: 5, label: 'Exceptional' };                   // 2.6%+
};

/**
 * Calculate ASV (Attention Scan Velocity)
 */
A2ARMetricSchema.statics.calculateASV = function(qrAppearedAt, qrScannedAt) {
  if (!qrAppearedAt || !qrScannedAt) {
    return {
      asvSeconds: null,
      asvTier: 0,
      asvLabel: 'N/A'
    };
  }

  const appeared = new Date(qrAppearedAt).getTime();
  const scanned = new Date(qrScannedAt).getTime();
  const asvSeconds = (scanned - appeared) / 1000;
  const asvDisplay = Math.round(asvSeconds * 100) / 100;

  // Assign tier (INVERTED: lower seconds = better tier)
  let tier = 0;
  let label = 'N/A';

  if (asvSeconds > 40) {
    tier = 1;
    label = 'Low';
  } else if (asvSeconds > 20) {
    tier = 2;
    label = 'Fair';
  } else if (asvSeconds > 10) {
    tier = 3;
    label = 'Average';
  } else if (asvSeconds > 5) {
    tier = 4;
    label = 'Strong';
  } else if (asvSeconds >= 0) {
    tier = 5;
    label = 'Exceptional';
  }

  return {
    asvSeconds: asvDisplay,
    asvTier: tier,
    asvLabel: label
  };
};

/**
 * Calculate ACI (Attention Composite Index)
 */
A2ARMetricSchema.statics.calculateACI = function(a2arTier, asvTier) {
  if (!a2arTier || !asvTier || a2arTier === 0 || asvTier === 0) {
    return {
      aciRaw: 0,
      aciScaled: 0,
      aciLevel: 0,
      aciLabel: 'N/A'
    };
  }

  // Step 1: Calculate raw ACI
  const rawACI = (a2arTier + asvTier) / 2;

  // Step 2: Scale ACI to match level ranges (multiply by 2)
  const scaledACI = rawACI * 2;
  const scaledDisplay = Math.round(scaledACI * 100) / 100;

  // Step 3: Assign level based on scaled ACI
  let level = 0;
  let label = 'N/A';

  if (scaledACI >= 9) {
    level = 5;
    label = 'Exceptional';
  } else if (scaledACI >= 8) {
    level = 4;
    label = 'Strong';
  } else if (scaledACI >= 6) {
    level = 3;
    label = 'Average';
  } else if (scaledACI >= 4) {
    level = 2;
    label = 'Fair';
  } else if (scaledACI >= 2) {
    level = 1;
    label = 'Low';
  }

  return {
    aciRaw: Math.round(rawACI * 100) / 100,
    aciScaled: scaledDisplay,
    aciLevel: level,
    aciLabel: label
  };
};

/**
 * Update or create A2AR metrics with ASV and ACI
 */
A2ARMetricSchema.statics.updateMetrics = async function({
  date,
  advertiser,
  publisher,
  programTitle,
  pauseOpportunity = false,
  scan = false,
  conversion = false,
  asvSeconds = null
}) {
  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  const filter = {
    date: dateOnly,
    advertiser,
    publisher: publisher || 'Unknown',
    programTitle: programTitle || 'Unknown'
  };

  const update = {
    $inc: {}
  };

  if (pauseOpportunity) update.$inc.pauseOpportunities = 1;
  if (scan) update.$inc.qrScans = 1;
  if (conversion) update.$inc.verifiedConversions = 1;

  // Only update if there's something to increment
  if (Object.keys(update.$inc).length === 0) return null;

  const metric = await this.findOneAndUpdate(
    filter,
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Recalculate A2AR percentage and tier
  const pauseOps = metric.pauseOpportunities || 1;
  const conversions = metric.verifiedConversions || 0;
  const a2ar = (conversions / pauseOps) * 100;
  const a2arResult = this.getA2ARTier(a2ar);

  metric.a2arPercentage = parseFloat(a2ar.toFixed(2));
  metric.a2arTier = a2arResult.tier;
  metric.tier = a2arResult.label;

  // Update ASV if provided
  if (asvSeconds !== null) {
    // Calculate running average ASV
    const currentAvg = metric.averageAsvSeconds || 0;
    const currentCount = metric.verifiedConversions || 1;
    const newAvg = currentCount === 1 
      ? asvSeconds 
      : ((currentAvg * (currentCount - 1)) + asvSeconds) / currentCount;
    
    metric.averageAsvSeconds = Math.round(newAvg * 100) / 100;
    
    // Calculate ASV tier from average
    const asvResult = this.calculateASV(
      new Date(Date.now() - metric.averageAsvSeconds * 1000),
      new Date()
    );
    metric.asvTier = asvResult.asvTier;
    metric.asvLabel = asvResult.asvLabel;
  }

  // Calculate ACI if both tiers are available
  if (metric.a2arTier > 0 && metric.asvTier > 0) {
    const aciResult = this.calculateACI(metric.a2arTier, metric.asvTier);
    metric.aciRaw = aciResult.aciRaw;
    metric.aciScaled = aciResult.aciScaled;
    metric.aciLevel = aciResult.aciLevel;
    metric.aciLabel = aciResult.aciLabel;
  }

  await metric.save();
  return metric;
};

/**
 * Get comprehensive attention metrics summary (A2AR, ASV, ACI)
 */
A2ARMetricSchema.statics.getSummary = async function(advertiserId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const result = await this.aggregate([
    {
      $match: {
        advertiser: new mongoose.Types.ObjectId(advertiserId),
        date: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: null,
        pauseOpportunities: { $sum: '$pauseOpportunities' },
        qrScans: { $sum: '$qrScans' },
        verifiedConversions: { $sum: '$verifiedConversions' },
        avgAsvSeconds: { $avg: '$averageAsvSeconds' },
        avgAciScaled: { $avg: '$aciScaled' }
      }
    }
  ]);

  if (result.length === 0) {
    return {
      a2ar: {
        pauseOpportunities: 0,
        qrDownloads: 0,
        percentage: 0,
        tier: 1,
        label: 'Low'
      },
      asv: {
        averageSeconds: 0,
        tier: 0,
        label: 'N/A'
      },
      aci: {
        score: 0,
        level: 0,
        label: 'N/A'
      }
    };
  }

  const data = result[0];
  const pauseOps = data.pauseOpportunities || 1;
  const conversions = data.verifiedConversions || 0;
  const a2ar = (conversions / pauseOps) * 100;
  const a2arResult = this.getA2ARTier(a2ar);

  // Calculate ASV tier from average
  const avgAsv = data.avgAsvSeconds || 0;
  const asvResult = avgAsv > 0 ? this.calculateASV(
    new Date(Date.now() - avgAsv * 1000),
    new Date()
  ) : { asvTier: 0, asvLabel: 'N/A' };

  // Calculate ACI
  const aciResult = this.calculateACI(a2arResult.tier, asvResult.asvTier);

  return {
    a2ar: {
      pauseOpportunities: data.pauseOpportunities || 0,
      qrDownloads: data.verifiedConversions || 0,
      percentage: parseFloat(a2ar.toFixed(2)),
      tier: a2arResult.tier,
      label: a2arResult.label
    },
    asv: {
      averageSeconds: parseFloat((avgAsv || 0).toFixed(2)),
      tier: asvResult.asvTier,
      label: asvResult.asvLabel
    },
    aci: {
      score: parseFloat((data.avgAciScaled || aciResult.aciScaled || 0).toFixed(2)),
      level: aciResult.aciLevel,
      label: aciResult.aciLabel
    }
  };
};

/**
 * Get attention metrics breakdown by program (A2AR, ASV, ACI)
 */
A2ARMetricSchema.statics.getByProgram = async function(advertiserId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const results = await this.aggregate([
    {
      $match: {
        advertiser: new mongoose.Types.ObjectId(advertiserId),
        date: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: { programTitle: '$programTitle', publisher: '$publisher' },
        pauseOpportunities: { $sum: '$pauseOpportunities' },
        verifiedConversions: { $sum: '$verifiedConversions' },
        avgA2AR: { $avg: '$a2arPercentage' },
        avgA2ARTier: { $avg: '$a2arTier' },
        avgAsvSeconds: { $avg: '$averageAsvSeconds' },
        avgAsvTier: { $avg: '$asvTier' },
        avgAciScaled: { $avg: '$aciScaled' },
        avgAciLevel: { $avg: '$aciLevel' }
      }
    },
    {
      $project: {
        _id: 0,
        programTitle: '$_id.programTitle',
        publisher: '$_id.publisher',
        pauseOpportunities: 1,
        verifiedConversions: 1,
        a2arPercentage: { $round: ['$avgA2AR', 2] },
        a2arTier: { $round: ['$avgA2ARTier', 0] },
        avgAsvSeconds: { $round: ['$avgAsvSeconds', 2] },
        asvTier: { $round: ['$avgAsvTier', 0] },
        aciScore: { $round: ['$avgAciScaled', 2] },
        aciLevel: { $round: ['$avgAciLevel', 0] }
      }
    },
    { $sort: { aciScore: -1 } }
  ]);

  // Add labels to each result
  return results.map(r => {
    const a2arResult = this.getA2ARTier(r.a2arPercentage || 0);
    const asvResult = r.avgAsvSeconds ? this.calculateASV(
      new Date(Date.now() - r.avgAsvSeconds * 1000),
      new Date()
    ) : { asvLabel: 'N/A' };
    const aciResult = this.calculateACI(r.a2arTier || 0, r.asvTier || 0);

    return {
      ...r,
      a2arLabel: a2arResult.label,
      asvLabel: asvResult.asvLabel,
      aciLabel: aciResult.aciLabel
    };
  });
};

module.exports = mongoose.model('A2ARMetric', A2ARMetricSchema);
