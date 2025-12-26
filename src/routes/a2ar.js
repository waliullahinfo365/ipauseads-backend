// src/routes/a2ar.js
const express = require('express');
const router = express.Router();
const A2ARMetric = require('../models/A2ARMetric');
const authMiddleware = require('../middleware/auth');

/**
 * GET /a2ar/summary
 * Get A2AR metrics summary for the authenticated user
 */
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const advertiserId = req.user.id;

    const summary = await A2ARMetric.getSummary(advertiserId, parseInt(days));
    res.json(summary);
  } catch (error) {
    console.error('Error fetching A2AR summary:', error);
    res.status(500).json({ error: 'Failed to fetch A2AR summary' });
  }
});

/**
 * GET /a2ar/by-program
 * Get A2AR breakdown by program
 */
router.get('/by-program', authMiddleware, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const advertiserId = req.user.id;

    const programs = await A2ARMetric.getByProgram(advertiserId, parseInt(days));
    res.json({ programs });
  } catch (error) {
    console.error('Error fetching A2AR by program:', error);
    res.status(500).json({ error: 'Failed to fetch program A2AR' });
  }
});

/**
 * GET /a2ar/by-publisher
 * Get A2AR breakdown by publisher
 */
router.get('/by-publisher', authMiddleware, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const advertiserId = req.user.id;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    startDate.setHours(0, 0, 0, 0);

    const publishers = await A2ARMetric.aggregate([
      {
        $match: {
          advertiser: require('mongoose').Types.ObjectId.createFromHexString(advertiserId),
          date: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$publisher',
          pauseOpportunities: { $sum: '$pauseOpportunities' },
          qrScans: { $sum: '$qrScans' },
          verifiedConversions: { $sum: '$verifiedConversions' },
          avgA2AR: { $avg: '$a2arPercentage' }
        }
      },
      {
        $project: {
          _id: 0,
          publisher: '$_id',
          pauseOpportunities: 1,
          qrScans: 1,
          verifiedConversions: 1,
          avgA2AR: { $round: ['$avgA2AR', 2] }
        }
      },
      { $sort: { pauseOpportunities: -1 } }
    ]);

    res.json({ publishers });
  } catch (error) {
    console.error('Error fetching A2AR by publisher:', error);
    res.status(500).json({ error: 'Failed to fetch publisher A2AR' });
  }
});

/**
 * GET /a2ar/daily
 * Get daily A2AR metrics for charting
 */
router.get('/daily', authMiddleware, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const advertiserId = req.user.id;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    startDate.setHours(0, 0, 0, 0);

    const daily = await A2ARMetric.aggregate([
      {
        $match: {
          advertiser: require('mongoose').Types.ObjectId.createFromHexString(advertiserId),
          date: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$date',
          pauseOpportunities: { $sum: '$pauseOpportunities' },
          qrScans: { $sum: '$qrScans' },
          verifiedConversions: { $sum: '$verifiedConversions' }
        }
      },
      {
        $project: {
          _id: 0,
          date: '$_id',
          pauseOpportunities: 1,
          qrScans: 1,
          verifiedConversions: 1,
          a2ar: {
            $cond: [
              { $eq: ['$pauseOpportunities', 0] },
              0,
              {
                $round: [
                  { $multiply: [{ $divide: ['$verifiedConversions', '$pauseOpportunities'] }, 100] },
                  2
                ]
              }
            ]
          }
        }
      },
      { $sort: { date: 1 } }
    ]);

    res.json({ daily });
  } catch (error) {
    console.error('Error fetching daily A2AR:', error);
    res.status(500).json({ error: 'Failed to fetch daily A2AR' });
  }
});

/**
 * GET /a2ar/tiers
 * Get A2AR tier definitions (UPDATED)
 */
router.get('/tiers', (req, res) => {
  res.json({
    a2ar: [
      { tier: 1, label: 'Low', min: 0.2, max: 0.4, description: 'Below standard CTV response' },
      { tier: 2, label: 'Fair', min: 0.5, max: 0.7, description: 'Matches typical QR CTV ads' },
      { tier: 3, label: 'Average', min: 0.8, max: 1.5, description: 'Healthy baseline' },
      { tier: 4, label: 'Strong', min: 1.6, max: 2.5, description: 'Clear advantage' },
      { tier: 5, label: 'Exceptional', min: 2.6, max: 3.0, description: 'Rare, premium, context-perfect' }
    ],
    asv: [
      { tier: 1, label: 'Low', min: 40, max: null, description: 'Slow scan response (>40s)' },
      { tier: 2, label: 'Fair', min: 20, max: 40, description: 'Moderate scan response (20-40s)' },
      { tier: 3, label: 'Average', min: 10, max: 20, description: 'Standard scan response (10-20s)' },
      { tier: 4, label: 'Strong', min: 5, max: 10, description: 'Quick scan response (5-10s)' },
      { tier: 5, label: 'Exceptional', min: 0, max: 5, description: 'Instant scan response (<5s)' }
    ],
    aci: [
      { level: 1, label: 'Low', min: 2, max: 3, description: 'Low attention quality' },
      { level: 2, label: 'Fair', min: 4, max: 5, description: 'Fair attention quality' },
      { level: 3, label: 'Average', min: 6, max: 7, description: 'Average attention quality' },
      { level: 4, label: 'Strong', min: 8, max: 9, description: 'Strong attention quality' },
      { level: 5, label: 'Exceptional', min: 9, max: 10, description: 'Exceptional attention quality' }
    ]
  });
});

/**
 * GET /a2ar/attention-metrics/summary
 * Get comprehensive attention metrics (A2AR, ASV, ACI)
 */
router.get('/attention-metrics/summary', authMiddleware, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const advertiserId = req.user.id;

    const summary = await A2ARMetric.getSummary(advertiserId, parseInt(days));
    res.json(summary);
  } catch (error) {
    console.error('Error fetching attention metrics summary:', error);
    res.status(500).json({ error: 'Failed to fetch attention metrics' });
  }
});

/**
 * GET /a2ar/attention-metrics/by-program
 * Get attention metrics breakdown by program
 */
router.get('/attention-metrics/by-program', authMiddleware, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const advertiserId = req.user.id;

    const programs = await A2ARMetric.getByProgram(advertiserId, parseInt(days));
    res.json({ programs });
  } catch (error) {
    console.error('Error fetching attention metrics by program:', error);
    res.status(500).json({ error: 'Failed to fetch program metrics' });
  }
});

module.exports = router;
