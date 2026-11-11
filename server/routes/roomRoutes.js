const express = require('express');
const {
  getAllRoomTypes,
  getRoomTypeById,
  createRoomType,
  updateRoomType,
  getAllRooms,
  updateRoomStatus,
  createRoom
} = require('../services/roomService');
const { AVAILABLE_ADD_ONS } = require('../services/pricingService');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/rooms/add-ons (and /api/add-ons)
 */
router.get(['/rooms/add-ons', '/add-ons'], (req, res) => {
  res.json({
    success: true,
    data: AVAILABLE_ADD_ONS
  });
});

/**
 * GET /api/room-types
 */
router.get('/room-types', async (req, res, next) => {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    const roomTypes = await getAllRoomTypes({ includeInactive });
    res.json({
      success: true,
      data: roomTypes
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/room-types/:id
 */
router.get('/room-types/:id', async (req, res, next) => {
  try {
    const roomType = await getRoomTypeById(req.params.id);
    if (!roomType) {
      return res.status(404).json({
        success: false,
        error: { message: 'Room type not found', status: 404 }
      });
    }
    res.json({
      success: true,
      data: roomType
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/room-types
 */
router.post('/room-types', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const newType = await createRoomType({
      ...req.body,
      actor: req.user
    });
    res.status(201).json({
      success: true,
      data: newType
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/room-types/:id
 */
router.put('/room-types/:id', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const updated = await updateRoomType(req.params.id, req.body, req.user);
    res.json({
      success: true,
      data: updated
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/rooms
 */
router.get('/rooms', requireAuth, requireRole('STAFF', 'ADMIN'), async (req, res, next) => {
  try {
    const { floor, status, roomTypeId } = req.query;
    const rooms = await getAllRooms({ floor, status, roomTypeId });
    res.json({
      success: true,
      data: rooms
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/rooms
 */
router.post('/rooms', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const newRoom = await createRoom({
      ...req.body,
      actor: req.user
    });
    res.status(201).json({
      success: true,
      data: newRoom
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/rooms/:id/status
 */
router.patch('/rooms/:id/status', requireAuth, requireRole('STAFF', 'ADMIN'), async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    if (!status) {
      return res.status(400).json({
        success: false,
        error: { message: 'Status field is required', status: 400 }
      });
    }

    const updated = await updateRoomStatus(req.params.id, status, notes, req.user);
    res.json({
      success: true,
      data: updated
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
