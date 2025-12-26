// src/models/Scan.js
const mongoose = require('mongoose');

const ScanSchema = new mongoose.Schema({
  // QR Code Identifier
  qrId: { 
    type: String, 
    required: true,
    index: true,
    trim: true
  },
  
  // Timestamps
  timestamp: { 
    type: Date, 
    default: Date.now, 
    index: true 
  },
  createdAt: { 
    type: Date, 
    default: Date.now,
    index: true 
  },
  
  // User Identification
  ip: { 
    type: String,
    index: true
  },
  hashedIp: { 
    type: String, 
    index: true 
  },
  
  // Device Information
  userAgent: { 
    type: String,
    required: true
  },
  device: { 
    type: String,
    index: true
  },
  deviceInfo: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Referral Information
  referrer: { 
    type: String,
    index: true
  },
  
  // Publisher / Campaign metadata
  publisher: {
    type: String,
    index: true
  },
  program: {
    type: String,
    index: true
  },
  advertiser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  creativeId: {
    type: String,
    index: true
  },
  thumbnailUrl: {
    type: String,
    default: null
  },
  
  // Conversion Tracking
  conversion: { 
    type: Boolean, 
    default: false, 
    index: true 
  },
  conversionAction: { 
    type: String, 
    enum: ['Button Click', 'Form Submit', 'Page View', 'Download', 'Purchase', 'Signup', null], 
    default: null 
  },
  convertedAt: {
    type: Date,
    index: true
  },
  conversionFee: {
    type: Number,
    default: 0
  },
  orderId: {
    type: String,
    index: true
  },
  orderAmount: {
    type: Number,
    default: 0
  },
  verified: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // Campaign Tracking
  campaignId: {
    type: String,
    index: true
  },
  source: {
    type: String,
    index: true
  },
  medium: {
    type: String,
    index: true
  },
  
  // Additional Metadata
  meta: { 
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
ScanSchema.index({ qrId: 1, timestamp: -1 });
ScanSchema.index({ 'deviceInfo.os': 1, 'deviceInfo.browser': 1 });
ScanSchema.index({ createdAt: -1 });

/**
 * Pre-save hook to hash IP address for privacy
 */
ScanSchema.pre('save', async function(next) {
  if (this.ip) {
    const crypto = require('crypto');
    this.hashedIp = crypto.createHash('sha256')
      .update(this.ip + process.env.IP_SALT || 'default-salt')
      .digest('hex');
  }
  
  // Update convertedAt when conversion is set to true
  if (this.isModified('conversion') && this.conversion && !this.convertedAt) {
    this.convertedAt = new Date();
  }
  
  next();
});

/**
 * Static method to get scan statistics
 */
ScanSchema.statics.getStats = async function(qrId, startDate, endDate) {
  const match = { qrId };
  
  if (startDate || endDate) {
    match.timestamp = {};
    if (startDate) match.timestamp.$gte = new Date(startDate);
    if (endDate) match.timestamp.$lte = new Date(endDate);
  }
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalScans: { $sum: 1 },
        uniqueDevices: { $addToSet: '$hashedIp' },
        conversions: {
          $sum: { $cond: [{ $eq: ['$conversion', true] }, 1, 0] }
        },
        devices: {
          $push: {
            $cond: [
              { $ifNull: ['$deviceInfo.deviceType', false] },
              '$deviceInfo.deviceType',
              'unknown'
            ]
          }
        }
      }
    },
    {
      $project: {
        _id: 0,
        totalScans: 1,
        uniqueDevices: { $size: '$uniqueDevices' },
        conversionRate: {
          $cond: [
            { $eq: ['$totalScans', 0] },
              0,
              { $divide: ['$conversions', '$totalScans'] }
          ]
        },
        deviceBreakdown: {
          $reduce: {
            input: '$devices',
            initialValue: {},
            in: {
              $mergeObjects: [
                '$$value',
                {
                  $let: {
                    vars: { device: '$$this' },
                    in: {
                      $arrayToObject: [
                        [
                          {
                            k: '$$device',
                            v: {
                              $add: [
                                { $ifNull: [{ $arrayElemAt: [{ $objectToArray: '$$value' }, 0] }, 0] },
                                1
                              ]
                            }
                          }
                        ]
                      ]
                    }
                  }
                }
              ]
            }
          }
        }
      }
    }
  ]);
};

module.exports = mongoose.model('Scan', ScanSchema);
