const mongoose = require('mongoose');

const QrCodeSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  advertiser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  destinationUrl: { type: String, required: true },
  publisher: { type: String, default: null },
  // Optional TV program / show name (for Spotlight Program column)
  program: { type: String, default: null },
  creativeId: { type: String, default: null },
  // Optional thumbnail image for Spotlight (e.g. Hulu / Netflix artwork)
  thumbnailUrl: { type: String, default: null },
  conversionFee: { type: Number, default: 5.0 },
  publisherShare: { type: Number, default: 3.0 },
  active: { type: Boolean, default: true }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

QrCodeSchema.index({ advertiser: 1, createdAt: -1 });

module.exports = mongoose.model('QrCode', QrCodeSchema);
