// src/middleware/adminAuth.js

/**
 * Middleware to ensure user is an admin
 * Use after authMiddleware
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ 
      error: 'authentication_required',
      message: 'You must be logged in to access this resource'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ 
      error: 'admin_required',
      message: 'This action requires administrator privileges'
    });
  }

  next();
}

module.exports = { requireAdmin };
