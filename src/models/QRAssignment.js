// FILE: src/models/QRAssignment.js
const mongoose = require('mongoose');

const qrAssignmentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required']
  },
  qrCodeId: {
    type: String,
    required: [true, 'QR Code ID is required'],
    trim: true
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedAt: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    maxlength: 500
  }
}, {
  timestamps: true
});

// Indexes
qrAssignmentSchema.index({ userId: 1, qrCodeId: 1 }, { unique: true });
qrAssignmentSchema.index({ userId: 1 });
qrAssignmentSchema.index({ qrCodeId: 1 });
qrAssignmentSchema.index({ assignedAt: -1 });

module.exports = mongoose.model('QRAssignment', qrAssignmentSchema);
