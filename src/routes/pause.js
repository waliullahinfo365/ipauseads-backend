// src/routes/pause.js
const express = require('express');
const router = express.Router();
const PauseEvent = require('../models/PauseEvent');
const A2ARMetric = require('../models/A2ARMetric');
const QrCode = require('../models/QrCode');
const authMiddleware = require('../middleware/auth');

/**
 * POST /pause/receipt
 * Called by publisher when viewer pauses content
 * This endpoint is PUBLIC - publishers call it without user auth
 */
router.post('/receipt', async (req, res) => {
  try {
    const {
      publisher,
      appName,
      platform,
      sessionId,
      pauseTimestamp,
      programTitle,
      season,
      episode,
      episodeTitle,
      genre,
      rating,
      contentType,
      playbackPositionMs,
      contentDurationMs,
      qrCodeId
    } = req.body;

    // Validate required fields
    if (!publisher || !sessionId || !pauseTimestamp || !programTitle) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['publisher', 'sessionId', 'pauseTimestamp', 'programTitle']
      });
    }

    // Check for duplicate session (prevent double-counting)
    const existing = await PauseEvent.findOne({ sessionId });
    if (existing) {
      return res.status(200).json({
        message: 'Pause event already recorded',
        pauseEventId: existing._id
      });
    }

    // Calculate playback percentage
    let playbackPercentage = null;
    if (contentDurationMs && playbackPositionMs) {
      playbackPercentage = parseFloat(((playbackPositionMs / contentDurationMs) * 100).toFixed(2));
    }

    // Look up advertiser from QR code if provided
    let advertiser = null;
    if (qrCodeId) {
      const qrCode = await QrCode.findOne({ id: qrCodeId });
      if (qrCode) {
        advertiser = qrCode.advertiser;
      }
    }

    // Store pause receipt
    const pauseEvent = await PauseEvent.create({
      publisher,
      appName,
      platform,
      sessionId,
      pauseTimestamp: new Date(pauseTimestamp),
      programTitle,
      season: season || null,
      episode: episode || null,
      episodeTitle,
      genre,
      rating,
      contentType: contentType || 'on-demand',
      playbackPositionMs,
      contentDurationMs,
      playbackPercentage,
      qrCodeId,
      advertiser,
      rawReceipt: req.body
    });

    // Update A2AR metrics if we have an advertiser
    if (advertiser) {
      await A2ARMetric.updateMetrics({
        date: new Date(),
        advertiser,
        publisher,
        programTitle,
        pauseOpportunity: true
      });
    }

    res.json({
      success: true,
      pauseEventId: pauseEvent._id,
      message: 'Pause receipt recorded successfully'
    });

  } catch (error) {
    console.error('Pause receipt error:', error);
    res.status(500).json({ error: 'Failed to record pause event' });
  }
});

/**
 * GET /pause/moments
 * Get all pause moments for advertiser (authenticated)
 */
router.get('/moments', authMiddleware, async (req, res) => {
  try {
    const { publisher, contentType, converted, limit = 100 } = req.query;

    const filter = {};

    // If not admin, filter by advertiser
    if (req.user.role !== 'admin') {
      filter.advertiser = req.user.id;
    }

    // Apply optional filters
    if (publisher) filter.publisher = publisher;
    if (contentType) filter.contentType = contentType;
    if (converted !== undefined) {
      filter.conversionOccurred = converted === 'true';
    }

    const moments = await PauseEvent.find(filter)
      .sort({ pauseTimestamp: -1 })
      .limit(parseInt(limit))
      .populate('scanId', 'conversion conversionAction')
      .lean();

    res.json({ moments });
  } catch (error) {
    console.error('Error fetching pause moments:', error);
    res.status(500).json({ error: 'Failed to fetch pause moments' });
  }
});

/**
 * GET /pause/moments/:id
 * Get single pause moment details
 */
router.get('/moments/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const moment = await PauseEvent.findById(id)
      .populate('scanId')
      .populate('advertiser', 'fullName email brand')
      .lean();

    if (!moment) {
      return res.status(404).json({ error: 'Pause moment not found' });
    }

    // Check access (admin can see all, others only their own)
    if (req.user.role !== 'admin' && 
        moment.advertiser?._id?.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ moment });
  } catch (error) {
    console.error('Error fetching pause moment:', error);
    res.status(500).json({ error: 'Failed to fetch pause moment' });
  }
});

/**
 * GET /pause/publishers
 * Get list of unique publishers with pause events
 */
router.get('/publishers', authMiddleware, async (req, res) => {
  try {
    const filter = {};
    if (req.user.role !== 'admin') {
      filter.advertiser = req.user.id;
    }

    const publishers = await PauseEvent.distinct('publisher', filter);
    res.json({ publishers });
  } catch (error) {
    console.error('Error fetching publishers:', error);
    res.status(500).json({ error: 'Failed to fetch publishers' });
  }
});

/**
 * GET /pause/programs
 * Get list of unique programs with pause events
 */
router.get('/programs', authMiddleware, async (req, res) => {
  try {
    const filter = {};
    if (req.user.role !== 'admin') {
      filter.advertiser = req.user.id;
    }

    const programs = await PauseEvent.distinct('programTitle', filter);
    res.json({ programs });
  } catch (error) {
    console.error('Error fetching programs:', error);
    res.status(500).json({ error: 'Failed to fetch programs' });
  }
});

/**
 * POST /pause/test
 * Generate test pause receipts for development
 */
router.post('/test', async (req, res) => {
  try {
    const testReceipts = [
      {
        publisher: 'Hulu',
        appName: 'Hulu CTV',
        platform: 'Roku',
        sessionId: `test-session-${Date.now()}-1`,
        pauseTimestamp: new Date().toISOString(),
        programTitle: 'Stranger Things',
        season: 4,
        episode: 3,
        episodeTitle: 'The Turn',
        genre: 'Sci-Fi, Horror',
        rating: 'TV-MA',
        contentType: 'on-demand',
        playbackPositionMs: 1435221,
        contentDurationMs: 3600000,
        qrCodeId: null
      },
      {
        publisher: 'Netflix',
        appName: 'Netflix',
        platform: 'Apple TV',
        sessionId: `test-session-${Date.now()}-2`,
        pauseTimestamp: new Date(Date.now() - 3600000).toISOString(),
        programTitle: 'The Crown',
        season: 5,
        episode: 8,
        episodeTitle: 'Gunpowder',
        genre: 'Drama, Biography',
        rating: 'TV-MA',
        contentType: 'on-demand',
        playbackPositionMs: 2100000,
        contentDurationMs: 3300000,
        qrCodeId: null
      },
      {
        publisher: 'YouTube TV',
        appName: 'YouTube TV',
        platform: 'Fire TV',
        sessionId: `test-session-${Date.now()}-3`,
        pauseTimestamp: new Date(Date.now() - 7200000).toISOString(),
        programTitle: 'MrBeast - Extreme Hide and Seek',
        genre: 'Entertainment, Reality',
        rating: 'TV-G',
        contentType: 'on-demand',
        playbackPositionMs: 480000,
        contentDurationMs: 1200000,
        qrCodeId: null
      },
      {
        publisher: 'Tubi',
        appName: 'Tubi',
        platform: 'Roku',
        sessionId: `test-session-${Date.now()}-4`,
        pauseTimestamp: new Date(Date.now() - 1800000).toISOString(),
        programTitle: 'Breaking Bad',
        season: 2,
        episode: 10,
        episodeTitle: 'Over',
        genre: 'Drama, Crime',
        rating: 'TV-MA',
        contentType: 'on-demand',
        playbackPositionMs: 1800000,
        contentDurationMs: 2880000,
        qrCodeId: null
      },
      {
        publisher: 'Peacock',
        appName: 'Peacock TV',
        platform: 'Samsung TV',
        sessionId: `test-session-${Date.now()}-5`,
        pauseTimestamp: new Date(Date.now() - 900000).toISOString(),
        programTitle: 'The Office',
        season: 3,
        episode: 17,
        episodeTitle: 'Business School',
        genre: 'Comedy',
        rating: 'TV-PG',
        contentType: 'on-demand',
        playbackPositionMs: 720000,
        contentDurationMs: 1320000,
        qrCodeId: null
      }
    ];

    const results = [];
    for (const receipt of testReceipts) {
      // Check for existing session
      const existing = await PauseEvent.findOne({ sessionId: receipt.sessionId });
      if (existing) {
        results.push({ sessionId: receipt.sessionId, status: 'already exists', id: existing._id });
        continue;
      }

      // Calculate playback percentage
      const playbackPercentage = receipt.contentDurationMs
        ? parseFloat(((receipt.playbackPositionMs / receipt.contentDurationMs) * 100).toFixed(2))
        : null;

      const pauseEvent = await PauseEvent.create({
        ...receipt,
        pauseTimestamp: new Date(receipt.pauseTimestamp),
        playbackPercentage,
        rawReceipt: receipt
      });

      results.push({ 
        sessionId: receipt.sessionId, 
        status: 'created', 
        id: pauseEvent._id,
        programTitle: receipt.programTitle
      });
    }

    res.json({ 
      success: true, 
      message: `Created ${results.filter(r => r.status === 'created').length} test pause receipts`,
      receipts: results 
    });
  } catch (error) {
    console.error('Test pause receipt error:', error);
    res.status(500).json({ error: 'Failed to create test receipts' });
  }
});

module.exports = router;
