// src/routes/billing.js
const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const QrCode = require('../models/QrCode');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const BillingRecord = require('../models/BillingRecord');
const Scan = require('../models/Scan');
const PauseEvent = require('../models/PauseEvent');
const A2ARMetric = require('../models/A2ARMetric');

const router = express.Router();

// Helper to get or create wallet for a user
async function getOrCreateWallet(userId, session, userContext = {}) {
  // Only attach a session if one is provided (Mongoose does not accept null sessions)
  let query = Wallet.findOne({ user: userId });
  if (session) {
    query = query.session(session);
  }

  let wallet = await query;

  if (!wallet) {
    wallet = new Wallet({
      user: userId,
      balance: 0,
      brand: userContext.brand || userContext.fullName || '',
      dailyCap: 1000.0,
      costPerConversion: 5.0
    });
    if (session) {
      await wallet.save({ session });
    } else {
      await wallet.save();
    }
  }

  return wallet;
}

// GET /api/wallet - get current user's wallet
router.get('/wallet', auth, async (req, res) => {
  try {
    const wallet = await getOrCreateWallet(req.user.id, null, {
      fullName: req.user.fullName,
      brand: req.user.brand
    });
    res.json({ wallet });
  } catch (error) {
    console.error('Wallet fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

// GET /api/scans/spotlight - Aggregated data by program
router.get('/scans/spotlight', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { from, to, deviceType, ip, qrId, conversionStatus } = req.query;

    const match = {
      advertiser: new mongoose.Types.ObjectId(userId)
    };

    // Apply conversion status filter
    // - Converted       => only conversion=true & verified=true
    // - Not Converted   => conversion=false
    // - All (default)   => no explicit conversion filter (show all scans)
    if (conversionStatus === 'Converted') {
      match.conversion = true;
      match.verified = true;
    } else if (conversionStatus === 'Not Converted') {
      match.conversion = false;
    }

    if (from) {
      match.timestamp = match.timestamp || {};
      match.timestamp.$gte = new Date(from);
    }
    if (to) {
      match.timestamp = match.timestamp || {};
      match.timestamp.$lte = new Date(to);
    }
    if (deviceType && deviceType !== 'All') {
      match.device = new RegExp(deviceType, 'i');
    }
    if (ip) {
      match.ip = ip;
    }
    if (qrId) {
      match.qrId = qrId;
    }

    const programs = await Scan.aggregate([
      {
        $match: match
      },
      {
        $group: {
          _id: {
            program: '$program',
            publisher: '$publisher',
            qrId: '$qrId',
            creativeId: '$creativeId'
          },
          // Count only rows where conversion === true as "verified_conversions"
          verified_conversions: {
            $sum: {
              $cond: [{ $eq: ['$conversion', true] }, 1, 0]
            }
          },
          last_scan_time: { $max: '$timestamp' },
          thumbnailUrl: { $first: '$thumbnailUrl' }
        }
      },
      {
        $sort: { last_scan_time: -1 }
      },
      {
        $project: {
          _id: 0,
          series_title: '$_id.program',
          publisher: '$_id.publisher',
          qr_id: '$_id.qrId',
          creative_id: '$_id.creativeId',
          verified_conversions: 1,
          last_scan_time: 1,
          thumbnail_url: '$thumbnailUrl'
        }
      }
    ]);

    res.json({ programs });
  } catch (error) {
    console.error('Error fetching spotlight data:', error);
    res.status(500).json({ error: 'Failed to fetch spotlight data' });
  }
});

// =====================================================
// CLIENT-SPECIFIED ATTENTION METRICS CALCULATION FUNCTIONS
// =====================================================

/**
 * Calculate A2AR (Attention-to-Action Rate) with CLIENT-SPECIFIED formula and tier ranges
 * FORMULA: A2AR_percent = (qr_downloads / pause_opportunities) * 100
 * 
 * TIER RANGES:
 * - Tier 1 (Low): 0.2% – 0.4%
 * - Tier 2 (Fair): 0.5% – 0.7%
 * - Tier 3 (Average): 0.8% – 1.5%
 * - Tier 4 (Strong): 1.6% – 2.5%
 * - Tier 5 (Exceptional): 2.6% – 3.0%+
 * 
 * GAP HANDLING: Values in gaps snap to nearest tier
 */
function calcA2AR(pause_opportunities, qr_downloads) {
  if (!pause_opportunities || pause_opportunities <= 0) {
    return { 
      a2ar_percent: 0, 
      a2ar_percent_display: 0, 
      tier: 0, 
      label: 'N/A' 
    };
  }

  const a2ar = (qr_downloads / pause_opportunities) * 100;
  const a2ar_display = Math.round(a2ar * 100) / 100; // 2 decimals

  let tier = 0, label = 'N/A';

  if (a2ar < 0.2)               { tier = 1; label = 'Low'; }
  else if (a2ar <= 0.4)         { tier = 1; label = 'Low'; }
  else if (a2ar < 0.5)          { tier = 1; label = 'Low'; }      // gap snap
  else if (a2ar <= 0.7)         { tier = 2; label = 'Fair'; }
  else if (a2ar < 0.8)          { tier = 2; label = 'Fair'; }     // gap snap
  else if (a2ar <= 1.5)         { tier = 3; label = 'Average'; }
  else if (a2ar < 1.6)          { tier = 3; label = 'Average'; }  // gap snap
  else if (a2ar <= 2.5)         { tier = 4; label = 'Strong'; }
  else if (a2ar < 2.6)          { tier = 4; label = 'Strong'; }   // gap snap
  else                          { tier = 5; label = 'Exceptional'; }

  return { 
    a2ar_percent: a2ar, 
    a2ar_percent_display: a2ar_display, 
    tier, 
    label 
  };
}

/**
 * Calculate ASV (Attention Scan Velocity) with CLIENT-SPECIFIED formula and tier ranges
 * FORMULA: ASV_seconds = scan_timestamp - qr_code_appeared_timestamp
 * 
 * TIER RANGES (INVERTED - Lower is Better):
 * - Tier 1 (Low): > 40 seconds
 * - Tier 2 (Fair): 20 – 40 seconds
 * - Tier 3 (Average): 10 – 20 seconds
 * - Tier 4 (Strong): 5 – 10 seconds
 * - Tier 5 (Exceptional): < 5 seconds
 */
function calcASV(qrAppearTime, scanTime) {
  if (!qrAppearTime || !scanTime) {
    return { 
      asv_seconds: 0, 
      asv_seconds_display: 0, 
      tier: 0, 
      label: 'N/A' 
    };
  }

  const appear = new Date(qrAppearTime).getTime();
  const scan = new Date(scanTime).getTime();
  
  const asv = (scan - appear) / 1000;
  const asv_display = Math.round(asv * 100) / 100; // 2 decimals

  let tier = 0, label = 'N/A';

  if (asv <= 0) {
    tier = 0; label = 'N/A';
  } else if (asv > 40) {
    tier = 1; label = 'Low';
  } else if (asv > 20) {
    tier = 2; label = 'Fair';
  } else if (asv > 10) {
    tier = 3; label = 'Average';
  } else if (asv > 5) {
    tier = 4; label = 'Strong';
  } else {
    tier = 5; label = 'Exceptional';
  }

  return { 
    asv_seconds: asv, 
    asv_seconds_display: asv_display, 
    tier, 
    label 
  };
}

/**
 * Calculate ACI (Attention Composite Index) with CLIENT-SPECIFIED formula and level ranges
 * FORMULA:
 * Step 1: raw_ACI = (A2AR_Tier + ASV_Tier) / 2
 * Step 2: scaled_ACI = raw_ACI * 2
 * Step 3: Assign level based on scaled_ACI
 * 
 * LEVEL RANGES:
 * - Level 1 (Low): 2–3
 * - Level 2 (Fair): 4–5
 * - Level 3 (Average): 6–7
 * - Level 4 (Strong): 8–9
 * - Level 5 (Exceptional): 9–10
 */
function calcACI(A2AR_Tier, ASV_Tier) {
  if (!A2AR_Tier || !ASV_Tier || A2AR_Tier === 0 || ASV_Tier === 0) {
    return { 
      raw_ACI: 0, 
      scaled_ACI: 0, 
      level: 0, 
      label: 'N/A' 
    };
  }

  const raw_ACI = (A2AR_Tier + ASV_Tier) / 2;
  const scaled_ACI = raw_ACI * 2;
  const scaled_ACI_display = Math.round(scaled_ACI * 100) / 100; // 2 decimals

  let level = 0, label = 'N/A';

  if (scaled_ACI >= 9 && scaled_ACI <= 10)      { level = 5; label = 'Exceptional'; }
  else if (scaled_ACI >= 8 && scaled_ACI < 9)   { level = 4; label = 'Strong'; }
  else if (scaled_ACI >= 6 && scaled_ACI < 8)   { level = 3; label = 'Average'; }
  else if (scaled_ACI >= 4 && scaled_ACI < 6)   { level = 2; label = 'Fair'; }
  else if (scaled_ACI >= 2 && scaled_ACI < 4)   { level = 1; label = 'Low'; }

  return { 
    raw_ACI: Math.round(raw_ACI * 100) / 100, 
    scaled_ACI: scaled_ACI_display, 
    level, 
    label 
  };
}

// GET /api/scans/metrics-by-ip/:ip - Get attention metrics for a specific IP address
router.get('/scans/metrics-by-ip/:ip', auth, async (req, res) => {
  try {
    const { ip } = req.params;
    const userId = req.user.id;

    // Get all scans for this IP belonging to this advertiser
    const scans = await Scan.find({
      advertiser: userId,
      ip: ip
    }).sort({ timestamp: -1 }).lean();

    if (scans.length === 0) {
      return res.json({
        ip,
        totalScans: 0,
        conversions: 0,
        metrics: {
          a2ar: { 
            percentage: 0,
            percentageDisplay: 0,
            tier: 0, 
            label: 'N/A',
            pauseOpportunities: 0,
            qrDownloads: 0
          },
          asv: { 
            averageSeconds: 0,
            averageSecondsDisplay: 0,
            tier: 0, 
            label: 'N/A' 
          },
          aci: { 
            rawScore: 0,
            scaledScore: 0,
            level: 0, 
            label: 'N/A' 
          }
        },
        singleScan: false,
        scans: []
      });
    }

    // Calculate metrics for this IP using CLIENT-SPECIFIED formulas
    const totalScans = scans.length; // pause_opportunities
    const qrDownloads = scans.filter(s => s.conversion === true).length; // verified conversions
    
    // A2AR: Using client formula
    const a2arResult = calcA2AR(totalScans, qrDownloads);

    // ASV: Calculate average time between QR appearance and scan
    let asvResult = { asv_seconds: 0, asv_seconds_display: 0, tier: 0, label: 'N/A' };
    
    // Get scans with conversion timing data
    const scansWithTiming = scans.filter(s => s.conversion && s.convertedAt);
    
    if (scansWithTiming.length > 0) {
      // Calculate individual ASV for each scan
      const asvValues = scansWithTiming.map(s => {
        const scanTime = new Date(s.timestamp).getTime();
        const convTime = new Date(s.convertedAt).getTime();
        return (convTime - scanTime) / 1000; // seconds
      }).filter(t => t > 0 && t < 3600); // Filter reasonable times (< 1 hour)

      if (asvValues.length > 0) {
        // Calculate average ASV
        const avgAsv = asvValues.reduce((a, b) => a + b, 0) / asvValues.length;
        
        // Use calcASV to get tier (pass dummy dates that produce the average)
        const now = Date.now();
        asvResult = calcASV(new Date(now - avgAsv * 1000), new Date(now));
      }
    }

    // ACI: Using client formula (composite of A2AR tier and ASV tier)
    const aciResult = calcACI(a2arResult.tier, asvResult.tier);

    // Format scans for response
    const formattedScans = scans.map(s => ({
      id: s._id,
      timestamp: s.timestamp,
      qr_id: s.qrId,
      ip_address: s.ip,
      device: s.device,
      conversion: s.conversion,
      conversionAction: s.conversionAction,
      convertedAt: s.convertedAt,
      program: s.program,
      publisher: s.publisher
    }));

    // Return full metrics data with percentages, seconds, and raw values
    res.json({
      ip,
      totalScans,
      conversions: qrDownloads,
      metrics: {
        a2ar: {
          percentage: a2arResult.a2ar_percent,
          percentageDisplay: a2arResult.a2ar_percent_display,
          tier: a2arResult.tier,
          label: a2arResult.label,
          pauseOpportunities: totalScans,
          qrDownloads: qrDownloads
        },
        asv: {
          averageSeconds: asvResult.asv_seconds,
          averageSecondsDisplay: asvResult.asv_seconds_display,
          tier: asvResult.tier,
          label: asvResult.label
        },
        aci: {
          rawScore: aciResult.raw_ACI,
          scaledScore: aciResult.scaled_ACI,
          level: aciResult.level,
          label: aciResult.label
        }
      },
      singleScan: totalScans === 1,
      scans: formattedScans
    });
  } catch (error) {
    console.error('Error fetching IP metrics:', error);
    res.status(500).json({ error: 'Failed to fetch IP metrics' });
  }
});

// GET /api/scans/by-program/:seriesTitle - detailed scans for a specific program or QR/creative ID
router.get('/scans/by-program/:seriesTitle', auth, async (req, res) => {
  try {
    const { seriesTitle } = req.params;
    const { startDate, endDate, device } = req.query;
    const baseMatch = { advertiser: req.user.id };

    const regex = new RegExp(seriesTitle, 'i');

    const query = {
      ...baseMatch,
      $or: [
        { program: regex },
        { qrId: regex },
        { creativeId: regex }
      ]
    };

    if (startDate) {
      query.timestamp = query.timestamp || {};
      query.timestamp.$gte = new Date(startDate);
    }
    if (endDate) {
      query.timestamp = query.timestamp || {};
      query.timestamp.$lte = new Date(endDate);
    }
    if (device) {
      query.device = new RegExp(device, 'i');
    }

    const scans = await Scan.find(query).sort({ timestamp: -1 }).lean();

    const sanitized = scans.map(s => ({
      id: s._id,
      timestamp: s.timestamp,
      qr_id: s.qrId,
      ip_address: s.ip,
      device: s.device,
      conversion: s.conversion,
      conversionAction: s.conversionAction
    }));

    res.json({ scans: sanitized });
  } catch (error) {
    console.error('Error fetching program scans:', error);
    res.status(500).json({ error: 'Failed to fetch scans' });
  }
});

// POST /api/wallet/deposit - add funds (simple internal deposit, no payment gateway)
router.post('/wallet/deposit', auth, async (req, res) => {
  const { amount } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const userId = req.user.id;
    let wallet = await getOrCreateWallet(userId, session, {
      fullName: req.user.fullName,
      brand: req.user.brand
    });

    const before = wallet.balance;
    const depositAmount = Number(amount);
    const after = before + depositAmount;

    wallet.balance = after;
    await wallet.save({ session });

    await WalletTransaction.create([
      {
        wallet: wallet._id,
        type: 'deposit',
        amount: depositAmount,
        balanceBefore: before,
        balanceAfter: after,
        description: `Wallet deposit of $${depositAmount.toFixed(2)}`
      }
    ], { session });

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      newBalance: after,
      message: `Successfully added $${depositAmount.toFixed(2)} to wallet`
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Deposit error:', error);
    res.status(500).json({ error: 'Failed to deposit funds' });
  }
});

// GET /api/wallet/transactions - get recent wallet transactions
router.get('/wallet/transactions', auth, async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ user: req.user.id });
    if (!wallet) {
      return res.json({ transactions: [] });
    }

    const transactions = await WalletTransaction.find({ wallet: wallet._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ transactions });
  } catch (error) {
    console.error('Transaction history error:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// GET /api/billing/records - billing center list
router.get('/billing/records', auth, async (req, res) => {
  try {
    const { startDate, endDate, publisher } = req.query;
    const query = { user: req.user.id };

    if (startDate) {
      query.billedAt = query.billedAt || {};
      query.billedAt.$gte = new Date(startDate);
    }
    if (endDate) {
      query.billedAt = query.billedAt || {};
      query.billedAt.$lte = new Date(endDate);
    }
    if (publisher) {
      query.publisher = publisher;
    }

    const records = await BillingRecord.find(query)
      .sort({ billedAt: -1 })
      .limit(100)
      .lean();

    res.json({ records });
  } catch (error) {
    console.error('Billing records error:', error);
    res.status(500).json({ error: 'Failed to fetch billing records' });
  }
});

// GET /api/billing/summary
router.get('/billing/summary', auth, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);

    const [agg] = await BillingRecord.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: null,
          totalSpent: { $sum: '$conversionFee' },
          totalConversions: { $sum: 1 }
        }
      }
    ]);

    const byPublisher = await BillingRecord.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: '$publisher',
          conversions: { $sum: 1 },
          spent: { $sum: '$conversionFee' }
        }
      },
      {
        $project: {
          _id: 0,
          publisher: '$_id',
          conversions: 1,
          spent: 1
        }
      }
    ]);

    res.json({
      totalSpent: agg?.totalSpent || 0,
      totalConversions: agg?.totalConversions || 0,
      byPublisher
    });
  } catch (error) {
    console.error('Billing summary error:', error);
    res.status(500).json({ error: 'Failed to fetch billing summary' });
  }
});

// POST /api/qr-codes - create QR code for advertiser (current user)
router.post('/qr-codes', auth, async (req, res) => {
  try {
    const {
      qrId,
      destinationUrl,
      publisher,
      program,
      creativeId,
      conversionFee = 5.0,
      publisherShare = 3.0,
      thumbnailUrl
    } = req.body;

    if (!qrId || !destinationUrl) {
      return res.status(400).json({ error: 'qrId and destinationUrl required' });
    }

    const existing = await QrCode.findOne({ id: qrId });
    if (existing) {
      return res.status(400).json({ error: 'QR code ID already exists' });
    }

    const qr = new QrCode({
      id: qrId,
      advertiser: req.user.id,
      destinationUrl,
      publisher,
      program,
      creativeId,
      thumbnailUrl,
      conversionFee,
      publisherShare
    });

    await qr.save();

    // Build tracking URL
    // Prefer API_BASE_URL (used elsewhere in the codebase),
    // then BASE_URL if provided, and finally fall back to localhost for dev.
    const baseUrl =
      process.env.API_BASE_URL ||
      process.env.BASE_URL ||
      (process.env.NODE_ENV === 'production'
        ? 'https://api.ipauseads.com'
        : 'http://localhost:4000');

    res.json({
      success: true,
      message: 'QR code created',
      trackingUrl: `${baseUrl.replace(/\/$/, '')}/qr/${qrId}`
    });
  } catch (error) {
    console.error('QR code creation error:', error);
    res.status(500).json({ error: 'Failed to create QR code' });
  }
});

// GET /api/qr-codes - list current advertiser's QR codes
router.get('/qr-codes', auth, async (req, res) => {
  try {
    const qrCodes = await QrCode.find({ advertiser: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ qrCodes });
  } catch (error) {
    console.error('QR codes fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch QR codes' });
  }
});

// POST /api/conversion/notify - conversion webhook from advertiser
router.post('/conversion/notify', async (req, res) => {
  const { scanId, orderId, orderAmount, conversionToken } = req.body;

  try {
    if (!scanId) {
      return res.status(400).json({ error: 'scanId required' });
    }

    // Optional security: shared secret token
    if (process.env.CONVERSION_WEBHOOK_SECRET) {
      if (!conversionToken || conversionToken !== process.env.CONVERSION_WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Invalid conversion token' });
      }
    }

    const scan = await Scan.findById(scanId);
    if (!scan) {
      return res.status(404).json({ error: 'Scan not found' });
    }

    if (scan.conversion) {
      return res.json({ message: 'Conversion already processed' });
    }

    if (!scan.advertiser) {
      return res.status(400).json({ error: 'Scan is missing advertiser info' });
    }

    const qrCode = await QrCode.findOne({ id: scan.qrId });
    const publisherShare = qrCode?.publisherShare || 0;
    const conversionFee = scan.conversionFee || qrCode?.conversionFee || 0;
    const ipauseCut = conversionFee - publisherShare;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const wallet = await getOrCreateWallet(scan.advertiser, session);

      if (wallet.balance < conversionFee) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          error: 'Insufficient wallet balance',
          required: conversionFee,
          available: wallet.balance
        });
      }

      const before = wallet.balance;
      const after = before - conversionFee;

      // Update scan
      scan.conversion = true;
      scan.verified = true;
      scan.orderId = orderId;
      scan.orderAmount = Number(orderAmount) || 0;
      scan.conversionFee = conversionFee;
      scan.convertedAt = new Date();
      await scan.save({ session });

      // Update wallet
      wallet.balance = after;
      await wallet.save({ session });

      // Wallet transaction (store negative for debits)
      await WalletTransaction.create([
        {
          wallet: wallet._id,
          type: 'conversion_fee',
          amount: -conversionFee,
          balanceBefore: before,
          balanceAfter: after,
          description: `Conversion fee for QR ${scan.qrId}`,
          referenceId: scan._id,
          referenceType: 'scan'
        }
      ], { session });

      // Billing record
      await BillingRecord.create([
        {
          user: scan.advertiser,
          scan: scan._id,
          qrCodeId: scan.qrId,
          publisher: scan.publisher || qrCode?.publisher,
          creativeId: scan.creativeId || qrCode?.creativeId,
          conversionFee: conversionFee,
          publisherShare: publisherShare,
          ipauseCut: ipauseCut,
          verified: true,
          orderId,
          orderAmount: Number(orderAmount) || 0,
          billedAt: new Date()
        }
      ], { session });

      // TODO: Credit publisher wallet in future milestones

      await session.commitTransaction();
      session.endSession();

      // Update linked pause event if exists (outside transaction for non-critical update)
      try {
        const pauseEvent = await PauseEvent.findOne({ scanId: scan._id });
        if (pauseEvent) {
          pauseEvent.conversionOccurred = true;
          await pauseEvent.save();

          // Update A2AR metrics with conversion
          if (pauseEvent.advertiser) {
            await A2ARMetric.updateMetrics({
              date: new Date(),
              advertiser: pauseEvent.advertiser,
              publisher: pauseEvent.publisher,
              programTitle: pauseEvent.programTitle,
              conversion: true
            });
          }
        }
      } catch (pauseUpdateError) {
        console.error('Error updating pause event conversion:', pauseUpdateError);
      }

      res.json({
        success: true,
        charged: conversionFee,
        newBalance: after,
        message: 'Conversion tracked and billed successfully'
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  } catch (error) {
    console.error('Conversion notification error:', error);
    res.status(500).json({ error: 'Failed to process conversion' });
  }
});

module.exports = router;
