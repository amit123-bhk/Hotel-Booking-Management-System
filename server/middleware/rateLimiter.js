/**
 * Lightweight In-Memory IP Rate Limiter & Bot Honeypot Protection
 * Protects authentication, reservation holds, and inquiry endpoints from spam bursts.
 */

const buckets = new Map();

function createRateLimiter({ windowMs = 60 * 1000, maxRequests = 30, message = 'Too many requests. Please wait a moment and try again.' } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
    const key = `${req.baseUrl}${req.path}:${ip}`;
    const now = Date.now();

    let record = buckets.get(key);
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };
      buckets.set(key, record);
    }

    record.count += 1;
    if (record.count > maxRequests) {
      const retrySeconds = Math.ceil((record.resetAt - now) / 1000);
      res.set('Retry-After', String(retrySeconds));
      return res.status(429).json({
        success: false,
        error: {
          message,
          code: 'RATE_LIMITED',
          status: 429
        }
      });
    }

    next();
  };
}

/**
 * Reject automated bot submissions that populate hidden honeypot fields
 * or submit impossibly fast (< 500ms) when client timing token is present.
 */
function verifyHumanSubmission(req, res, next) {
  const { honeypot_website, form_loaded_at } = req.body || {};

  if (honeypot_website && String(honeypot_website).trim() !== '') {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Submission rejected by automated spam protection.',
        code: 'SPAM_DETECTED',
        status: 400
      }
    });
  }

  if (form_loaded_at !== undefined && form_loaded_at !== null) {
    const elapsedMs = Date.now() - Number(form_loaded_at);
    if (!Number.isNaN(elapsedMs) && elapsedMs < 400) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Form submitted too quickly. Please verify your inputs and submit again.',
          code: 'BOT_TIMING_CHECK',
          status: 400
        }
      });
    }
  }

  next();
}

module.exports = {
  createRateLimiter,
  verifyHumanSubmission
};
