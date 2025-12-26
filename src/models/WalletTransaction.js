const mongoose = require('mongoose');

const WalletTransactionSchema = new mongoose.Schema({
  wallet: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', required: true },
  type: { 
    type: String, 
    enum: ['deposit', 'conversion_fee', 'refund', 'payout'], 
    required: true 
  },
  amount: { type: Number, required: true },
  balanceBefore: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  description: { type: String },
  referenceId: { type: mongoose.Schema.Types.ObjectId },
  referenceType: { type: String }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

WalletTransactionSchema.index({ wallet: 1, createdAt: -1 });

module.exports = mongoose.model('WalletTransaction', WalletTransactionSchema);
