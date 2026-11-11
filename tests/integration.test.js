const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.MONGODB_DB_NAME = 'grand_horizon_test_integration';

const app = require('../server/app');
const { connectDb, col, getNextId, closeDb } = require('../server/db/database');
const { seed } = require('../server/db/seed');
const { searchAvailability } = require('../server/services/availabilityService');
const {
  createHold,
  confirmBooking,
  cancelBooking,
  checkInGuest,
  checkOutGuest,
  getBookingByReference
} = require('../server/services/bookingService');
const { getOperationsReport } = require('../server/services/reportingService');
const { updateRoomStatus } = require('../server/services/roomService');
const { authenticate, register } = require('../server/services/authService');

function futureDate(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

describe('Integration & End-to-End Acceptance Tests (MongoDB)', () => {
  let adminUser;
  let staffUser;
  let guestUser;
  let roomType;

  before(async () => {
    const db = await connectDb('grand_horizon_test_integration');
    await db.dropDatabase();
    await connectDb('grand_horizon_test_integration');
    await seed();

    adminUser = await col('users').findOne({ role: 'ADMIN' });
    staffUser = await col('users').findOne({ role: 'STAFF' });
    guestUser = await col('users').findOne({ role: 'GUEST' });
    roomType = await col('room_types').findOne({ slug: 'deluxe-ocean-king' });
  });

  after(async () => {
    await closeDb();
  });

  test('Acceptance 1: Guest can search and book an available room for valid dates', async () => {
    const checkIn = futureDate(12);
    const checkOut = futureDate(15);

    const searchRes = await searchAvailability({
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      roomTypeId: roomType.id
    });
    assert.ok(searchRes.available_room_types.length > 0, 'Should return available room types');
    const targetType = searchRes.available_room_types[0];
    assert.strictEqual(targetType.is_available, true);
    assert.ok(targetType.available_rooms_count > 0);

    const hold = await createHold({
      roomTypeId: roomType.id,
      checkIn,
      checkOut,
      numAdults: 2,
      numChildren: 0,
      guestName: 'Karthik Subramanian',
      guestEmail: 'karthik.s@example.in',
      guestPhone: '+91 98401 55210',
      selectedAddOns: ['breakfast']
    });

    assert.ok(hold.booking_reference.startsWith('BK-'));
    assert.strictEqual(hold.status, 'HOLD');
    assert.ok(hold.hold_expires_at);

    const confirmation = await confirmBooking({
      bookingReference: hold.booking_reference,
      cardNumber: '4242424242424242',
      cardExp: '12/28',
      cardCvv: '999'
    });

    assert.strictEqual(confirmation.success, true);
    assert.strictEqual(confirmation.booking.status, 'CONFIRMED');
    assert.strictEqual(confirmation.payment.status, 'PAID');
    assert.strictEqual(confirmation.booking.guest_name, 'Karthik Subramanian');

    // Verify directly in MongoDB reservations collection
    const storedDoc = await col('reservations').findOne({ booking_reference: hold.booking_reference });
    assert.ok(storedDoc);
    assert.strictEqual(storedDoc.status, 'CONFIRMED');
  });

  test('Acceptance 2: Concurrency & Integrity - Overlapping requests cannot book the same room', async () => {
    const exclusiveType = await col('room_types').findOne({ slug: 'presidential-penthouse' });
    const pentRooms = await col('rooms').find({ room_type_id: exclusiveType.id }).toArray();

    const checkIn = futureDate(30);
    const checkOut = futureDate(35);

    for (let i = 0; i < pentRooms.length; i++) {
      const h = await createHold({
        roomTypeId: exclusiveType.id,
        checkIn,
        checkOut,
        numAdults: 2,
        numChildren: 0,
        guestName: `VIP Guest ${i + 1}`,
        guestEmail: `vip${i + 1}@penthouse.in`,
        guestPhone: '+91 98201 00100'
      });
      await confirmBooking({
        bookingReference: h.booking_reference,
        cardNumber: '4242424242424242'
      });
    }

    await assert.rejects(async () => {
      await createHold({
        roomTypeId: exclusiveType.id,
        checkIn: futureDate(32),
        checkOut: futureDate(34),
        numAdults: 2,
        numChildren: 0,
        guestName: 'Concurrent Late Guest',
        guestEmail: 'late@conflict.in',
        guestPhone: '+91 98201 00999'
      });
    }, (err) => {
      assert.strictEqual(err.status, 409);
      assert.ok(err.message.includes('No rooms of the selected type are available'));
      return true;
    });
  });

  test('Acceptance 3: Invalid dates, full occupancy and cancelled bookings handled correctly', async () => {
    await assert.rejects(async () => {
      await searchAvailability({
        checkIn: futureDate(10),
        checkOut: futureDate(8)
      });
    }, (err) => {
      assert.strictEqual(err.status, 400);
      return true;
    });

    const checkIn = futureDate(40);
    const checkOut = futureDate(44);
    const hold = await createHold({
      roomTypeId: roomType.id,
      checkIn,
      checkOut,
      numAdults: 2,
      numChildren: 0,
      guestName: guestUser.full_name,
      guestEmail: guestUser.email,
      guestPhone: '+91 98201 60001',
      userId: guestUser.id
    });
    await confirmBooking({ bookingReference: hold.booking_reference });

    const cancelRes = await cancelBooking({
      bookingReference: hold.booking_reference,
      reason: 'Trip postponed',
      actor: guestUser
    });
    assert.strictEqual(cancelRes.status, 'CANCELLED');
    assert.ok(cancelRes.refund, 'Refund should be processed for cancelled confirmed booking');

    const afterCancelSearch = await searchAvailability({
      checkIn,
      checkOut,
      roomTypeId: roomType.id
    });
    const foundType = afterCancelSearch.available_room_types.find(t => t.room_type_id === roomType.id);
    assert.strictEqual(foundType.is_available, true);
  });

  test('Acceptance 4: Staff can check in/out a guest and view booking status', async () => {
    const checkIn = futureDate(0);
    const checkOut = futureDate(3);
    const hold = await createHold({
      roomTypeId: roomType.id,
      checkIn,
      checkOut,
      guestName: 'Clara Oswald',
      guestEmail: 'clara@tardis.net',
      guestPhone: '+44 20 7946 0123'
    });
    await confirmBooking({ bookingReference: hold.booking_reference });

    const checkInResult = await checkInGuest({
      bookingReference: hold.booking_reference,
      staffUser
    });
    assert.strictEqual(checkInResult.status, 'CHECKED_IN');
    assert.strictEqual(checkInResult.room_status, 'OCCUPIED');

    const inHouse = await getBookingByReference(hold.booking_reference);
    assert.strictEqual(inHouse.status, 'CHECKED_IN');

    await assert.rejects(async () => {
      await checkInGuest({ bookingReference: hold.booking_reference, staffUser });
    }, /Guest is already checked in/);

    const checkOutResult = await checkOutGuest({
      bookingReference: hold.booking_reference,
      staffUser
    });
    assert.strictEqual(checkOutResult.status, 'CHECKED_OUT');
    assert.strictEqual(checkOutResult.room_status, 'CLEANING');

    const updatedRoom = await col('rooms').findOne({ id: inHouse.room_id });
    assert.strictEqual(updatedRoom.status, 'CLEANING');

    const cleanedRoom = await updateRoomStatus(inHouse.room_id, 'AVAILABLE', 'Cleaned and sanitized', staffUser);
    assert.strictEqual(cleanedRoom.status, 'AVAILABLE');
  });

  test('Acceptance 5: The admin report matches the underlying reservation data', async () => {
    const startDate = futureDate(-10);
    const endDate = futureDate(30);
    const report = await getOperationsReport({
      startDate,
      endDate
    });

    assert.ok(report.metrics.total_rooms > 0);
    assert.ok(report.metrics.total_available_room_nights > 0);
    assert.ok(typeof report.metrics.occupancy_rate_percentage === 'number');
    assert.ok(report.metrics.total_revenue_cents >= 0);

    const matchingDocs = await col('reservations').find({
      status: { $in: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] },
      check_in: { $lte: endDate },
      check_out: { $gte: startDate }
    }).toArray();
    const expectedSum = matchingDocs.reduce((acc, doc) => acc + doc.total_price_cents, 0);

    assert.strictEqual(report.metrics.total_revenue_cents, expectedSum, 'Report revenue must strictly match MongoDB sum');
  });

  test('Integrity: Expired holds MUST NOT block rooms', async () => {
    const expiredRef = 'BK-EXPIRED-TEST';
    const expCheckIn = futureDate(45);
    const expCheckOut = futureDate(48);
    const classicType = await col('room_types').findOne({ slug: 'classic-courtyard-queen' });
    const classicRoom = await col('rooms').findOne({ room_type_id: classicType.id, status: 'AVAILABLE' });

    await col('reservations').insertOne({
      id: await getNextId('reservations'),
      booking_reference: expiredRef,
      room_id: classicRoom.id,
      guest_name: 'Deepak Verma',
      guest_email: 'deepak.expired@example.in',
      guest_phone: '+91 98201 00000',
      check_in: expCheckIn,
      check_out: expCheckOut,
      num_adults: 1,
      num_children: 0,
      status: 'HOLD',
      hold_expires_at: new Date(Date.now() - 3600 * 1000), // 1 hour ago
      base_price_cents: 40000,
      add_ons_price_cents: 0,
      taxes_cents: 4800,
      fees_cents: 7500,
      total_price_cents: 52300,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    const search = await searchAvailability({
      checkIn: expCheckIn,
      checkOut: expCheckOut,
      roomTypeId: classicType.id
    });

    const resultType = search.available_room_types.find(t => t.room_type_id === classicType.id);
    assert.strictEqual(resultType.is_available, true, 'Expired hold must not block availability');
    assert.ok(resultType.available_rooms_count > 0, 'Available room count must be positive');
  });

  test('Idempotency: Re-confirming with the same idempotency key does not duplicate payment', async () => {
    const hold = await createHold({
      roomTypeId: roomType.id,
      checkIn: futureDate(25),
      checkOut: futureDate(28),
      guestName: 'Nandini Kulkarni',
      guestEmail: 'nandini.idempotent@example.in',
      guestPhone: '+91 98201 12345'
    });

    const key = 'idem-unique-key-99999';

    const res1 = await confirmBooking({
      bookingReference: hold.booking_reference,
      idempotencyKey: key,
      cardNumber: '4242424242424242'
    });
    assert.strictEqual(res1.success, true);

    const res2 = await confirmBooking({
      bookingReference: hold.booking_reference,
      idempotencyKey: key,
      cardNumber: '4242424242424242'
    });
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.idempotent_replay, true);
    assert.strictEqual(res2.booking.booking_reference, hold.booking_reference);

    const payments = await col('payments').find({ reservation_id: res1.booking.id }).toArray();
    assert.strictEqual(payments.length, 1, 'Only one payment record should be created');
  });

  test('HTTP API, User Registration & Server-Side RBAC with MongoDB persistence', async () => {
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
      // 1. Health check verifies MongoDB connection
      const healthRes = await fetch(`${baseUrl}/api/health`);
      assert.strictEqual(healthRes.status, 200);
      const healthJson = await healthRes.json();
      assert.strictEqual(healthJson.status, 'healthy');
      assert.strictEqual(healthJson.database, 'mongodb');
      assert.strictEqual(healthJson.database_status, 'connected');

      // 2. Register new guest via HTTP API -> persists to MongoDB -> logs in -> books a room
      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Siddharth Joshi',
          email: 'siddharth.joshi@mongodb-test.in',
          phone: '+91 98201 77121',
          password: 'Password123!'
        })
      });
      assert.strictEqual(regRes.status, 201);
      const regJson = await regRes.json();
      assert.strictEqual(regJson.success, true);
      assert.strictEqual(regJson.data.user.role, 'GUEST');
      assert.ok(regJson.data.token);

      // Verify user persisted in MongoDB users collection
      const userInDb = await col('users').findOne({ email: 'siddharth.joshi@mongodb-test.in' });
      assert.ok(userInDb);
      assert.strictEqual(userInDb.full_name, 'Siddharth Joshi');

      // 3. Unauthenticated access to protected Staff/Admin endpoint -> 401
      const unauthBookings = await fetch(`${baseUrl}/api/bookings`);
      assert.strictEqual(unauthBookings.status, 401);

      // 4. Guest blocked from Staff/Admin endpoints -> 403
      const guestAuth = await authenticate('guest@example.com', 'Guest123!');
      const guestStaffRes = await fetch(`${baseUrl}/api/bookings`, {
        headers: { Authorization: `Bearer ${guestAuth.token}` }
      });
      assert.strictEqual(guestStaffRes.status, 403);

      // 5. Staff allowed on Front Desk & Reports, blocked on Admin Audit Logs (403)
      const staffAuth = await authenticate('staff@grandhorizon.com', 'Staff123!');
      const staffReportRes = await fetch(`${baseUrl}/api/reports/operations`, {
        headers: { Authorization: `Bearer ${staffAuth.token}` }
      });
      assert.strictEqual(staffReportRes.status, 200);

      const staffAuditRes = await fetch(`${baseUrl}/api/audit`, {
        headers: { Authorization: `Bearer ${staffAuth.token}` }
      });
      assert.strictEqual(staffAuditRes.status, 403);

      // 6. Admin allowed on Audit Logs
      const adminAuth = await authenticate('admin@grandhorizon.com', 'Admin123!');
      const adminAuditRes = await fetch(`${baseUrl}/api/audit`, {
        headers: { Authorization: `Bearer ${adminAuth.token}` }
      });
      assert.strictEqual(adminAuditRes.status, 200);
      const adminAuditJson = await adminAuditRes.json();
      assert.strictEqual(adminAuditJson.success, true);
      assert.ok(Array.isArray(adminAuditJson.data));

      // 7. Inquiry endpoint with UTM tracking persists to MongoDB
      const inqRes = await fetch(`${baseUrl}/api/inquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Inquiry Tester',
          email: 'inquiry@test.com',
          message: 'Do you have EV charging?',
          utm: { utm_source: 'newsletter', utm_campaign: 'autumn' }
        })
      });
      assert.strictEqual(inqRes.status, 201);
      const inqJson = await inqRes.json();
      assert.strictEqual(inqJson.success, true);
      const storedInq = await col('inquiries').findOne({ id: inqJson.data.id });
      assert.ok(storedInq);
      assert.strictEqual(storedInq.utm.utm_source, 'newsletter');

      // 8. Unknown API route returns JSON 404
      const notFoundRes = await fetch(`${baseUrl}/api/nonexistent-route`);
      assert.strictEqual(notFoundRes.status, 404);
      const notFoundJson = await notFoundRes.json();
      assert.strictEqual(notFoundJson.success, false);
      assert.strictEqual(notFoundJson.error.code, 'NOT_FOUND');

      // 9. Honeypot spam protection blocks automated bot submissions on inquiry and registration
      const botInquiryRes = await fetch(`${baseUrl}/api/inquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Bot Spammer',
          email: 'bot@spam.example',
          message: 'Buy cheap links now',
          honeypot_website: 'http://spam.example'
        })
      });
      assert.strictEqual(botInquiryRes.status, 400);
      const botInquiryJson = await botInquiryRes.json();
      assert.strictEqual(botInquiryJson.error.code, 'SPAM_DETECTED');

      const botRegRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Bot User',
          email: 'botreg@spam.example',
          phone: '+91 98201 00000',
          password: 'Password123!',
          honeypot_website: 'http://spam-bot.example'
        })
      });
      assert.strictEqual(botRegRes.status, 400);
      const botRegJson = await botRegRes.json();
      assert.strictEqual(botRegJson.error.code, 'SPAM_DETECTED');

      // 10. First-party Analytics ingestion and Admin telemetry summary
      const evRes = await fetch(`${baseUrl}/api/analytics/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'page_view',
          path: '/privacy',
          utm: { utm_source: 'integration_test' }
        })
      });
      assert.strictEqual(evRes.status, 201);

      const summaryRes = await fetch(`${baseUrl}/api/analytics/summary`, {
        headers: { Authorization: `Bearer ${adminAuth.token}` }
      });
      assert.strictEqual(summaryRes.status, 200);
      const summaryJson = await summaryRes.json();
      assert.strictEqual(summaryJson.success, true);
      assert.ok(summaryJson.data.total_events >= 1);
      assert.ok(summaryJson.data.event_counts.page_view >= 1);

      // 11. Force HTTPS reverse-proxy redirect (301) and security headers
      const httpsRedirectRes = await fetch(`${baseUrl}/api/room-types`, {
        redirect: 'manual',
        headers: { 'x-forwarded-proto': 'http' }
      });
      assert.strictEqual(httpsRedirectRes.status, 301);
      assert.strictEqual(
        httpsRedirectRes.headers.get('location'),
        `https://${new URL(baseUrl).host}/api/room-types`
      );

      // 12. SEO assets, legal routes, compressed WebP image, social preview, and custom 404 route
      const seoChecks = [
        { path: '/sitemap.xml', status: 200, typeIncludes: 'application/xml' },
        { path: '/robots.txt', status: 200, typeIncludes: 'text/plain' },
        { path: '/favicon.svg', status: 200, typeIncludes: 'image/svg+xml' },
        { path: '/favicon.png', status: 200, typeIncludes: 'image/png' },
        { path: '/assets/og-preview.jpg', status: 200, typeIncludes: 'image/jpeg' },
        { path: '/assets/images/hero.webp', status: 200, typeIncludes: 'image/webp' },
        { path: '/privacy', status: 200, typeIncludes: 'text/html' },
        { path: '/terms', status: 200, typeIncludes: 'text/html' },
        { path: '/nonexistent-page-xyz', status: 404, typeIncludes: 'text/html' }
      ];
      for (const chk of seoChecks) {
        const r = await fetch(`${baseUrl}${chk.path}`);
        assert.strictEqual(r.status, chk.status, `Expected ${chk.status} for ${chk.path}`);
        assert.ok((r.headers.get('content-type') || '').includes(chk.typeIncludes), `Expected ${chk.typeIncludes} for ${chk.path}`);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
