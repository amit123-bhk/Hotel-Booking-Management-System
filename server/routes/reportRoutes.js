const express = require('express');
const { getOperationsReport } = require('../services/reportingService');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/reports/operations
 */
router.get('/operations', requireAuth, requireRole('STAFF', 'ADMIN'), async (req, res, next) => {
  try {
    const { start_date, end_date } = req.query;
    const report = await getOperationsReport({
      startDate: start_date,
      endDate: end_date
    });

    res.json({
      success: true,
      data: report
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
