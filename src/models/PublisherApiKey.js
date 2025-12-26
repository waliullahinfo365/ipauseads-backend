// src/models/PublisherApiKey.js
const mongoose = require('mongoose');
const crypto = require('crypto');

const PublisherApiKeySchema = new mongoose.Schema({
  // Publisher Identity
  publisherId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  publisherName: {
    type: String,
    required: true
  },

  // Contact Information
  contactName: {
    type: String,
    required: true
  },
  contactEmail: {
    type: String,
    required: true
  },
  contactPhone: String,
  companyAddress: String,

  // Platform Details
  platformType: {
    type: String,
    enum: ['CTV', 'Mobile', 'Web', 'FAST', 'Other'],
    default: 'CTV'
  },

  // API Credentials
  apiKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  webhookSecret: {
    type: String,
    required: true
  },

  // Status
  status: {
    type: String,
    enum: ['active', 'suspended', 'revoked'],
    default: 'active',
    index: true
  },

  // Tracking
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  lastUsedAt: {
    type: Date,
    default: null
  },
  requestsCount: {
    type: Number,
    default: 0
  },

  // Rate limiting
  rateLimitPerMinute: {
    type: Number,
    default: 100
  },

  // Metadata
  notes: String,
  activeCampaigns: [{
    campaignId: String,
    campaignName: String,
    status: String
  }]
}, {
  timestamps: true
});

/**
 * Generate a new API key
 */
PublisherApiKeySchema.statics.generateApiKey = function() {
  return 'pk_' + crypto.randomBytes(32).toString('hex');
};

/**
 * Generate a webhook secret
 */
PublisherApiKeySchema.statics.generateWebhookSecret = function() {
  return 'whsec_' + crypto.randomBytes(32).toString('hex');
};

/**
 * Find by API key and validate status
 */
PublisherApiKeySchema.statics.findByApiKey = async function(apiKey) {
  return this.findOne({ apiKey, status: 'active' });
};

/**
 * Record API usage
 */
PublisherApiKeySchema.methods.recordUsage = async function() {
  this.lastUsedAt = new Date();
  this.requestsCount += 1;
  return this.save();
};

/**
 * Verify webhook signature
 */
PublisherApiKeySchema.methods.verifySignature = function(timestamp, rawBody, signature) {
  if (!this.webhookSecret) return false;
  
  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', this.webhookSecret)
    .update(timestamp + '.' + rawBody)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
};

/**
 * Generate publisher ID from name
 */
PublisherApiKeySchema.statics.generatePublisherId = function(publisherName) {
  const normalized = publisherName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  
  return `pub_${normalized}`;
};

/**
 * Create a new publisher with generated credentials
 */
PublisherApiKeySchema.statics.createPublisher = async function({
  publisherId,
  publisherName,
  contactName,
  contactEmail,
  contactPhone,
  companyAddress,
  platformType,
  notes,
  activeCampaigns,
  createdBy
}) {
  const apiKey = this.generateApiKey();
  const webhookSecret = this.generateWebhookSecret();
  
  // Generate publisher ID if not provided
  const finalPublisherId = publisherId || this.generatePublisherId(publisherName);
  
  const publisher = await this.create({
    publisherId: finalPublisherId,
    publisherName,
    contactName,
    contactEmail,
    contactPhone,
    companyAddress,
    platformType: platformType || 'CTV',
    apiKey,
    webhookSecret,
    notes,
    activeCampaigns,
    createdBy
  });
  
  // Return with credentials (only shown once)
  return {
    publisher,
    credentials: {
      apiKey,
      webhookSecret
    }
  };
};

module.exports = mongoose.model('PublisherApiKey', PublisherApiKeySchema);
