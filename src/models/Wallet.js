const mongoose = require('mongoose');

const WalletSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
  balance: { type: Number, default: 0.0 },
  currency: { type: String, default: 'USD' },
  brand: { type: String, default: '' },
  dailyCap: { type: Number, default: 1000.0 },
  costPerConversion: { type: Number, default: 5.0 }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

WalletSchema.index({ user: 1 });

module.exports = mongoose.model('Wallet', WalletSchema);
