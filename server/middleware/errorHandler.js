/**
 * Centralized error handling middleware
 */
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = err.message || 'An internal server error occurred';

  if (status >= 500) {
    console.error('[SERVER ERROR]', err);
  }

  res.status(status).json({
    success: false,
    error: {
      message,
      code: err.code || (status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : status === 400 ? 'BAD_REQUEST' : status === 403 ? 'FORBIDDEN' : status === 401 ? 'UNAUTHORIZED' : 'INTERNAL_ERROR'),
      status
    }
  });
}

module.exports = { errorHandler };
