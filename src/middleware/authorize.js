// FILE: src/middleware/authorize.js

/**
 * Authorization middleware to check user roles
 * Usage: router.get('/path', auth, authorize('admin', 'manager'), handler)
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    // Check if user account is active (if status field exists)
    if (req.user.status && req.user.status !== 'active') {
      return res.status(403).json({ 
        error: 'Forbidden',
        message: 'Your account is inactive. Please contact an administrator.'
      });
    }

    // Check if user's role is in the allowed roles
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Forbidden',
        message: `Access denied. Required role: ${allowedRoles.join(' or ')}`
      });
    }

    // User is authorized
    next();
  };
};

/**
 * Check if user owns the resource or is an admin
 */
const authorizeOwnerOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  const resourceUserId = req.params.userId || req.body.userId;
  const isOwner = req.user._id.toString() === resourceUserId;
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ 
      error: 'Forbidden',
      message: 'You can only access your own resources'
    });
  }

  next();
};

module.exports = {
  authorize,
  authorizeOwnerOrAdmin
};
