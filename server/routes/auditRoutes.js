const express = require('express');
const { getAuditLogs } = require('../services/auditService');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/audit
 */
router.get('/', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { limit, offset, action, entity_type } = req.query;
    const logs = await getAuditLogs({
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
      action: action || null,
      entityType: entity_type || null
    });

    res.json({
      success: true,
      data: logs
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
