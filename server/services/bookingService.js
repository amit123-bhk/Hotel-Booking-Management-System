const crypto = require('node:crypto');
const { col, getNextId, withLock } = require('../db/database');
const { validateDateRange, findAvailableRoomForType } = require('./availabilityService');
const { calculateStayPricing, formatDollars } = require('./pricingService');
const { logAction } = require('./auditService');

function generateBookingReference() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let ref = 'BK-' + new Date().getFullYear() + '-';
  for (let i = 0; i < 4; i++) {
    ref += chars.charAt(crypto.randomInt(chars.length));
  }
  return ref;
}

/**
 * Helper to enrich reservation documents with room and room_type fields
 */
async function enrichReservations(rows) {
  if (!rows || rows.length === 0) return [];
  const [rooms, types] = await Promise.all([
    col('rooms').find({}, { projection: { _id: 0 } }).toArray(),
    col('room_types').find({}, { projection: { _id: 0 } }).toArray()
  ]);

  const roomMap = new Map(rooms.map(r => [r.id, r]));
  const typeMap = new Map(types.map(t => [t.id, t]));

  return rows.map(row => {
    const rm = roomMap.get(row.room_id) || {};
    const rt = typeMap.get(rm.room_type_id) || {};
    return formatReservation({
      ...row,
      room_number: rm.room_number,
      floor: rm.floor,
      current_room_status: rm.status,
      room_type_name: rt.name,
      room_type_slug: rt.slug,
      bed_type: rt.bed_type,
      size_sqft: rt.size_sqft,
      amenities: rt.amenities,
      images: rt.images
    });
  });
}

/**
 * 1. Step 1 of Booking: Create Temporary 10-Minute Hold
 * Uses serialized lock + re-check against MongoDB reservations to prevent double booking.
 */
async function createHold({
  roomTypeId,
  checkIn,
  checkOut,
  numAdults = 1,
  numChildren = 0,
  guestName,
  guestEmail,
  guestPhone,
  selectedAddOns = [],
  specialRequests = '',
  utm = null,
  userId = null,
  actor = null
}) {
  validateDateRange(checkIn, checkOut);

  if (!guestName || !guestEmail || !guestPhone) {
    const err = new Error('Guest name, email, and phone number are required');
    err.status = 400;
    throw err;
  }

  return withLock(async () => {
    const room = await findAvailableRoomForType(roomTypeId, checkIn, checkOut);
    if (!room) {
      const err = new Error('No rooms of the selected type are available for these dates. Please choose different dates or room type.');
      err.status = 409;
      throw err;
    }

    const pricing = await calculateStayPricing({
      roomTypeId,
      checkIn,
      checkOut,
      selectedAddOnIds: selectedAddOns
    });

    let bookingRef = generateBookingReference();
    while (await col('reservations').findOne({ booking_reference: bookingRef })) {
      bookingRef = generateBookingReference();
    }

    const holdExpiresDate = new Date(Date.now() + 10 * 60 * 1000);
    const id = await getNextId('reservations');
    const nowIso = new Date().toISOString();

    const reservationDoc = {
      id,
      booking_reference: bookingRef,
      room_id: room.id,
      user_id: userId ? Number(userId) : null,
      guest_name: guestName.trim(),
      guest_email: guestEmail.trim().toLowerCase(),
      guest_phone: guestPhone.trim(),
      check_in: checkIn,
      check_out: checkOut,
      num_adults: Number(numAdults),
      num_children: Number(numChildren),
      status: 'HOLD',
      hold_expires_at: holdExpiresDate,
      special_requests: specialRequests || '',
      add_ons: pricing.add_ons,
      add_ons_json: JSON.stringify(pricing.add_ons),
      base_price_cents: pricing.base_price_cents,
      add_ons_price_cents: pricing.add_ons_price_cents,
      taxes_cents: pricing.taxes_cents,
      fees_cents: pricing.fees_cents,
      total_price_cents: pricing.total_price_cents,
      utm: utm || null,
      created_at: nowIso,
      updated_at: nowIso
    };

    await col('reservations').insertOne(reservationDoc);

    await logAction({
      actorId: actor?.id || userId,
      actorRole: actor?.role || (userId ? 'GUEST' : 'ANONYMOUS'),
      actorEmail: actor?.email || guestEmail,
      action: 'BOOKING_HOLD_PLACED',
      entityType: 'RESERVATION',
      entityId: bookingRef,
      details: {
        room_number: room.room_number,
        room_type_id: Number(roomTypeId),
        check_in: checkIn,
        check_out: checkOut,
        hold_expires_at: holdExpiresDate.toISOString(),
        total_price_cents: pricing.total_price_cents
      }
    });

    return {
      success: true,
      booking_reference: bookingRef,
      room_id: room.id,
      room_number: room.room_number,
      floor: room.floor,
      status: 'HOLD',
      hold_expires_at: holdExpiresDate.toISOString(),
      expires_in_seconds: 600,
      pricing
    };
  });
}

/**
 * 2. Step 2 of Booking: Confirm with Simulated Payment Gateway
 * Supports idempotency keys to prevent double-charging on network retries.
 */
async function confirmBooking({
  bookingReference,
  idempotencyKey = null,
  paymentMethod = 'MOCK_CARD',
  cardNumber = '4242424242424242',
  cardExp = '12/28',
  cardCvv = '123',
  billingName = null,
  actor = null
}) {
  return withLock(async () => {
    if (idempotencyKey) {
      const existing = await col('reservations').findOne({ idempotency_key: String(idempotencyKey) });
      if (existing) {
        const [enriched] = await enrichReservations([existing]);
        const payment = await col('payments').findOne({ reservation_id: existing.id }, { projection: { _id: 0 } });
        return {
          success: true,
          idempotent_replay: true,
          booking: enriched,
          payment
        };
      }
    }

    const res = await col('reservations').findOne({ booking_reference: bookingReference });
    if (!res) {
      const err = new Error(`Reservation '${bookingReference}' not found`);
      err.status = 404;
      throw err;
    }

    if (res.status === 'CONFIRMED') {
      const [enriched] = await enrichReservations([res]);
      const payment = await col('payments').findOne({ reservation_id: res.id }, { projection: { _id: 0 } });
      return {
        success: true,
        already_confirmed: true,
        booking: enriched,
        payment
      };
    }

    if (res.status !== 'HOLD') {
      const err = new Error(`Cannot confirm reservation with status '${res.status}'`);
      err.status = 400;
      throw err;
    }

    const now = new Date();
    const holdExpiresAt = new Date(res.hold_expires_at);
    if (now > holdExpiresAt) {
      await col('reservations').updateOne(
        { id: res.id },
        { $set: { status: 'EXPIRED', updated_at: now.toISOString() } }
      );
      const err = new Error('Your reservation hold has expired (10 minutes limit reached). Please select your room again.');
      err.status = 410;
      throw err;
    }

    // Double-check overlap against confirmed/checked-in reservations
    const conflict = await col('reservations').findOne({
      room_id: res.room_id,
      id: { $ne: res.id },
      status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
      check_in: { $lt: res.check_out },
      check_out: { $gt: res.check_in }
    });
    if (conflict) {
      const err = new Error('Room is no longer available due to a conflicting confirmed reservation');
      err.status = 409;
      throw err;
    }

    // Simulated Payment Gateway validation
    const cleanCard = (cardNumber || '').replace(/\D/g, '');
    if (cleanCard.startsWith('4000') || cleanCard.startsWith('0000')) {
      const err = new Error('Simulated Payment Declined: Insufficient funds on test card (Cards starting with 4000 simulate bank decline). Please use test card 4242...');
      err.status = 402;
      throw err;
    }
    if (cleanCard.length < 12) {
      const err = new Error('Invalid card number. Please provide a valid test card number (e.g. 4242 4242 4242 4242)');
      err.status = 400;
      throw err;
    }

    const cardLastFour = cleanCard.slice(-4);
    const txnRef = `TXN-SANDBOX-${Date.now()}-${crypto.randomInt(1000, 9999)}`;
    const paymentId = await getNextId('payments');

    const paymentDoc = {
      id: paymentId,
      reservation_id: res.id,
      transaction_reference: txnRef,
      amount_cents: res.total_price_cents,
      currency: 'USD',
      status: 'PAID',
      payment_method: paymentMethod,
      card_last_four: cardLastFour,
      refund_amount_cents: 0,
      created_at: new Date().toISOString()
    };

    await col('payments').insertOne(paymentDoc);

    const updateFields = {
      status: 'CONFIRMED',
      updated_at: new Date().toISOString()
    };
    if (idempotencyKey) {
      updateFields.idempotency_key = String(idempotencyKey);
    }

    await col('reservations').updateOne({ id: res.id }, { $set: updateFields });

    const room = await col('rooms').findOne({ id: res.room_id });

    await logAction({
      actorId: actor?.id || res.user_id,
      actorRole: actor?.role || (res.user_id ? 'GUEST' : 'ANONYMOUS'),
      actorEmail: actor?.email || res.guest_email,
      action: 'BOOKING_CONFIRMED',
      entityType: 'RESERVATION',
      entityId: res.booking_reference,
      details: {
        room_number: room ? room.room_number : null,
        transaction_reference: txnRef,
        amount_cents: res.total_price_cents,
        card_last_four: cardLastFour
      }
    });

    const updatedRes = await col('reservations').findOne({ id: res.id }, { projection: { _id: 0 } });
    const [enriched] = await enrichReservations([updatedRes]);
    const savedPayment = await col('payments').findOne({ id: paymentId }, { projection: { _id: 0 } });

    return {
      success: true,
      booking: enriched,
      payment: savedPayment
    };
  });
}

/**
 * 3. Cancel Booking with Automatic Sandbox Refund
 */
async function cancelBooking({ bookingReference, reason = 'Guest requested cancellation', actor = null }) {
  return withLock(async () => {
    const res = await col('reservations').findOne({ booking_reference: bookingReference });
    if (!res) {
      const err = new Error(`Reservation '${bookingReference}' not found`);
      err.status = 404;
      throw err;
    }

    if (actor && actor.role === 'GUEST') {
      const isOwner = (actor.id && res.user_id === actor.id) || (actor.email && res.guest_email.toLowerCase() === actor.email.toLowerCase());
      if (!isOwner) {
        const err = new Error('You are not authorized to cancel this reservation');
        err.status = 403;
        throw err;
      }
    }

    if (res.status === 'CANCELLED') {
      const err = new Error('Reservation is already cancelled');
      err.status = 400;
      throw err;
    }
    if (res.status === 'CHECKED_IN') {
      const err = new Error('Cannot cancel a reservation after the guest has checked in. Please process early check-out instead.');
      err.status = 400;
      throw err;
    }
    if (res.status === 'CHECKED_OUT') {
      const err = new Error('Cannot cancel a completed stay');
      err.status = 400;
      throw err;
    }

    let refundSummary = null;
    if (res.status === 'CONFIRMED') {
      const payment = await col('payments').findOne({ reservation_id: res.id, status: 'PAID' });
      if (payment) {
        await col('payments').updateOne(
          { id: payment.id },
          { $set: { status: 'REFUNDED', refund_amount_cents: payment.amount_cents } }
        );
        refundSummary = {
          refund_transaction: `REF-SANDBOX-${Date.now()}`,
          refund_amount_cents: payment.amount_cents,
          refund_amount_formatted: formatDollars(payment.amount_cents),
          card_last_four: payment.card_last_four
        };
      }
    }

    await col('reservations').updateOne(
      { id: res.id },
      { $set: { status: 'CANCELLED', updated_at: new Date().toISOString() } }
    );

    await logAction({
      actorId: actor?.id || null,
      actorRole: actor?.role || 'SYSTEM',
      actorEmail: actor?.email || res.guest_email,
      action: 'BOOKING_CANCELLED',
      entityType: 'RESERVATION',
      entityId: res.booking_reference,
      details: {
        reason,
        previous_status: res.status,
        refund: refundSummary
      }
    });

    return {
      success: true,
      booking_reference: res.booking_reference,
      status: 'CANCELLED',
      refund: refundSummary
    };
  });
}

/**
 * 4. Staff Check-In Workflow
 */
async function checkInGuest({ bookingReference, staffUser }) {
  return withLock(async () => {
    const res = await col('reservations').findOne({ booking_reference: bookingReference });
    if (!res) {
      const err = new Error(`Reservation '${bookingReference}' not found`);
      err.status = 404;
      throw err;
    }

    if (res.status === 'CHECKED_IN') {
      const err = new Error('Guest is already checked in');
      err.status = 400;
      throw err;
    }
    if (res.status === 'CHECKED_OUT') {
      const err = new Error('Cannot check in a completed reservation');
      err.status = 400;
      throw err;
    }
    if (res.status === 'CANCELLED') {
      const err = new Error('Cannot check in a cancelled reservation');
      err.status = 400;
      throw err;
    }
    if (res.status === 'HOLD') {
      const err = new Error('Reservation is still on temporary hold; payment and confirmation required before check-in');
      err.status = 400;
      throw err;
    }

    await col('reservations').updateOne(
      { id: res.id },
      { $set: { status: 'CHECKED_IN', updated_at: new Date().toISOString() } }
    );

    await col('rooms').updateOne(
      { id: res.room_id },
      { $set: { status: 'OCCUPIED' } }
    );

    const room = await col('rooms').findOne({ id: res.room_id });

    await logAction({
      actorId: staffUser.id,
      actorRole: staffUser.role,
      actorEmail: staffUser.email,
      action: 'GUEST_CHECKIN',
      entityType: 'RESERVATION',
      entityId: res.booking_reference,
      details: {
        guest_name: res.guest_name,
        room_number: room ? room.room_number : null,
        timestamp: new Date().toISOString()
      }
    });

    return {
      success: true,
      booking_reference: res.booking_reference,
      status: 'CHECKED_IN',
      room_status: 'OCCUPIED'
    };
  });
}

/**
 * 5. Staff Check-Out Workflow
 */
async function checkOutGuest({ bookingReference, staffUser }) {
  return withLock(async () => {
    const res = await col('reservations').findOne({ booking_reference: bookingReference });
    if (!res) {
      const err = new Error(`Reservation '${bookingReference}' not found`);
      err.status = 404;
      throw err;
    }

    if (res.status !== 'CHECKED_IN') {
      const err = new Error(`Cannot check out reservation with status '${res.status}'. Guest must be checked in first.`);
      err.status = 400;
      throw err;
    }

    await col('reservations').updateOne(
      { id: res.id },
      { $set: { status: 'CHECKED_OUT', updated_at: new Date().toISOString() } }
    );

    await col('rooms').updateOne(
      { id: res.room_id },
      { $set: { status: 'CLEANING' } }
    );

    const room = await col('rooms').findOne({ id: res.room_id });

    await logAction({
      actorId: staffUser.id,
      actorRole: staffUser.role,
      actorEmail: staffUser.email,
      action: 'GUEST_CHECKOUT',
      entityType: 'RESERVATION',
      entityId: res.booking_reference,
      details: {
        guest_name: res.guest_name,
        room_number: room ? room.room_number : null,
        new_room_status: 'CLEANING',
        timestamp: new Date().toISOString()
      }
    });

    return {
      success: true,
      booking_reference: res.booking_reference,
      status: 'CHECKED_OUT',
      room_status: 'CLEANING'
    };
  });
}

/**
 * Get full booking details by reference code
 */
async function getBookingByReference(bookingReference) {
  const res = await col('reservations').findOne(
    { booking_reference: bookingReference },
    { projection: { _id: 0 } }
  );
  if (!res) return null;

  const [enriched] = await enrichReservations([res]);
  const payment = await col('payments')
    .find({ reservation_id: res.id }, { projection: { _id: 0 } })
    .sort({ id: -1 })
    .limit(1)
    .toArray();

  return {
    ...enriched,
    payment: payment[0] || null
  };
}

/**
 * List bookings with filtering, search, and pagination
 */
async function listBookings({ status = null, search = null, checkIn = null, limit = 50, offset = 0 } = {}) {
  const filter = {};
  if (status && status !== 'ALL') {
    filter.status = status;
  }
  if (checkIn) {
    filter.check_in = checkIn;
  }
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    const matchingRooms = await col('rooms').find({ room_number: regex }, { projection: { id: 1 } }).toArray();
    const roomIds = matchingRooms.map(r => r.id);

    filter.$or = [
      { booking_reference: regex },
      { guest_name: regex },
      { guest_email: regex },
      ...(roomIds.length > 0 ? [{ room_id: { $in: roomIds } }] : [])
    ];
  }

  const rows = await col('reservations')
    .find(filter, { projection: { _id: 0 } })
    .sort({ created_at: -1 })
    .skip(Number(offset))
    .limit(Number(limit))
    .toArray();

  return enrichReservations(rows);
}

/**
 * Get reservations for a guest user (by userId and/or email)
 */
async function getGuestBookings({ userId = null, email = null }) {
  const orConditions = [];
  if (userId) orConditions.push({ user_id: Number(userId) });
  if (email) orConditions.push({ guest_email: email.toLowerCase().trim() });

  if (orConditions.length === 0) return [];

  const rows = await col('reservations')
    .find({ $or: orConditions }, { projection: { _id: 0 } })
    .sort({ created_at: -1 })
    .toArray();

  return enrichReservations(rows);
}

function formatReservation(row) {
  let addOns = row.add_ons || [];
  if (!addOns.length && row.add_ons_json) {
    try {
      addOns = JSON.parse(row.add_ons_json);
    } catch (e) {}
  }

  let amenities = row.amenities || [];
  if (!amenities.length && row.amenities_json) {
    try {
      amenities = JSON.parse(row.amenities_json);
    } catch (e) {}
  }

  let images = row.images || [];
  if (!images.length && row.images_json) {
    try {
      images = JSON.parse(row.images_json);
    } catch (e) {}
  }

  return {
    id: row.id,
    booking_reference: row.booking_reference,
    room_id: row.room_id,
    room_number: row.room_number,
    floor: row.floor,
    room_type_name: row.room_type_name,
    room_type_slug: row.room_type_slug,
    bed_type: row.bed_type,
    size_sqft: row.size_sqft,
    amenities,
    images,
    guest_name: row.guest_name,
    guest_email: row.guest_email,
    guest_phone: row.guest_phone,
    check_in: row.check_in,
    check_out: row.check_out,
    num_adults: row.num_adults,
    num_children: row.num_children,
    status: row.status,
    hold_expires_at: row.hold_expires_at ? new Date(row.hold_expires_at).toISOString() : null,
    special_requests: row.special_requests,
    add_ons: addOns,
    base_price_cents: row.base_price_cents,
    base_price_formatted: formatDollars(row.base_price_cents),
    add_ons_price_cents: row.add_ons_price_cents,
    add_ons_price_formatted: formatDollars(row.add_ons_price_cents),
    taxes_cents: row.taxes_cents,
    taxes_formatted: formatDollars(row.taxes_cents),
    fees_cents: row.fees_cents,
    fees_formatted: formatDollars(row.fees_cents),
    total_price_cents: row.total_price_cents,
    total_price_formatted: formatDollars(row.total_price_cents),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

module.exports = {
  createHold,
  confirmBooking,
  cancelBooking,
  checkInGuest,
  checkOutGuest,
  getBookingByReference,
  listBookings,
  getGuestBookings,
  formatReservation
};
