import logService from '../services/logService.js';

/**
 * Middleware to require admin privileges
 * Must be used after authenticateToken middleware
 */
export const requireAdmin = (req, res, next) => {
  try {
    // Check if user is authenticated (should be set by authenticateToken middleware)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // Check if user has admin privileges
    if (!req.user.isAdmin) {
      logService.warn('Non-admin user attempted to access admin route', {
        userId: req.user.id,
        email: req.user.email,
        route: req.originalUrl,
        method: req.method,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }

    // Log admin access for security auditing
    logService.info('Admin access granted', {
      adminId: req.user.id,
      email: req.user.email,
      route: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    next();
  } catch (error) {
    logService.error('Error in admin authentication middleware:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

/**
 * Middleware to optionally check admin privileges
 * Adds isAdmin flag to request but doesn't block non-admins
 */
export const checkAdmin = (req, res, next) => {
  try {
    req.isAdmin = req.user && req.user.isAdmin;
    next();
  } catch (error) {
    logService.error('Error in admin check middleware:', error);
    req.isAdmin = false;
    next();
  }
};

export default {
  requireAdmin,
  checkAdmin
};