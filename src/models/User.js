// FILE: src/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Basic Information
  fullName: { 
    type: String, 
    required: false, // Not required for backward compatibility with old users
    trim: true,
    minlength: [3, 'Name must be at least 3 characters'],
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  // Legacy field for backward compatibility
  name: {
    type: String,
    trim: true
  },
  email: { 
    type: String, 
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
  },
  phone: { 
    type: String,
    trim: true,
    match: [/^[\d\s\-\+\(\)]+$/, 'Please provide a valid phone number']
  },
  
  // Authentication
  passwordHash: { 
    type: String, 
    required: [true, 'Password is required']
  },
  passwordResetRequired: {
    type: Boolean,
    default: false
  },
  passwordResetToken: String,
  passwordResetExpires: Date,
  
  // Authorization
  role: { 
    type: String, 
    enum: {
      values: ['admin', 'manager', 'sales_person', 'viewer'],
      message: '{VALUE} is not a valid role'
    },
    default: 'viewer',
    required: true
  },
  
  // Status
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  
  // Profile
  profilePicture: {
    type: String,
    default: null
  },
  
  // Tracking
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  lastLogin: {
    type: Date,
    default: null
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date,
    default: null
  },
  
  // Timestamps
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
}, {
  timestamps: true
});

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });
userSchema.index({ createdAt: -1 });

// Virtual for account locked status
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Methods
userSchema.methods.incLoginAttempts = function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }
  // Otherwise increment
  const updates = { $inc: { loginAttempts: 1 } };
  // Lock the account after 5 failed attempts for 15 minutes
  const maxAttempts = 5;
  const lockTime = 15 * 60 * 1000; // 15 minutes
  
  if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + lockTime };
  }
  return this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 }
  });
};

// Ensure virtuals are included in JSON
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('User', userSchema);