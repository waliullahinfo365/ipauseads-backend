// src/models/PauseEvent.js
const mongoose = require('mongoose');

const PauseEventSchema = new mongoose.Schema({
  // Publisher Information
  publisher: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  appName: {
    type: String,
    trim: true
  },
  platform: {
    type: String,
    trim: true
  },

  // Session Information
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  pauseTimestamp: {
    type: Date,
    required: true,
    index: true
  },

  // Content Information
  programTitle: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  season: {
    type: Number,
    default: null
  },
  episode: {
    type: Number,
    default: null
  },
  episodeTitle: {
    type: String,
    trim: true
  },
  genre: {
    type: String,
    trim: true
  },
  rating: {
    type: String,
    trim: true
  },
  contentType: {
    type: String,
    enum: ['live', 'on-demand', 'vod'],
    default: 'on-demand'
  },

  // Playback Information
  playbackPositionMs: {
    type: Number,
    default: null
  },
  contentDurationMs: {
    type: Number,
    default: null
  },
  playbackPercentage: {
    type: Number,
    default: null
  },

  // Linking
  qrCodeId: {
    type: String,
    index: true
  },
  scanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Scan',
    index: true
  },
  advertiser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  conversionOccurred: {
    type: Boolean,
    default: false,
    index: true
  },

  // Raw Receipt Data
  rawReceipt: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for better query performance
PauseEventSchema.index({ publisher: 1, pauseTimestamp: -1 });
PauseEventSchema.index({ programTitle: 1, pauseTimestamp: -1 });
PauseEventSchema.index({ advertiser: 1, createdAt: -1 });
PauseEventSchema.index({ qrCodeId: 1, pauseTimestamp: -1 });

/**
 * Static method to get pause event statistics
 */
PauseEventSchema.statics.getStats = async function(filters = {}) {
  const match = {};
  
  if (filters.publisher) match.publisher = filters.publisher;
  if (filters.programTitle) match.programTitle = filters.programTitle;
  if (filters.advertiser) match.advertiser = filters.advertiser;
  if (filters.startDate || filters.endDate) {
    match.pauseTimestamp = {};
    if (filters.startDate) match.pauseTimestamp.$gte = new Date(filters.startDate);
    if (filters.endDate) match.pauseTimestamp.$lte = new Date(filters.endDate);
  }

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalPauses: { $sum: 1 },
        withScans: {
          $sum: { $cond: [{ $ne: ['$scanId', null] }, 1, 0] }
        },
        conversions: {
          $sum: { $cond: [{ $eq: ['$conversionOccurred', true] }, 1, 0] }
        },
        publishers: { $addToSet: '$publisher' },
        programs: { $addToSet: '$programTitle' }
      }
    },
    {
      $project: {
        _id: 0,
        totalPauses: 1,
        withScans: 1,
        conversions: 1,
        uniquePublishers: { $size: '$publishers' },
        uniquePrograms: { $size: '$programs' }
      }
    }
  ]);
};

module.exports = mongoose.model('PauseEvent', PauseEventSchema);
