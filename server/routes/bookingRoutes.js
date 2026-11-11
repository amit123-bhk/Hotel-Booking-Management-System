const express = require('express');
const {
  createHold,
  confirmBooking,
  cancelBooking,
  checkInGuest,
  checkOutGuest,
  getBookingByReference,
  listBookings,
  getGuestBookings
} = require('../services/bookingService');
const { searchAvailability } = require('../services/availabilityService');
const { calculateStayPricing } = require('../services/pricingService');
const { optionalAuth, requireAuth, requireRole } = require('../middleware/auth');
const { createRateLimiter, verifyHumanSubmission } = require('../middleware/rateLimiter');

const router = express.Router();
const holdRateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxRequests: 60 });

/**
 * GET /api/bookings/search
 */
router.get('/search', async (req, res, next) => {
  try {
    const { check_in, check_out, adults, children, room_type_id } = req.query;
    const result = await searchAvailability({
      checkIn: check_in,
      checkOut: check_out,
      adults: adults || 1,
      children: children || 0,
      roomTypeId: room_type_id || null
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/bookings/price-quote
 */
router.post('/price-quote', async (req, res, next) => {
  try {
    const { room_type_id, check_in, check_out, selected_add_ons } = req.body;
    const pricing = await calculateStayPricing({
      roomTypeId: room_type_id,
      checkIn: check_in,
      checkOut: check_out,
      selectedAddOnIds: selected_add_ons || []
    });

    res.json({
      success: true,
      data: pricing
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/bookings/hold
 */
router.post('/hold', holdRateLimiter, verifyHumanSubmission, optionalAuth, async (req, res, next) => {
  try {
    const {
      room_type_id,
      check_in,
      check_out,
      num_adults,
      num_children,
      guest_name,
      guest_email,
      guest_phone,
      selected_add_ons,
      special_requests,
      utm
    } = req.body;

    const hold = await createHold({
      roomTypeId: room_type_id,
      checkIn: check_in,
      checkOut: check_out,
      numAdults: num_adults || 1,
      numChildren: num_children || 0,
      guestName: guest_name,
      guestEmail: guest_email,
      guestPhone: guest_phone,
      selectedAddOns: selected_add_ons || [],
      specialRequests: special_requests || '',
      utm: utm || null,
      userId: req.user ? req.user.id : null,
      actor: req.user
    });

    res.status(201).json({
      success: true,
      data: hold
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/bookings/confirm
 */
router.post('/confirm', optionalAuth, async (req, res, next) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotency_key || null;
    const {
      booking_reference,
      payment_method,
      card_number,
      card_exp,
      card_cvv,
      billing_name
    } = req.body;

    if (!booking_reference) {
      return res.status(400).json({
        success: false,
        error: { message: 'booking_reference is required', status: 400 }
      });
    }

    const confirmation = await confirmBooking({
      bookingReference: booking_reference,
      idempotencyKey,
      paymentMethod: payment_method || 'MOCK_CARD',
      cardNumber: card_number || '4242424242424242',
      cardExp: card_exp || '12/28',
      cardCvv: card_cvv || '123',
      billingName: billing_name,
      actor: req.user
    });

    res.json({
      success: true,
      data: confirmation
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/bookings/:reference/cancel
 */
router.post('/:reference/cancel', optionalAuth, async (req, res, next) => {
  try {
    const { reference } = req.params;
    const { reason } = req.body || {};

    const result = await cancelBooking({
      bookingReference: reference,
      reason: reason || 'Customer requested cancellation',
      actor: req.user
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/bookings/:reference/check-in
 */
router.post('/:reference/check-in', requireAuth, requireRole('STAFF', 'ADMIN'), async (req, res, next) => {
  try {
    const result = await checkInGuest({
      bookingReference: req.params.reference,
      staffUser: req.user
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/bookings/:reference/check-out
 */
router.post('/:reference/check-out', requireAuth, requireRole('STAFF', 'ADMIN'), async (req, res, next) => {
  try {
    const result = await checkOutGuest({
      bookingReference: req.params.reference,
      staffUser: req.user
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/bookings/my-history
 */
router.get('/my-history', optionalAuth, async (req, res, next) => {
  try {
    const email = req.query.email || (req.user ? req.user.email : null);
    const userId = req.user ? req.user.id : null;

    if (!email && !userId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Please sign in or provide an email to view booking history', status: 400 }
      });
    }

    const bookings = await getGuestBookings({ userId, email });
    res.json({
      success: true,
      data: bookings
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/bookings/:reference
 */
router.get('/:reference', optionalAuth, async (req, res, next) => {
  try {
    const booking = await getBookingByReference(req.params.reference);
    if (!booking) {
      return res.status(404).json({
        success: false,
        error: { message: `Booking reference '${req.params.reference}' not found`, status: 404 }
      });
    }

    res.json({
      success: true,
      data: booking
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/bookings
 */
router.get('/', requireAuth, requireRole('STAFF', 'ADMIN'), async (req, res, next) => {
  try {
    const { status, search, check_in, limit, offset } = req.query;
    const bookings = await listBookings({
      status,
      search,
      checkIn: check_in,
      limit,
      offset
    });

    res.json({
      success: true,
      data: bookings
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
