const { verifyToken } = require('../services/authService');

/**
 * Optional authentication: attaches req.user if a valid token is present
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }
  next();
}

/**
 * Required authentication: rejects with 401 Unauthorized if no valid token
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: {
        message: 'Authentication required. Please provide a valid Bearer token.',
        code: 'UNAUTHORIZED',
        status: 401
      }
    });
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({
      success: false,
      error: {
        message: 'Invalid or expired session token. Please log in again.',
        code: 'INVALID_TOKEN',
        status: 401
      }
    });
  }

  req.user = decoded;
  next();
}

/**
 * Role-Based Access Control (RBAC) middleware
 * Server-side authorization check.
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          message: 'Authentication required.',
          code: 'UNAUTHORIZED',
          status: 401
        }
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          message: `Access denied. Role '${req.user.role}' is not authorized to access this resource. Required roles: ${allowedRoles.join(', ')}`,
          code: 'FORBIDDEN',
          status: 403
        }
      });
    }

    next();
  };
}

module.exports = {
  optionalAuth,
  requireAuth,
  requireRole
};
