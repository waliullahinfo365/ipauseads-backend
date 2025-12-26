// src/models/EventReceipt.js
const mongoose = require('mongoose');

const EventReceiptSchema = new mongoose.Schema({
  // Event Identification
  eventId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  eventType: {
    type: String,
    enum: ['pause_impression', 'qr_conversion'],
    required: true,
    index: true
  },
  eventVersion: {
    type: String,
    default: '1.0'
  },
  eventTimeUtc: {
    type: Date,
    required: true,
    index: true
  },

  // Linking
  ipauseOpportunityId: {
    type: String,
    required: true,
    index: true
  },

  // Publisher Info
  publisherId: {
    type: String,
    required: true,
    index: true
  },
  publisherName: String,
  appId: String,
  supplyType: String,

  // Session Info
  sessionId: String,
  contentSessionId: String,

  // Content Info (for pause_impression)
  contentId: String,
  contentTitle: String,
  series: String,
  season: String,
  episode: String,
  genre: [String],
  rating: String,

  // Playback Info (for pause_impression)
  pauseTimestampMs: Number,
  isLive: {
    type: Boolean,
    default: false
  },

  // Ad Info (for pause_impression)
  ipauseAdId: String,
  campaignId: {
    type: String,
    index: true
  },
  brand: String,
  creativeId: String,
  qrEnabled: {
    type: Boolean,
    default: false
  },

  // Device & Geo (for pause_impression)
  deviceType: String,
  os: String,
  country: String,
  region: String,

  // Conversion Info (for qr_conversion)
  conversionType: String,
  conversionResult: String,
  qrDestinationId: String,

  // QR Timing (for ASV calculation)
  qrAppearedAt: {
    type: Date,
    index: true
  },
  qrScannedAt: Date,
  asvSeconds: Number,
  asvTier: {
    type: Number,
    min: 0,
    max: 5
  },
  asvLabel: {
    type: String,
    enum: ['N/A', 'Low', 'Fair', 'Average', 'Strong', 'Exceptional']
  },

  // Audit & Processing
  rawPayload: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  idempotencyKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  processedAt: {
    type: Date,
    default: Date.now
  },
  matchedConversionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EventReceipt'
  },
  matchedPauseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EventReceipt'
  },
  billingStatus: {
    type: String,
    enum: ['pending', 'billable', 'billed', 'non_billable'],
    default: 'pending',
    index: true
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
EventReceiptSchema.index({ eventType: 1, eventTimeUtc: -1 });
EventReceiptSchema.index({ publisherId: 1, eventTimeUtc: -1 });
EventReceiptSchema.index({ ipauseOpportunityId: 1, eventType: 1 });
EventReceiptSchema.index({ campaignId: 1, billingStatus: 1 });

/**
 * Find matching pause impression for a conversion
 */
EventReceiptSchema.statics.findMatchingPause = async function(ipauseOpportunityId) {
  return this.findOne({
    ipauseOpportunityId,
    eventType: 'pause_impression'
  }).sort({ processedAt: -1 });
};

/**
 * Get event statistics for a publisher
 */
EventReceiptSchema.statics.getPublisherStats = async function(publisherId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return this.aggregate([
    {
      $match: {
        publisherId,
        eventTimeUtc: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: '$eventType',
        count: { $sum: 1 }
      }
    }
  ]);
};

/**
 * Get billable events for a date range
 */
EventReceiptSchema.statics.getBillableEvents = async function(startDate, endDate) {
  return this.find({
    eventType: 'pause_impression',
    billingStatus: 'billable',
    eventTimeUtc: { $gte: startDate, $lte: endDate }
  }).populate('matchedConversionId');
};

module.exports = mongoose.model('EventReceipt', EventReceiptSchema);
