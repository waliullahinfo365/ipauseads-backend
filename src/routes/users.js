// FILE: src/routes/users.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const QRAssignment = require('../models/QRAssignment');
const auth = require('../middleware/auth');
const { authorize, authorizeOwnerOrAdmin } = require('../middleware/authorize');

// Helper function to generate secure password
const generatePassword = () => {
  const length = 12;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
};

// GET /api/users - Get all users (Admin and Manager only)
router.get('/', auth, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', role = '', status = '', sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    // Build query
    const query = {};
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (role && role !== 'all') {
      query.role = role;
    }
    if (status && status !== 'all') {
      query.status = status;
    }

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const users = await User.find(query)
      .select('-passwordHash -passwordResetToken')
      .populate('createdBy', 'fullName email')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      users,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// GET /api/users/:id - Get single user (Admin, Manager, or own profile)
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check authorization
    if (req.user.role !== 'admin' && req.user.role !== 'manager' && req.user._id.toString() !== id) {
      return res.status(403).json({ error: 'Forbidden', message: 'You can only view your own profile' });
    }

    const user = await User.findById(id)
      .select('-passwordHash -passwordResetToken')
      .populate('createdBy', 'fullName email');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// POST /api/users - Create new user (Admin only)
router.post('/', auth, authorize('admin'), async (req, res) => {
  try {
    const { fullName, email, phone, role, status, sendEmail = true } = req.body;

    // Validation
    if (!fullName || !email || !role) {
      return res.status(400).json({ error: 'Full name, email, and role are required' });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    // Generate secure password
    const generatedPassword = generatePassword();
    const passwordHash = await bcrypt.hash(generatedPassword, 12);

    // Create user
    const user = new User({
      fullName,
      email: email.toLowerCase(),
      phone,
      role,
      status: status || 'active',
      passwordHash,
      passwordResetRequired: true,
      createdBy: req.user._id
    });

    await user.save();

    // TODO: Send email with credentials if sendEmail is true
    // This would be implemented with nodemailer or similar

    // Return user without sensitive data
    const userResponse = user.toObject();
    delete userResponse.passwordHash;
    delete userResponse.passwordResetToken;

    res.status(201).json({
      user: userResponse,
      generatedPassword: generatedPassword, // Send password in response for admin to share
      message: 'User created successfully'
    });
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// PUT /api/users/:id - Update user (Admin only, or own profile for basic fields)
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, email, phone, role, status, profilePicture } = req.body;

    // Check authorization
    const isAdmin = req.user.role === 'admin';
    const isOwnProfile = req.user._id.toString() === id;

    if (!isAdmin && !isOwnProfile) {
      return res.status(403).json({ error: 'Forbidden', message: 'You can only update your own profile' });
    }

    // Find user
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update fields
    if (fullName) user.fullName = fullName;
    if (phone !== undefined) user.phone = phone;
    if (profilePicture !== undefined) user.profilePicture = profilePicture;

    // Only admin can update these fields
    if (isAdmin) {
      if (email) {
        // Check if new email already exists
        const existingUser = await User.findOne({ email: email.toLowerCase(), _id: { $ne: id } });
        if (existingUser) {
          return res.status(400).json({ error: 'Email already exists' });
        }
        user.email = email.toLowerCase();
      }
      if (role) user.role = role;
      if (status) user.status = status;
    }

    await user.save();

    // Return user without sensitive data
    const userResponse = user.toObject();
    delete userResponse.passwordHash;
    delete userResponse.passwordResetToken;

    res.json({
      user: userResponse,
      message: 'User updated successfully'
    });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// DELETE /api/users/:id - Delete user (Admin only)
router.delete('/:id', auth, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting own account
    const currentUserId = req.user._id || req.user.id;
    if (currentUserId && currentUserId.toString() === id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete user's QR assignments
    await QRAssignment.deleteMany({ userId: id });

    // Delete user
    await User.findByIdAndDelete(id);

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// POST /api/users/:id/reset-password - Reset user password (Admin only)
router.post('/:id/reset-password', auth, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { sendEmail = true, customPassword } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate or use custom password
    const newPassword = customPassword || generatePassword();
    const passwordHash = await bcrypt.hash(newPassword, 12);

    user.passwordHash = passwordHash;
    user.passwordResetRequired = true;
    user.loginAttempts = 0;
    user.lockUntil = null;

    await user.save();

    // TODO: Send email with new password if sendEmail is true

    res.json({
      message: 'Password reset successfully',
      newPassword: newPassword // Send password in response for admin to share
    });
  } catch (err) {
    console.error('Error resetting password:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// POST /api/users/:id/toggle-status - Toggle user status (Admin only)
router.post('/:id/toggle-status', auth, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deactivating own account
    if (req.user._id.toString() === id) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.status = user.status === 'active' ? 'inactive' : 'active';
    await user.save();

    res.json({
      message: `User ${user.status === 'active' ? 'activated' : 'deactivated'} successfully`,
      status: user.status
    });
  } catch (err) {
    console.error('Error toggling user status:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// GET /api/users/:id/qr-assignments - Get user's QR assignments
router.get('/:id/qr-assignments', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Check authorization
    if (req.user.role !== 'admin' && req.user._id.toString() !== id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const assignments = await QRAssignment.find({ userId: id })
      .populate('assignedBy', 'fullName email')
      .sort({ assignedAt: -1 });

    res.json(assignments);
  } catch (err) {
    console.error('Error fetching QR assignments:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// POST /api/users/:id/qr-assignments - Assign QR code to user (Admin only)
router.post('/:id/qr-assignments', auth, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { qrCodeId, notes } = req.body;

    if (!qrCodeId) {
      return res.status(400).json({ error: 'QR Code ID is required' });
    }

    // Check if user exists
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if assignment already exists
    const existingAssignment = await QRAssignment.findOne({ userId: id, qrCodeId });
    if (existingAssignment) {
      return res.status(400).json({ error: 'QR Code already assigned to this user' });
    }

    // Create assignment
    const assignment = new QRAssignment({
      userId: id,
      qrCodeId,
      assignedBy: req.user._id,
      notes
    });

    await assignment.save();

    res.status(201).json({
      assignment,
      message: 'QR Code assigned successfully'
    });
  } catch (err) {
    console.error('Error assigning QR code:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

// DELETE /api/users/:userId/qr-assignments/:assignmentId - Remove QR assignment (Admin only)
router.delete('/:userId/qr-assignments/:assignmentId', auth, authorize('admin'), async (req, res) => {
  try {
    const { userId, assignmentId } = req.params;

    const assignment = await QRAssignment.findOneAndDelete({
      _id: assignmentId,
      userId: userId
    });

    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    res.json({ message: 'QR assignment removed successfully' });
  } catch (err) {
    console.error('Error removing QR assignment:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
  }
});

module.exports = router;
