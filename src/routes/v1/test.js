// src/routes/v1/test.js
// Test endpoints for development and integration testing
const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const EventReceipt = require('../../models/EventReceipt');
const PublisherApiKey = require('../../models/PublisherApiKey');
const IdempotencyCache = require('../../models/IdempotencyCache');

// Only enable in non-production environments
const isTestEnabled = process.env.NODE_ENV !== 'production';

// =====================
// Middleware: Check test mode
// =====================
function checkTestMode(req, res, next) {
  if (!isTestEnabled) {
    return res.status(403).json({
      error: 'test_disabled',
      message: 'Test endpoints are disabled in production'
    });
  }
  next();
}

router.use(checkTestMode);

// =====================
// POST /v1/test/setup - Create test publisher
// =====================
router.post('/test/setup', async (req, res) => {
  try {
    const testPublisherId = 'pub_test_hulu';
    
    // Check if test publisher exists
    let publisher = await PublisherApiKey.findOne({ publisherId: testPublisherId });
    
    if (!publisher) {
      // Create test publisher
      const result = await PublisherApiKey.createPublisher({
        publisherId: testPublisherId,
        publisherName: 'Hulu (Test)',
        contactEmail: 'test@hulu.com',
        contactName: 'Test Integration',
        notes: 'Auto-generated test publisher'
      });
      publisher = result.publisher;
      
      res.json({
        success: true,
        message: 'Test publisher created',
        publisher_id: publisher.publisherId,
        api_key: result.credentials.apiKey,
        webhook_secret: result.credentials.webhookSecret
      });
    } else {
      res.json({
        success: true,
        message: 'Test publisher already exists',
        publisher_id: publisher.publisherId,
        note: 'Use /v1/test/reset to get new credentials'
      });
    }
    
  } catch (error) {
    console.error('Test setup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =====================
// POST /v1/test/reset - Reset test publisher credentials
// =====================
router.post('/test/reset', async (req, res) => {
  try {
    const testPublisherId = 'pub_test_hulu';
    
    let publisher = await PublisherApiKey.findOne({ publisherId: testPublisherId });
    
    if (!publisher) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Test publisher not found. Run /v1/test/setup first'
      });
    }
    
    // Generate new credentials
    const newApiKey = PublisherApiKey.generateApiKey();
    const newWebhookSecret = PublisherApiKey.generateWebhookSecret();
    
    publisher.apiKey = newApiKey;
    publisher.webhookSecret = newWebhookSecret;
    publisher.status = 'active';
    await publisher.save();
    
    res.json({
      success: true,
      message: 'Test publisher credentials reset',
      publisher_id: publisher.publisherId,
      api_key: newApiKey,
      webhook_secret: newWebhookSecret
    });
    
  } catch (error) {
    console.error('Test reset error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =====================
// POST /v1/test/pause-impression - Generate test pause impression
// =====================
router.post('/test/pause-impression', async (req, res) => {
  try {
    const timestamp = Date.now();
    const opportunityId = req.body.ipause_opportunity_id || `opp_test_${timestamp}`;
    
    const testData = {
      event_type: 'pause_impression',
      event_version: '1.0',
      event_id: `evt_pause_${timestamp}`,
      event_time_utc: new Date().toISOString(),
      
      publisher: {
        publisher_id: req.body.publisher_id || 'pub_test_hulu',
        publisher_name: req.body.publisher_name || 'Hulu (Test)',
        app_id: 'com.hulu.test',
        supply_type: 'FAST'
      },
      
      session: {
        session_id: `sess_${timestamp}`,
        content_session_id: `content_sess_${timestamp}`,
        ipause_opportunity_id: opportunityId
      },
      
      content: {
        content_id: req.body.content_id || 'cnt_stranger_things',
        title: req.body.title || 'Stranger Things',
        series: req.body.series || 'Stranger Things',
        season: req.body.season || '4',
        episode: req.body.episode || '3',
        genre: req.body.genre || ['Sci-Fi', 'Horror'],
        rating: req.body.rating || 'TV-MA'
      },
      
      playback: {
        pause_timestamp_ms: req.body.pause_timestamp_ms || 1435000,
        is_live: req.body.is_live || false
      },
      
      ad: {
        ipause_ad_id: req.body.ipause_ad_id || 'ipa_starbucks_001',
        campaign_id: req.body.campaign_id || 'STARBUCKS-SUMMER-2024',
        brand: req.body.brand || 'Starbucks',
        creative_id: req.body.creative_id || 'cr_summer_drink',
        qr_enabled: true
      },
      
      device: {
        device_type: req.body.device_type || 'CTV',
        os: req.body.os || 'RokuOS'
      },
      
      geo: {
        country: req.body.country || 'US',
        region: req.body.region || 'CA'
      }
    };
    
    // Get test publisher API key
    const publisher = await PublisherApiKey.findOne({ publisherId: testData.publisher.publisher_id });
    
    if (!publisher) {
      return res.status(400).json({
        error: 'publisher_not_found',
        message: 'Test publisher not found. Run /v1/test/setup first'
      });
    }
    
    // Make internal request to events endpoint
    const idempotencyKey = `test_pause_${timestamp}`;
    
    // Directly create the event receipt for testing
    const receipt = await EventReceipt.create({
      eventId: testData.event_id,
      eventType: 'pause_impression',
      eventVersion: testData.event_version,
      eventTimeUtc: new Date(testData.event_time_utc),
      ipauseOpportunityId: testData.session.ipause_opportunity_id,
      publisherId: testData.publisher.publisher_id,
      publisherName: testData.publisher.publisher_name,
      appId: testData.publisher.app_id,
      supplyType: testData.publisher.supply_type,
      sessionId: testData.session.session_id,
      contentSessionId: testData.session.content_session_id,
      contentId: testData.content.content_id,
      contentTitle: testData.content.title,
      series: testData.content.series,
      season: testData.content.season,
      episode: testData.content.episode,
      genre: testData.content.genre,
      rating: testData.content.rating,
      pauseTimestampMs: testData.playback.pause_timestamp_ms,
      isLive: testData.playback.is_live,
      ipauseAdId: testData.ad.ipause_ad_id,
      campaignId: testData.ad.campaign_id,
      brand: testData.ad.brand,
      creativeId: testData.ad.creative_id,
      qrEnabled: testData.ad.qr_enabled,
      deviceType: testData.device.device_type,
      os: testData.device.os,
      country: testData.geo.country,
      region: testData.geo.region,
      rawPayload: testData,
      idempotencyKey,
      billingStatus: 'pending'
    });
    
    res.json({
      success: true,
      message: 'Test pause impression created',
      receipt_id: `rct_${receipt._id}`,
      ipause_opportunity_id: opportunityId,
      test_data: testData,
      note: 'Use the ipause_opportunity_id to create a matching conversion'
    });
    
  } catch (error) {
    console.error('Test pause impression error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =====================
// POST /v1/test/conversion - Generate test conversion
// =====================
router.post('/test/conversion', async (req, res) => {
  try {
    const { ipause_opportunity_id } = req.body;
    
    if (!ipause_opportunity_id) {
      return res.status(400).json({
        error: 'missing_field',
        message: 'ipause_opportunity_id is required'
      });
    }
    
    // Find matching pause impression
    const pauseEvent = await EventReceipt.findMatchingPause(ipause_opportunity_id);
    
    if (!pauseEvent) {
      return res.status(404).json({
        error: 'pause_not_found',
        message: 'No matching pause_impression found for this ipause_opportunity_id'
      });
    }
    
    const timestamp = Date.now();
    
    const testData = {
      event_type: 'qr_conversion',
      event_version: '1.0',
      event_id: `evt_conv_${timestamp}`,
      event_time_utc: new Date().toISOString(),
      
      publisher: {
        publisher_id: pauseEvent.publisherId
      },
      
      session: {
        ipause_opportunity_id
      },
      
      conversion: {
        conversion_type: req.body.conversion_type || 'qr_scan',
        result: req.body.result || 'success',
        qr_destination_id: req.body.qr_destination_id || 'dest_starbucks_menu'
      }
    };
    
    const idempotencyKey = `test_conv_${timestamp}`;
    
    // Create conversion receipt
    const receipt = await EventReceipt.create({
      eventId: testData.event_id,
      eventType: 'qr_conversion',
      eventVersion: testData.event_version,
      eventTimeUtc: new Date(testData.event_time_utc),
      ipauseOpportunityId: ipause_opportunity_id,
      publisherId: testData.publisher.publisher_id,
      conversionType: testData.conversion.conversion_type,
      conversionResult: testData.conversion.result,
      qrDestinationId: testData.conversion.qr_destination_id,
      rawPayload: testData,
      idempotencyKey,
      matchedPauseId: pauseEvent._id,
      billingStatus: testData.conversion.result === 'success' ? 'billable' : 'non_billable'
    });
    
    // Link conversion to pause
    pauseEvent.matchedConversionId = receipt._id;
    pauseEvent.billingStatus = testData.conversion.result === 'success' ? 'billable' : 'non_billable';
    await pauseEvent.save();
    
    res.json({
      success: true,
      message: 'Test conversion created',
      receipt_id: `rct_${receipt._id}`,
      matched_pause_id: `rct_${pauseEvent._id}`,
      ipause_opportunity_id,
      test_data: testData
    });
    
  } catch (error) {
    console.error('Test conversion error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =====================
// POST /v1/test/full-flow - Generate complete pause + conversion flow
// =====================
router.post('/test/full-flow', async (req, res) => {
  try {
    const timestamp = Date.now();
    const opportunityId = `opp_test_${timestamp}`;
    
    // Create pause impression
    const pauseData = {
      eventId: `evt_pause_${timestamp}`,
      eventType: 'pause_impression',
      eventVersion: '1.0',
      eventTimeUtc: new Date(),
      ipauseOpportunityId: opportunityId,
      publisherId: 'pub_test_hulu',
      publisherName: 'Hulu (Test)',
      appId: 'com.hulu.test',
      supplyType: 'FAST',
      sessionId: `sess_${timestamp}`,
      contentSessionId: `content_sess_${timestamp}`,
      contentId: 'cnt_test_show',
      contentTitle: req.body.title || 'Test Show',
      series: req.body.series || 'Test Series',
      season: '1',
      episode: '1',
      genre: ['Drama'],
      rating: 'TV-14',
      pauseTimestampMs: 60000,
      isLive: false,
      ipauseAdId: 'ipa_test_001',
      campaignId: req.body.campaign_id || 'TEST-CAMPAIGN-001',
      brand: 'Test Brand',
      creativeId: 'cr_test_001',
      qrEnabled: true,
      deviceType: 'CTV',
      os: 'TestOS',
      country: 'US',
      region: 'CA',
      rawPayload: {},
      idempotencyKey: `test_pause_${timestamp}`,
      billingStatus: 'pending'
    };
    
    const pauseReceipt = await EventReceipt.create(pauseData);
    
    // Create conversion (simulating user scanning QR)
    const conversionData = {
      eventId: `evt_conv_${timestamp}`,
      eventType: 'qr_conversion',
      eventVersion: '1.0',
      eventTimeUtc: new Date(Date.now() + 5000), // 5 seconds later
      ipauseOpportunityId: opportunityId,
      publisherId: 'pub_test_hulu',
      conversionType: 'qr_scan',
      conversionResult: 'success',
      qrDestinationId: 'dest_test_landing',
      rawPayload: {},
      idempotencyKey: `test_conv_${timestamp}`,
      matchedPauseId: pauseReceipt._id,
      billingStatus: 'billable'
    };
    
    const conversionReceipt = await EventReceipt.create(conversionData);
    
    // Link them
    pauseReceipt.matchedConversionId = conversionReceipt._id;
    pauseReceipt.billingStatus = 'billable';
    await pauseReceipt.save();
    
    res.json({
      success: true,
      message: 'Full test flow created (pause + conversion)',
      ipause_opportunity_id: opportunityId,
      pause_receipt_id: `rct_${pauseReceipt._id}`,
      conversion_receipt_id: `rct_${conversionReceipt._id}`,
      flow: {
        step1: 'Pause impression recorded',
        step2: 'QR code scanned (conversion)',
        step3: 'Events linked via ipause_opportunity_id',
        billing_status: 'billable'
      }
    });
    
  } catch (error) {
    console.error('Test full flow error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =====================
// GET /v1/test/stats - Get test statistics
// =====================
router.get('/test/stats', async (req, res) => {
  try {
    const [
      totalEvents,
      pauseImpressions,
      conversions,
      billableEvents,
      publishers
    ] = await Promise.all([
      EventReceipt.countDocuments(),
      EventReceipt.countDocuments({ eventType: 'pause_impression' }),
      EventReceipt.countDocuments({ eventType: 'qr_conversion' }),
      EventReceipt.countDocuments({ billingStatus: 'billable' }),
      PublisherApiKey.countDocuments()
    ]);
    
    // Calculate A2AR
    const a2ar = pauseImpressions > 0 
      ? ((conversions / pauseImpressions) * 100).toFixed(2) 
      : '0.00';
    
    res.json({
      stats: {
        total_events: totalEvents,
        pause_impressions: pauseImpressions,
        qr_conversions: conversions,
        billable_events: billableEvents,
        a2ar_percentage: a2ar,
        publishers: publishers
      },
      test_mode: isTestEnabled
    });
    
  } catch (error) {
    console.error('Test stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =====================
// DELETE /v1/test/cleanup - Clean up test data
// =====================
router.delete('/test/cleanup', async (req, res) => {
  try {
    const { confirm } = req.query;
    
    if (confirm !== 'yes') {
      return res.status(400).json({
        error: 'confirmation_required',
        message: 'Add ?confirm=yes to delete all test data'
      });
    }
    
    // Delete test events (those with test_ in idempotencyKey)
    const eventsDeleted = await EventReceipt.deleteMany({
      idempotencyKey: { $regex: /^test_/ }
    });
    
    // Clean up idempotency cache
    const cacheDeleted = await IdempotencyCache.deleteMany({
      idempotencyKey: { $regex: /^test_/ }
    });
    
    res.json({
      success: true,
      message: 'Test data cleaned up',
      deleted: {
        events: eventsDeleted.deletedCount,
        cache_entries: cacheDeleted.deletedCount
      }
    });
    
  } catch (error) {
    console.error('Test cleanup error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
