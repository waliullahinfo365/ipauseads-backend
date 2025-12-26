// src/models/PublisherKeyHistory.js
const mongoose = require('mongoose');

const PublisherKeyHistorySchema = new mongoose.Schema({
  publisherId: {
    type: String,
    required: true,
    index: true
  },
  action: {
    type: String,
    enum: ['created', 'revoked', 'regenerated', 'suspended', 'activated'],
    required: true
  },
  oldApiKey: String,
  newApiKey: String,
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reason: String
}, {
  timestamps: true
});

// Compound index for efficient queries
PublisherKeyHistorySchema.index({ publisherId: 1, action: 1 });
PublisherKeyHistorySchema.index({ createdAt: -1 });

/**
 * Log a publisher key action
 */
PublisherKeyHistorySchema.statics.logAction = async function({
  publisherId,
  action,
  oldApiKey,
  newApiKey,
  performedBy,
  reason
}) {
  return this.create({
    publisherId,
    action,
    oldApiKey,
    newApiKey,
    performedBy,
    reason
  });
};

/**
 * Get history for a publisher
 */
PublisherKeyHistorySchema.statics.getHistory = async function(publisherId) {
  return this.find({ publisherId })
    .populate('performedBy', 'fullName email')
    .sort({ createdAt: -1 });
};

module.exports = mongoose.model('PublisherKeyHistory', PublisherKeyHistorySchema);
