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
          a2ar: { percentage: 0, tier: 1, label: 'N/A', pauseOpportunities: 0, conversions: 0 },
          asv: { averageSeconds: 0, tier: 0, label: 'N/A' },
          aci: { score: 0, level: 0, label: 'N/A' }
        },
        scans: []
      });
    }

    // Calculate metrics for this IP
    const totalScans = scans.length;
    const conversions = scans.filter(s => s.conversion === true).length;
    
    // A2AR: Conversions / Total Scans (treating each scan as a "pause opportunity")
    const a2arPercentage = totalScans > 0 ? (conversions / totalScans) * 100 : 0;
    const a2arResult = A2ARMetric.getA2ARTier(a2arPercentage);

    // ASV: Calculate average time between scan timestamp and conversion
    // For simplicity, we'll use the time difference between consecutive scans that led to conversion
    let asvSeconds = null;
    let asvTier = 0;
    let asvLabel = 'N/A';

    const convertedScans = scans.filter(s => s.conversion && s.convertedAt);
    if (convertedScans.length > 0) {
      // Calculate average time from scan to conversion
      const scanTimes = convertedScans.map(s => {
        const scanTime = new Date(s.timestamp).getTime();
        const convTime = new Date(s.convertedAt).getTime();
        return (convTime - scanTime) / 1000; // seconds
      }).filter(t => t > 0 && t < 3600); // Filter reasonable times (< 1 hour)

      if (scanTimes.length > 0) {
        asvSeconds = scanTimes.reduce((a, b) => a + b, 0) / scanTimes.length;
        asvSeconds = Math.round(asvSeconds * 100) / 100;

        // Calculate ASV tier (lower is better)
        if (asvSeconds > 40) {
          asvTier = 1; asvLabel = 'Low';
        } else if (asvSeconds > 20) {
          asvTier = 2; asvLabel = 'Fair';
        } else if (asvSeconds > 10) {
          asvTier = 3; asvLabel = 'Average';
        } else if (asvSeconds > 5) {
          asvTier = 4; asvLabel = 'Strong';
        } else {
          asvTier = 5; asvLabel = 'Exceptional';
        }
      }
    }

    // ACI: Composite of A2AR tier and ASV tier
    let aciScore = 0;
    let aciLevel = 0;
    let aciLabel = 'N/A';

    if (a2arResult.tier > 0 && asvTier > 0) {
      const rawACI = (a2arResult.tier + asvTier) / 2;
      aciScore = Math.round(rawACI * 2 * 100) / 100; // Scale to 0-10

      if (aciScore >= 9) { aciLevel = 5; aciLabel = 'Exceptional'; }
      else if (aciScore >= 8) { aciLevel = 4; aciLabel = 'Strong'; }
      else if (aciScore >= 6) { aciLevel = 3; aciLabel = 'Average'; }
      else if (aciScore >= 4) { aciLevel = 2; aciLabel = 'Fair'; }
      else if (aciScore >= 2) { aciLevel = 1; aciLabel = 'Low'; }
    }

    // Format scans for response
    const formattedScans = scans.map(s => ({
      id: s._id,
      timestamp: s.timestamp,
      qr_id: s.qrId,
      ip_address: s.ip,
      device: s.device,
      conversion: s.conversion,
      conversionAction: s.conversionAction,
      program: s.program,
      publisher: s.publisher
    }));

    res.json({
      ip,
      totalScans,
      conversions,
      metrics: {
        a2ar: {
          percentage: Math.round(a2arPercentage * 100) / 100,
          tier: a2arResult.tier,
          label: a2arResult.label,
          pauseOpportunities: totalScans,
          conversions: conversions
        },
        asv: {
          averageSeconds: asvSeconds || 0,
          tier: asvTier,
          label: asvLabel
        },
        aci: {
          score: aciScore,
          level: aciLevel,
          label: aciLabel
        }
      },
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
