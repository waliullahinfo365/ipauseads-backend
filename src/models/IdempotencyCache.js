// src/models/IdempotencyCache.js
const mongoose = require('mongoose');

const IdempotencyCacheSchema = new mongoose.Schema({
  idempotencyKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  receiptId: {
    type: String,
    required: true
  },
  responsePayload: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  }
}, {
  timestamps: true
});

// TTL index to automatically delete expired entries
IdempotencyCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Check if a request was already processed
 */
IdempotencyCacheSchema.statics.checkDuplicate = async function(idempotencyKey) {
  const cached = await this.findOne({
    idempotencyKey,
    expiresAt: { $gt: new Date() }
  });
  
  return cached ? cached.responsePayload : null;
};

/**
 * Cache a response for idempotency
 */
IdempotencyCacheSchema.statics.cacheResponse = async function(idempotencyKey, receiptId, responsePayload, ttlHours = 24) {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + ttlHours);
  
  return this.create({
    idempotencyKey,
    receiptId,
    responsePayload,
    expiresAt
  });
};

/**
 * Clean up expired entries (backup for TTL index)
 */
IdempotencyCacheSchema.statics.cleanupExpired = async function() {
  return this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
};

module.exports = mongoose.model('IdempotencyCache', IdempotencyCacheSchema);
