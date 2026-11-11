const { col } = require('../db/database');
const { calculateStayPricing } = require('./pricingService');

function getTodayIso() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Validate date ranges for reservations
 */
function validateDateRange(checkIn, checkOut) {
  if (!checkIn || !checkOut) {
    const err = new Error('Both check-in and check-out dates are required');
    err.status = 400;
    throw err;
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(checkIn) || !dateRegex.test(checkOut)) {
    const err = new Error('Dates must be in YYYY-MM-DD format');
    err.status = 400;
    throw err;
  }

  const todayIso = getTodayIso();
  if (checkIn < todayIso) {
    const err = new Error('Check-in date cannot be in the past');
    err.status = 400;
    throw err;
  }

  if (checkOut <= checkIn) {
    const err = new Error('Check-out date must be strictly after check-in date');
    err.status = 400;
    throw err;
  }

  const d1 = new Date(checkIn);
  const d2 = new Date(checkOut);
  const nights = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
  if (nights > 30) {
    const err = new Error('Reservations are limited to a maximum of 30 consecutive nights');
    err.status = 400;
    throw err;
  }

  return { nights };
}

/**
 * Query MongoDB for physical rooms with NO conflicting active bookings or non-expired holds
 */
async function getAvailablePhysicalRooms({ checkIn, checkOut, roomTypeId = null }) {
  const activeTypes = await col('room_types')
    .find(
      roomTypeId ? { id: Number(roomTypeId), is_active: 1 } : { is_active: 1 },
      { projection: { id: 1 } }
    )
    .toArray();
  const activeTypeIds = activeTypes.map(t => t.id);

  if (activeTypeIds.length === 0) {
    return [];
  }

  const now = new Date();
  const conflicting = await col('reservations').find({
    check_in: { $lt: checkOut },
    check_out: { $gt: checkIn },
    $or: [
      { status: { $in: ['CONFIRMED', 'CHECKED_IN'] } },
      { status: 'HOLD', hold_expires_at: { $gt: now } }
    ]
  }, { projection: { room_id: 1 } }).toArray();

  const blockedRoomIds = conflicting.map(c => c.room_id);

  const roomQuery = {
    room_type_id: { $in: activeTypeIds },
    status: { $nin: ['MAINTENANCE', 'OUT_OF_ORDER'] }
  };
  if (blockedRoomIds.length > 0) {
    roomQuery.id = { $nin: blockedRoomIds };
  }

  return col('rooms')
    .find(roomQuery, { projection: { _id: 0 } })
    .sort({ floor: 1, room_number: 1 })
    .toArray();
}

/**
 * Search available room types with inventory counts and itemized pricing
 */
async function searchAvailability({ checkIn, checkOut, adults = 1, children = 0, roomTypeId = null }) {
  validateDateRange(checkIn, checkOut);
  const totalGuests = Number(adults) + Number(children);

  const availableRooms = await getAvailablePhysicalRooms({ checkIn, checkOut, roomTypeId });

  const typeFilter = { is_active: 1 };
  if (roomTypeId) {
    typeFilter.id = Number(roomTypeId);
  }
  const allTypes = await col('room_types')
    .find(typeFilter, { projection: { _id: 0 } })
    .sort({ base_price_cents: 1 })
    .toArray();

  const results = [];
  for (const type of allTypes) {
    if (type.max_occupancy < totalGuests || type.max_adults < Number(adults)) {
      continue;
    }

    const matchingRooms = availableRooms.filter(r => r.room_type_id === type.id);
    const availableCount = matchingRooms.length;

    const pricing = await calculateStayPricing({
      roomTypeId: type.id,
      checkIn,
      checkOut,
      selectedAddOnIds: []
    });

    results.push({
      room_type_id: type.id,
      slug: type.slug,
      name: type.name,
      description: type.description,
      base_price_cents: type.base_price_cents,
      base_price_formatted: `$${(type.base_price_cents / 100).toFixed(2)}`,
      max_occupancy: type.max_occupancy,
      max_adults: type.max_adults,
      max_children: type.max_children,
      bed_type: type.bed_type,
      size_sqft: type.size_sqft,
      amenities: type.amenities || JSON.parse(type.amenities_json || '[]'),
      images: type.images || JSON.parse(type.images_json || '[]'),
      available_rooms_count: availableCount,
      is_available: availableCount > 0,
      pricing
    });
  }

  return {
    check_in: checkIn,
    check_out: checkOut,
    adults: Number(adults),
    children: Number(children),
    total_guests: totalGuests,
    available_room_types: results
  };
}

/**
 * Find the first available physical room for a room type
 */
async function findAvailableRoomForType(roomTypeId, checkIn, checkOut) {
  const rooms = await getAvailablePhysicalRooms({ checkIn, checkOut, roomTypeId });
  if (!rooms || rooms.length === 0) {
    return null;
  }
  return rooms[0];
}

module.exports = {
  validateDateRange,
  getAvailablePhysicalRooms,
  searchAvailability,
  findAvailableRoomForType
};
