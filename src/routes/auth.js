// FILE: src/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// Register (Public - for initial setup only, should be disabled in production)
router.post('/register', async (req, res) => {
  try {
    // Support both fullName and name for backward compatibility
    const { fullName, name, email, password, role } = req.body;
    const userName = fullName || name;
    
    if (!userName || !email || !password) {
      return res.status(400).json({ error: 'Full name, email and password required' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 12);
    const user = new User({ 
      fullName: userName, 
      email: email.toLowerCase(), 
      passwordHash: hash, 
      role: role || 'viewer' 
    });
    await user.save();

    const token = jwt.sign(
      { 
        id: user._id, 
        email: user.email, 
        role: user.role,
        fullName: user.fullName 
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    res.json({ 
      token, 
      user: { 
        id: user._id, 
        email: user.email, 
        fullName: user.fullName, 
        role: user.role,
        status: user.status
      } 
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if account is locked
    if (user.isLocked) {
      const lockTimeRemaining = Math.ceil((user.lockUntil - Date.now()) / 1000 / 60);
      return res.status(423).json({ 
        error: 'Account locked',
        message: `Too many failed login attempts. Please try again in ${lockTimeRemaining} minutes.`
      });
    }

    // Check if account is inactive
    if (user.status === 'inactive') {
      return res.status(403).json({ 
        error: 'Account inactive',
        message: 'Your account has been deactivated. Please contact an administrator.'
      });
    }

    // Verify password
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      // Increment login attempts
      await user.incLoginAttempts();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Reset login attempts on successful login
    if (user.loginAttempts > 0 || user.lockUntil) {
      await user.resetLoginAttempts();
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Backward compatibility: use name if fullName doesn't exist
    const displayName = user.fullName || user.name || 'User';

    // Generate token
    const token = jwt.sign(
      { 
        id: user._id, 
        email: user.email, 
        role: user.role,
        fullName: displayName,
        status: user.status || 'active'
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: '24h' }
    );

    res.json({ 
      token, 
      user: { 
        id: user._id, 
        email: user.email, 
        fullName: displayName, 
        role: user.role,
        status: user.status || 'active',
        passwordResetRequired: user.passwordResetRequired || false
      } 
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// Get current user info
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-passwordHash -passwordResetToken');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// Change own password
router.post('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash and save new password
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.passwordResetRequired = false;
    await user.save();

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

module.exports = router;