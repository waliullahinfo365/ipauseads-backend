const mongoose = require('mongoose');

const BillingRecordSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  scan: { type: mongoose.Schema.Types.ObjectId, ref: 'Scan', required: true },
  qrCodeId: { type: String, required: true },
  publisher: { type: String },
  creativeId: { type: String },
  conversionFee: { type: Number, required: true },
  publisherShare: { type: Number, default: 0.0 },
  ipauseCut: { type: Number, default: 0.0 },
  verified: { type: Boolean, default: true },
  orderId: { type: String },
  orderAmount: { type: Number },
  billedAt: { type: Date, default: Date.now }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

BillingRecordSchema.index({ user: 1, billedAt: -1 });

module.exports = mongoose.model('BillingRecord', BillingRecordSchema);
