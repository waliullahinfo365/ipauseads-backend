// src/routes/v1/publishers.js
const express = require('express');
const router = express.Router();
const PublisherApiKey = require('../../models/PublisherApiKey');
const PublisherKeyHistory = require('../../models/PublisherKeyHistory');
const EventReceipt = require('../../models/EventReceipt');

// Import auth middleware
const auth = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/adminAuth');


// =====================
// POST /v1/admin/publishers - Create new publisher
// =====================
router.post('/admin/publishers', auth, requireAdmin, async (req, res) => {
  try {
    const { 
      publisher_id, 
      publisher_name, 
      contact_name,
      contact_email, 
      contact_phone,
      company_address,
      platform_type,
      notes,
      active_campaigns
    } = req.body;
    
    // Validate required fields
    if (!publisher_name || !contact_name || !contact_email) {
      return res.status(400).json({ 
        error: 'missing_required_fields',
        message: 'publisher_name, contact_name, and contact_email are required'
      });
    }
    
    // Generate or validate publisher_id
    const finalPublisherId = publisher_id || PublisherApiKey.generatePublisherId(publisher_name);
    
    // Check if publisher already exists
    const existing = await PublisherApiKey.findOne({ publisherId: finalPublisherId });
    if (existing) {
      return res.status(409).json({ 
        error: 'publisher_exists',
        message: `Publisher with ID "${finalPublisherId}" already exists`
      });
    }
    
    // Check if email already exists
    const existingEmail = await PublisherApiKey.findOne({ contactEmail: contact_email });
    if (existingEmail) {
      return res.status(409).json({ 
        error: 'email_exists',
        message: 'A publisher with this email address already exists'
      });
    }
    
    // Create publisher with generated credentials
    const { publisher, credentials } = await PublisherApiKey.createPublisher({
      publisherId: finalPublisherId,
      publisherName: publisher_name,
      contactName: contact_name,
      contactEmail: contact_email,
      contactPhone: contact_phone,
      companyAddress: company_address,
      platformType: platform_type || 'CTV',
      notes,
      activeCampaigns: active_campaigns,
      createdBy: req.user.id
    });
    
    // Log the creation
    await PublisherKeyHistory.logAction({
      publisherId: finalPublisherId,
      action: 'created',
      newApiKey: credentials.apiKey,
      performedBy: req.user.id,
      reason: 'Initial publisher creation'
    });
    
    res.status(201).json({
      success: true,
      message: 'Publisher created successfully',
      publisher: {
        id: publisher._id,
        publisher_id: publisher.publisherId,
        publisher_name: publisher.publisherName,
        contact_name: publisher.contactName,
        contact_email: publisher.contactEmail,
        contact_phone: publisher.contactPhone,
        company_address: publisher.companyAddress,
        platform_type: publisher.platformType,
        status: publisher.status,
        created_at: publisher.createdAt
      },
      credentials: {
        api_key: credentials.apiKey,
        webhook_secret: credentials.webhookSecret
      },
      warning: 'Store these credentials securely. They will not be shown again.'
    });
    
  } catch (error) {
    console.error('Publisher creation error:', error);
    res.status(500).json({ 
      error: 'creation_failed',
      message: error.message
    });
  }
});

// =====================
// GET /v1/admin/publishers - List all publishers
// =====================
router.get('/admin/publishers', auth, requireAdmin, async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50, include_revoked = 'false' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const filter = {};
    if (status) {
      filter.status = status;
    } else if (include_revoked !== 'true') {
      // By default, exclude revoked publishers unless explicitly requested
      filter.status = { $ne: 'revoked' };
    }
    
    // Search by name, ID, or email
    if (search) {
      filter.$or = [
        { publisherName: { $regex: search, $options: 'i' } },
        { publisherId: { $regex: search, $options: 'i' } },
        { contactEmail: { $regex: search, $options: 'i' } }
      ];
    }
    
    const [publishers, total] = await Promise.all([
      PublisherApiKey.find(filter)
        .select('-apiKey -webhookSecret')
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(parseInt(limit))
        .lean(),
      PublisherApiKey.countDocuments(filter)
    ]);
    
    res.json({
      publishers: publishers.map(p => ({
        id: p._id,
        publisher_id: p.publisherId,
        publisher_name: p.publisherName,
        contact_name: p.contactName,
        contact_email: p.contactEmail,
        contact_phone: p.contactPhone,
        platform_type: p.platformType,
        status: p.status,
        requests_count: p.requestsCount,
        last_used_at: p.lastUsedAt,
        created_at: p.createdAt,
        notes: p.notes
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
        has_more: offset + publishers.length < total
      }
    });
    
  } catch (error) {
    console.error('Publishers fetch error:', error);
    res.status(500).json({ 
      error: 'fetch_failed',
      message: error.message
    });
  }
});

// =====================
// GET /v1/admin/publishers/:publisherId - Get publisher details (includes credentials)
// =====================
router.get('/admin/publishers/:publisherId', auth, requireAdmin, async (req, res) => {
  try {
    const { publisherId } = req.params;
    
    // Include credentials for admin view
    const publisher = await PublisherApiKey.findOne({ publisherId }).lean();
    
    if (!publisher) {
      return res.status(404).json({ 
        error: 'not_found',
        message: 'Publisher not found'
      });
    }
    
    // Get event stats
    const stats = await EventReceipt.getPublisherStats(publisherId, 30);
    const eventStats = {
      pause_impressions: 0,
      qr_conversions: 0
    };
    stats.forEach(s => {
      if (s._id === 'pause_impression') eventStats.pause_impressions = s.count;
      if (s._id === 'qr_conversion') eventStats.qr_conversions = s.count;
    });
    
    res.json({
      publisher: {
        id: publisher._id,
        publisher_id: publisher.publisherId,
        publisher_name: publisher.publisherName,
        contact_name: publisher.contactName,
        contact_email: publisher.contactEmail,
        contact_phone: publisher.contactPhone,
        company_address: publisher.companyAddress,
        platform_type: publisher.platformType,
        api_key: publisher.apiKey,
        webhook_secret: publisher.webhookSecret,
        status: publisher.status,
        rate_limit_per_minute: publisher.rateLimitPerMinute,
        requests_count: publisher.requestsCount,
        last_used_at: publisher.lastUsedAt,
        created_at: publisher.createdAt,
        notes: publisher.notes,
        active_campaigns: publisher.activeCampaigns
      },
      stats_30d: eventStats
    });
    
  } catch (error) {
    console.error('Publisher fetch error:', error);
    res.status(500).json({ 
      error: 'fetch_failed',
      message: error.message
    });
  }
});

// =====================
// PUT /v1/admin/publishers/:publisherId - Update publisher
// =====================
router.put('/admin/publishers/:publisherId', auth, requireAdmin, async (req, res) => {
  try {
    const { publisherId } = req.params;
    const { 
      publisher_name, 
      contact_name,
      contact_email, 
      contact_phone,
      company_address,
      platform_type,
      rate_limit_per_minute, 
      notes,
      active_campaigns
    } = req.body;
    
    const publisher = await PublisherApiKey.findOne({ publisherId });
    
    if (!publisher) {
      return res.status(404).json({ 
        error: 'not_found',
        message: 'Publisher not found'
      });
    }
    
    // Update allowed fields
    if (publisher_name !== undefined) publisher.publisherName = publisher_name;
    if (contact_name !== undefined) publisher.contactName = contact_name;
    if (contact_email !== undefined) publisher.contactEmail = contact_email;
    if (contact_phone !== undefined) publisher.contactPhone = contact_phone;
    if (company_address !== undefined) publisher.companyAddress = company_address;
    if (platform_type !== undefined) publisher.platformType = platform_type;
    if (rate_limit_per_minute !== undefined) publisher.rateLimitPerMinute = rate_limit_per_minute;
    if (notes !== undefined) publisher.notes = notes;
    if (active_campaigns !== undefined) publisher.activeCampaigns = active_campaigns;
    
    await publisher.save();
    
    res.json({
      success: true,
      message: 'Publisher updated successfully',
      publisher: {
        id: publisher._id,
        publisher_id: publisher.publisherId,
        publisher_name: publisher.publisherName,
        status: publisher.status,
        updated_at: publisher.updatedAt
      }
    });
    
  } catch (error) {
    console.error('Publisher update error:', error);
    res.status(500).json({ 
      error: 'update_failed',
      message: error.message
    });
  }
});

// =====================
// POST /v1/admin/publishers/:publisherId/regenerate-key - Regenerate API key
// =====================
router.post('/admin/publishers/:publisherId/regenerate-key', auth, requireAdmin, async (req, res) => {
  try {
    const { publisherId } = req.params;
    const { reason } = req.body;
    
    const publisher = await PublisherApiKey.findOne({ publisherId });
    
    if (!publisher) {
      return res.status(404).json({ 
        error: 'not_found',
        message: 'Publisher not found'
      });
    }
    
    const oldApiKey = publisher.apiKey;
    
    // Generate new API key
    const newApiKey = PublisherApiKey.generateApiKey();
    publisher.apiKey = newApiKey;
    await publisher.save();
    
    // Log the action
    await PublisherKeyHistory.logAction({
      publisherId,
      action: 'regenerated',
      oldApiKey,
      newApiKey,
      performedBy: req.user.id,
      reason: reason || 'Manual regeneration'
    });
    
    res.json({
      success: true,
      message: 'API key regenerated successfully',
      new_api_key: newApiKey,
      warning: 'The old API key has been invalidated. Update your integration immediately.'
    });
    
  } catch (error) {
    console.error('API key regeneration error:', error);
    res.status(500).json({ 
      error: 'regeneration_failed',
      message: error.message
    });
  }
});

// =====================
// PATCH /v1/admin/publishers/:publisherId/status - Update publisher status
// =====================
router.patch('/admin/publishers/:publisherId/status', auth, requireAdmin, async (req, res) => {
  try {
    const { publisherId } = req.params;
    const { status, reason } = req.body;
    
    if (!['active', 'suspended', 'revoked'].includes(status)) {
      return res.status(400).json({
        error: 'invalid_status',
        message: 'Status must be active, suspended, or revoked'
      });
    }
    
    const publisher = await PublisherApiKey.findOne({ publisherId });
    
    if (!publisher) {
      return res.status(404).json({ 
        error: 'not_found',
        message: 'Publisher not found'
      });
    }
    
    const oldStatus = publisher.status;
    publisher.status = status;
    await publisher.save();
    
    // Log the action
    await PublisherKeyHistory.logAction({
      publisherId,
      action: status === 'active' ? 'activated' : status,
      performedBy: req.user.id,
      reason: reason || `Status changed from ${oldStatus} to ${status}`
    });
    
    res.json({
      success: true,
      message: `Publisher status updated to ${status}`
    });
    
  } catch (error) {
    console.error('Status update error:', error);
    res.status(500).json({ 
      error: 'update_failed',
      message: error.message
    });
  }
});

// =====================
// DELETE /v1/admin/publishers/:publisherId - Revoke/Delete publisher
// =====================
router.delete('/admin/publishers/:publisherId', auth, requireAdmin, async (req, res) => {
  try {
    const { publisherId } = req.params;
    const { reason, hard_delete = false } = req.body || {};
    
    const publisher = await PublisherApiKey.findOne({ publisherId });
    
    if (!publisher) {
      return res.status(404).json({ 
        error: 'not_found',
        message: 'Publisher not found'
      });
    }
    
    if (hard_delete) {
      // Hard delete (use with caution)
      await PublisherApiKey.deleteOne({ publisherId });
    } else {
      // Soft delete - set status to revoked
      publisher.status = 'revoked';
      await publisher.save();
      
      // Log the action
      await PublisherKeyHistory.logAction({
        publisherId,
        action: 'revoked',
        performedBy: req.user.id,
        reason: reason || 'Publisher deleted'
      });
    }
    
    res.json({
      success: true,
      message: hard_delete ? 'Publisher permanently deleted' : 'Publisher revoked successfully'
    });
    
  } catch (error) {
    console.error('Publisher deletion error:', error);
    res.status(500).json({ 
      error: 'deletion_failed',
      message: error.message
    });
  }
});

// =====================
// GET /v1/admin/publishers/:publisherId/history - Get key change history
// =====================
router.get('/admin/publishers/:publisherId/history', auth, requireAdmin, async (req, res) => {
  try {
    const { publisherId } = req.params;
    
    const history = await PublisherKeyHistory.getHistory(publisherId);
    
    res.json({ 
      history: history.map(h => ({
        id: h._id,
        action: h.action,
        performed_by: h.performedBy ? {
          id: h.performedBy._id,
          name: h.performedBy.fullName,
          email: h.performedBy.email
        } : null,
        reason: h.reason,
        created_at: h.createdAt
      }))
    });
    
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ 
      error: 'fetch_failed',
      message: error.message
    });
  }
});

// =====================
// GET /v1/admin/publishers/:publisherId/stats - Get usage statistics
// =====================
router.get('/admin/publishers/:publisherId/stats', auth, requireAdmin, async (req, res) => {
  try {
    const { publisherId } = req.params;
    const { days = 30 } = req.query;
    
    // Get event stats by day
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    
    const dailyStats = await EventReceipt.aggregate([
      {
        $match: {
          publisherId,
          eventTimeUtc: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$eventTimeUtc' } },
            eventType: '$eventType'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          events: {
            $push: {
              type: '$_id.eventType',
              count: '$count'
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Format daily stats
    const formattedStats = dailyStats.map(day => {
      const result = { date: day._id, pause_impressions: 0, qr_conversions: 0 };
      day.events.forEach(e => {
        if (e.type === 'pause_impression') result.pause_impressions = e.count;
        if (e.type === 'qr_conversion') result.qr_conversions = e.count;
      });
      return result;
    });
    
    res.json({
      daily_stats: formattedStats,
      period_days: parseInt(days)
    });
    
  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ 
      error: 'fetch_failed',
      message: error.message
    });
  }
});

module.exports = router;
