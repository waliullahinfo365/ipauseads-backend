// src/routes/v1/events.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const mongoose = require('mongoose');

// Models
const EventReceipt = require('../../models/EventReceipt');
const PublisherApiKey = require('../../models/PublisherApiKey');
const IdempotencyCache = require('../../models/IdempotencyCache');
const A2ARMetric = require('../../models/A2ARMetric');
const QrCode = require('../../models/QrCode');
const Wallet = require('../../models/Wallet');
const WalletTransaction = require('../../models/WalletTransaction');
const BillingRecord = require('../../models/BillingRecord');

// =====================
// Middleware: Authenticate Publisher
// =====================
async function authenticatePublisher(req, res, next) {
  try {
    // Option 1: API Key Authentication (Bearer token)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const apiKey = authHeader.substring(7);
      
      const publisher = await PublisherApiKey.findByApiKey(apiKey);
      
      if (!publisher) {
        return res.status(401).json({ 
          error: 'invalid_credentials',
          message: 'Invalid or inactive API key'
        });
      }
      
      req.publisher = publisher;
      
      // Update usage stats (non-blocking)
      publisher.recordUsage().catch(err => console.error('Usage recording error:', err));
      
      return next();
    }
    
    // Option 2: Signed Webhook Authentication
    const timestamp = req.headers['x-ipause-timestamp'];
    const signature = req.headers['x-ipause-signature'];
    
    if (timestamp && signature) {
      const publisherId = req.body.publisher?.publisher_id;
      
      if (!publisherId) {
        return res.status(400).json({ 
          error: 'missing_publisher_id',
          message: 'publisher.publisher_id is required for signed requests'
        });
      }
      
      const publisher = await PublisherApiKey.findOne({ 
        publisherId, 
        status: 'active' 
      });
      
      if (!publisher) {
        return res.status(401).json({ 
          error: 'publisher_not_found',
          message: 'Publisher not found or inactive'
        });
      }
      
      // Verify signature
      const rawBody = JSON.stringify(req.body);
      const isValid = publisher.verifySignature(timestamp, rawBody, signature);
      
      if (!isValid) {
        return res.status(401).json({ 
          error: 'invalid_signature',
          message: 'Webhook signature verification failed'
        });
      }
      
      // Check timestamp freshness (within 5 minutes)
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - parseInt(timestamp)) > 300) {
        return res.status(401).json({ 
          error: 'timestamp_expired',
          message: 'Request timestamp is too old (>5 minutes)'
        });
      }
      
      req.publisher = publisher;
      publisher.recordUsage().catch(err => console.error('Usage recording error:', err));
      
      return next();
    }
    
    return res.status(401).json({ 
      error: 'authentication_required',
      message: 'Provide either Authorization header (Bearer token) or signed webhook headers (x-ipause-timestamp, x-ipause-signature)'
    });
    
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({ 
      error: 'authentication_failed',
      message: 'Internal authentication error'
    });
  }
}

// =====================
// Middleware: Check Idempotency
// =====================
async function checkIdempotency(req, res, next) {
  try {
    const idempotencyKey = req.headers['idempotency-key'];
    
    if (!idempotencyKey) {
      return res.status(400).json({ 
        error: 'missing_idempotency_key',
        message: 'Idempotency-Key header is required'
      });
    }
    
    // Check if already processed
    const cachedResponse = await IdempotencyCache.checkDuplicate(idempotencyKey);
    
    if (cachedResponse) {
      // Return cached response (duplicate request)
      return res.status(200).json(cachedResponse);
    }
    
    req.idempotencyKey = idempotencyKey;
    next();
    
  } catch (error) {
    console.error('Idempotency check error:', error);
    return res.status(500).json({ 
      error: 'idempotency_check_failed',
      message: 'Failed to check idempotency'
    });
  }
}

// =====================
// POST /v1/events - Main endpoint
// =====================
router.post('/events', authenticatePublisher, checkIdempotency, async (req, res) => {
  try {
    const eventType = req.body.event_type;
    
    // Validate event_type
    if (!eventType || !['pause_impression', 'qr_conversion'].includes(eventType)) {
      return res.status(400).json({ 
        error: 'invalid_event_type',
        message: 'event_type must be "pause_impression" or "qr_conversion"'
      });
    }
    
    // Route to appropriate handler
    if (eventType === 'pause_impression') {
      return await handlePauseImpression(req, res);
    } else if (eventType === 'qr_conversion') {
      return await handleQRConversion(req, res);
    }
    
  } catch (error) {
    console.error('Event processing error:', error);
    return res.status(500).json({ 
      error: 'processing_failed',
      message: error.message
    });
  }
});

// =====================
// Handler: Pause Impression
// =====================
async function handlePauseImpression(req, res) {
  const {
    event_id,
    event_version = '1.0',
    event_time_utc,
    publisher,
    session,
    content,
    playback,
    ad,
    device,
    geo,
    qr_appeared_at  // NEW: When QR code displayed on screen
  } = req.body;
  
  // Validate required fields
  if (!event_id || !event_time_utc || !publisher || !session || !content || !ad) {
    return res.status(400).json({ 
      error: 'missing_required_fields',
      required: ['event_id', 'event_time_utc', 'publisher', 'session', 'content', 'ad']
    });
  }
  
  if (!session.ipause_opportunity_id) {
    return res.status(400).json({ 
      error: 'missing_opportunity_id',
      message: 'session.ipause_opportunity_id is required'
    });
  }
  
  try {
    // Check for duplicate event_id
    const existing = await EventReceipt.findOne({ eventId: event_id });
    
    if (existing) {
      const response = {
        status: 'duplicate',
        receipt_id: `rct_${existing._id}`,
        message: 'Event already processed'
      };
      return res.status(200).json(response);
    }
    
    // Create pause impression receipt
    const receipt = await EventReceipt.create({
      eventId: event_id,
      eventType: 'pause_impression',
      eventVersion: event_version,
      eventTimeUtc: new Date(event_time_utc),
      ipauseOpportunityId: session.ipause_opportunity_id,
      publisherId: publisher.publisher_id,
      publisherName: publisher.publisher_name,
      appId: publisher.app_id,
      supplyType: publisher.supply_type,
      sessionId: session.session_id,
      contentSessionId: session.content_session_id,
      contentId: content.content_id,
      contentTitle: content.title,
      series: content.series,
      season: content.season,
      episode: content.episode,
      genre: content.genre || [],
      rating: content.rating,
      pauseTimestampMs: playback?.pause_timestamp_ms,
      isLive: playback?.is_live || false,
      ipauseAdId: ad.ipause_ad_id,
      campaignId: ad.campaign_id,
      brand: ad.brand,
      creativeId: ad.creative_id,
      qrEnabled: ad.qr_enabled || false,
      deviceType: device?.device_type,
      os: device?.os,
      country: geo?.country,
      region: geo?.region,
      qrAppearedAt: qr_appeared_at ? new Date(qr_appeared_at) : new Date(event_time_utc),  // NEW: QR appearance time
      rawPayload: req.body,
      idempotencyKey: req.idempotencyKey,
      billingStatus: 'pending'
    });
    
    const receiptId = `rct_${receipt._id}`;
    
    // Update A2AR metrics (pause opportunity)
    await updateA2ARMetrics({
      date: new Date(event_time_utc),
      publisherId: publisher.publisher_id,
      programTitle: content.title || content.series,
      campaignId: ad.campaign_id,
      pauseOpportunity: true
    });
    
    // Prepare response
    const response = {
      status: 'accepted',
      receipt_id: receiptId,
      ingested_at: new Date().toISOString()
    };
    
    // Cache response for idempotency
    await IdempotencyCache.cacheResponse(req.idempotencyKey, receiptId, response);
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('Pause impression error:', error);
    return res.status(500).json({ 
      error: 'processing_failed',
      message: error.message
    });
  }
}

// =====================
// Handler: QR Conversion
// =====================
async function handleQRConversion(req, res) {
  const {
    event_id,
    event_version = '1.0',
    event_time_utc,
    publisher,
    session,
    conversion
  } = req.body;
  
  // Validate required fields
  if (!event_id || !event_time_utc || !publisher || !session || !conversion) {
    return res.status(400).json({ 
      error: 'missing_required_fields',
      required: ['event_id', 'event_time_utc', 'publisher', 'session', 'conversion']
    });
  }
  
  if (!session.ipause_opportunity_id) {
    return res.status(400).json({ 
      error: 'missing_opportunity_id',
      message: 'session.ipause_opportunity_id is required'
    });
  }
  
  try {
    // Check for duplicate event_id
    const existing = await EventReceipt.findOne({ eventId: event_id });
    
    if (existing) {
      const response = {
        status: 'duplicate',
        receipt_id: `rct_${existing._id}`,
        message: 'Event already processed'
      };
      return res.status(200).json(response);
    }
    
    // Find matching pause impression
    const pauseEvent = await EventReceipt.findMatchingPause(session.ipause_opportunity_id);
    
    if (!pauseEvent) {
      return res.status(404).json({ 
        error: 'pause_not_found',
        message: 'No matching pause_impression found for this ipause_opportunity_id'
      });
    }
    
    // Calculate ASV (Attention Scan Velocity)
    const asvData = A2ARMetric.calculateASV(pauseEvent.qrAppearedAt, event_time_utc);
    
    // Create conversion receipt with ASV data
    const receipt = await EventReceipt.create({
      eventId: event_id,
      eventType: 'qr_conversion',
      eventVersion: event_version,
      eventTimeUtc: new Date(event_time_utc),
      ipauseOpportunityId: session.ipause_opportunity_id,
      publisherId: publisher.publisher_id,
      conversionType: conversion.conversion_type,
      conversionResult: conversion.result,
      qrDestinationId: conversion.qr_destination_id,
      qrScannedAt: new Date(event_time_utc),
      asvSeconds: asvData.asvSeconds,
      asvTier: asvData.asvTier,
      asvLabel: asvData.asvLabel,
      rawPayload: req.body,
      idempotencyKey: req.idempotencyKey,
      matchedPauseId: pauseEvent._id,
      billingStatus: conversion.result === 'success' ? 'billable' : 'non_billable'
    });
    
    const receiptId = `rct_${receipt._id}`;
    
    // Link conversion to pause impression and update ASV data
    pauseEvent.matchedConversionId = receipt._id;
    pauseEvent.billingStatus = conversion.result === 'success' ? 'billable' : 'non_billable';
    pauseEvent.qrScannedAt = new Date(event_time_utc);
    pauseEvent.asvSeconds = asvData.asvSeconds;
    pauseEvent.asvTier = asvData.asvTier;
    pauseEvent.asvLabel = asvData.asvLabel;
    await pauseEvent.save();
    
    // If successful conversion, process billing
    if (conversion.result === 'success') {
      await processBilling(pauseEvent, receipt._id);
    }
    
    // Update A2AR metrics (conversion) with ASV data
    await updateA2ARMetrics({
      date: new Date(event_time_utc),
      publisherId: publisher.publisher_id,
      programTitle: pauseEvent.contentTitle || pauseEvent.series,
      campaignId: pauseEvent.campaignId,
      conversion: conversion.result === 'success',
      asvSeconds: asvData.asvSeconds
    });
    
    // Prepare response with ASV data
    const response = {
      status: 'accepted',
      receipt_id: receiptId,
      ingested_at: new Date().toISOString(),
      matched_pause_id: `rct_${pauseEvent._id}`,
      asv: asvData
    };
    
    // Cache response for idempotency
    await IdempotencyCache.cacheResponse(req.idempotencyKey, receiptId, response);
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('QR conversion error:', error);
    return res.status(500).json({ 
      error: 'processing_failed',
      message: error.message
    });
  }
}

// =====================
// Process billing for successful conversion
// =====================
async function processBilling(pauseEvent, conversionId) {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Get campaign/QR code details to find advertiser
    const qrCode = await QrCode.findOne({ id: pauseEvent.campaignId });
    
    if (!qrCode) {
      console.warn('Campaign/QR code not found:', pauseEvent.campaignId);
      await session.abortTransaction();
      session.endSession();
      return;
    }
    
    const advertiserId = qrCode.advertiser;
    const conversionFee = qrCode.conversionFee || 5.00;
    const publisherShare = qrCode.publisherShare || (conversionFee * 0.6);
    const ipauseCut = conversionFee - publisherShare;
    
    // Get advertiser's wallet
    let wallet = await Wallet.findOne({ user: advertiserId }).session(session);
    
    if (!wallet) {
      // Create wallet if doesn't exist
      wallet = await Wallet.create([{
        user: advertiserId,
        balance: 0
      }], { session });
      wallet = wallet[0];
    }
    
    if (wallet.balance < conversionFee) {
      console.warn('Insufficient wallet balance for advertiser:', advertiserId);
      await EventReceipt.findByIdAndUpdate(pauseEvent._id, { billingStatus: 'non_billable' });
      await session.abortTransaction();
      session.endSession();
      return;
    }
    
    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore - conversionFee;
    
    // Deduct from wallet
    wallet.balance = balanceAfter;
    await wallet.save({ session });
    
    // Record wallet transaction
    await WalletTransaction.create([{
      wallet: wallet._id,
      type: 'conversion_fee',
      amount: -conversionFee,
      balanceBefore,
      balanceAfter,
      description: `Conversion from ${pauseEvent.contentTitle} (${pauseEvent.publisherName})`,
      referenceId: conversionId,
      referenceType: 'event_receipt'
    }], { session });
    
    // Create billing record
    await BillingRecord.create([{
      user: advertiserId,
      scan: conversionId,
      qrCodeId: pauseEvent.campaignId,
      publisher: pauseEvent.publisherName,
      creativeId: pauseEvent.creativeId,
      conversionFee,
      publisherShare,
      ipauseCut,
      verified: true,
      billedAt: new Date()
    }], { session });
    
    // Mark pause event as billed
    await EventReceipt.findByIdAndUpdate(pauseEvent._id, { billingStatus: 'billed' }, { session });
    
    await session.commitTransaction();
    session.endSession();
    
    console.log(`Billing processed: $${conversionFee} charged for opportunity ${pauseEvent.ipauseOpportunityId}`);
    
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Billing processing error:', error);
  }
}

// =====================
// Update A2AR metrics
// =====================
async function updateA2ARMetrics({ date, publisherId, programTitle, campaignId, pauseOpportunity, conversion, asvSeconds = null }) {
  try {
    // Try to find advertiser from campaign
    let advertiserId = null;
    if (campaignId) {
      const qrCode = await QrCode.findOne({ id: campaignId });
      if (qrCode) {
        advertiserId = qrCode.advertiser;
      }
    }
    
    if (!advertiserId) {
      console.warn('No advertiser found for campaign:', campaignId);
      return;
    }
    
    await A2ARMetric.updateMetrics({
      date,
      advertiser: advertiserId,
      publisher: publisherId,
      programTitle: programTitle || 'Unknown',
      pauseOpportunity: !!pauseOpportunity,
      conversion: !!conversion,
      asvSeconds: asvSeconds
    });
    
  } catch (error) {
    console.error('A2AR update error:', error);
  }
}

// =====================
// GET /v1/events/:receiptId - Get event details
// =====================
router.get('/events/:receiptId', authenticatePublisher, async (req, res) => {
  try {
    const { receiptId } = req.params;
    
    // Extract MongoDB ID from receipt ID
    const mongoId = receiptId.replace('rct_', '');
    
    const receipt = await EventReceipt.findById(mongoId)
      .populate('matchedConversionId')
      .populate('matchedPauseId');
    
    if (!receipt) {
      return res.status(404).json({ 
        error: 'not_found',
        message: 'Event receipt not found'
      });
    }
    
    // Verify publisher owns this event
    if (receipt.publisherId !== req.publisher.publisherId) {
      return res.status(403).json({ 
        error: 'forbidden',
        message: 'You do not have access to this event'
      });
    }
    
    res.json({
      receipt_id: `rct_${receipt._id}`,
      event_type: receipt.eventType,
      event_id: receipt.eventId,
      event_time_utc: receipt.eventTimeUtc,
      ipause_opportunity_id: receipt.ipauseOpportunityId,
      billing_status: receipt.billingStatus,
      processed_at: receipt.processedAt,
      matched_conversion_id: receipt.matchedConversionId ? `rct_${receipt.matchedConversionId._id}` : null,
      matched_pause_id: receipt.matchedPauseId ? `rct_${receipt.matchedPauseId._id}` : null
    });
    
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ 
      error: 'fetch_failed',
      message: error.message
    });
  }
});

// =====================
// GET /v1/events - List events for publisher
// =====================
router.get('/events', authenticatePublisher, async (req, res) => {
  try {
    const { event_type, start_date, end_date, limit = 100, offset = 0 } = req.query;
    
    const filter = {
      publisherId: req.publisher.publisherId
    };
    
    if (event_type) {
      filter.eventType = event_type;
    }
    
    if (start_date || end_date) {
      filter.eventTimeUtc = {};
      if (start_date) filter.eventTimeUtc.$gte = new Date(start_date);
      if (end_date) filter.eventTimeUtc.$lte = new Date(end_date);
    }
    
    const [events, total] = await Promise.all([
      EventReceipt.find(filter)
        .sort({ eventTimeUtc: -1 })
        .skip(parseInt(offset))
        .limit(parseInt(limit))
        .lean(),
      EventReceipt.countDocuments(filter)
    ]);
    
    res.json({
      events: events.map(e => ({
        receipt_id: `rct_${e._id}`,
        event_type: e.eventType,
        event_id: e.eventId,
        event_time_utc: e.eventTimeUtc,
        ipause_opportunity_id: e.ipauseOpportunityId,
        billing_status: e.billingStatus
      })),
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: parseInt(offset) + events.length < total
      }
    });
    
  } catch (error) {
    console.error('List events error:', error);
    res.status(500).json({ 
      error: 'fetch_failed',
      message: error.message
    });
  }
});

module.exports = router;
