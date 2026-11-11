const express = require('express');
const { authenticate, register, generateToken, getUserById } = require('../services/authService');
const { requireAuth } = require('../middleware/auth');
const { createRateLimiter, verifyHumanSubmission } = require('../middleware/rateLimiter');
const { col } = require('../db/database');

const router = express.Router();
const authRateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxRequests: 60 });

/**
 * POST /api/auth/login
 */
router.post('/login', authRateLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: { message: 'Email and password are required', status: 400 }
      });
    }

    const authResult = await authenticate(email, password);
    if (!authResult) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid email or password credentials', status: 401 }
      });
    }

    res.json({
      success: true,
      data: authResult
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/register
 */
router.post('/register', authRateLimiter, verifyHumanSubmission, async (req, res, next) => {
  try {
    const { email, password, fullName, phone } = req.body;
    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        error: { message: 'Email, password, and full name are required', status: 400 }
      });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(email).trim())) {
      return res.status(400).json({
        success: false,
        error: { message: 'Please provide a valid email address', status: 400 }
      });
    }

    const regResult = await register({ email, password, fullName, phone });
    res.status(201).json({
      success: true,
      data: regResult
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found', status: 404 }
      });
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.full_name,
          role: user.role,
          phone: user.phone,
          created_at: user.created_at
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/demo-switch
 */
router.post('/demo-switch', async (req, res, next) => {
  try {
    const { role } = req.body;
    const targetRole = (role || 'GUEST').toUpperCase();

    let targetEmail;
    if (targetRole === 'ADMIN') targetEmail = 'admin@grandhorizon.com';
    else if (targetRole === 'STAFF') targetEmail = 'staff@grandhorizon.com';
    else targetEmail = 'guest@example.com';

    const user = await col('users').findOne({ email: targetEmail });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: `Demo user for role ${targetRole} not found`, status: 404 }
      });
    }

    const token = generateToken(user);
    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.full_name,
          role: user.role,
          phone: user.phone
        },
        token
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
