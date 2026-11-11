const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.MONGODB_DB_NAME = 'grand_horizon_test_unit';

const { connectDb, getDb, col, closeDb } = require('../server/db/database');
const { calculateStayPricing } = require('../server/services/pricingService');
const { validateDateRange } = require('../server/services/availabilityService');
const { hashPassword, verifyPassword, generateToken, verifyToken } = require('../server/services/authService');
const { seed } = require('../server/db/seed');

function futureDate(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

// Find next weekday (0=Sun..6=Sat) in the non-summer-season future (avoiding Jun-Aug modifier)
function futureWeekday(targetDay, minOffsetDays = 5) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + minOffsetDays);
  while (d.getUTCDay() !== targetDay || (d.getUTCMonth() >= 5 && d.getUTCMonth() <= 7)) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().split('T')[0];
}

function addDaysIso(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

describe('Unit Tests: Core Business Rules, Pricing & Security (MongoDB)', () => {
  before(async () => {
    const db = await connectDb('grand_horizon_test_unit');
    await db.dropDatabase();
    await connectDb('grand_horizon_test_unit');
    await seed();
  });

  after(async () => {
    await closeDb();
  });

  test('Security: Password hashing & verification with salt', () => {
    const password = 'SecretPassword123!';
    const hashed = hashPassword(password);
    assert.ok(hashed.includes(':'), 'Hashed password should contain salt:hash');
    assert.strictEqual(verifyPassword(password, hashed), true, 'Valid password must verify');
    assert.strictEqual(verifyPassword('WrongPassword', hashed), false, 'Incorrect password must fail verification');
  });

  test('Security: JWT Token generation & verification', () => {
    const mockUser = { id: 42, email: 'tester@hotel.com', role: 'STAFF', full_name: 'Tester' };
    const token = generateToken(mockUser);
    assert.ok(typeof token === 'string' && token.split('.').length === 3, 'Token must be standard 3-part JWT');

    const decoded = verifyToken(token);
    assert.strictEqual(decoded.id, 42);
    assert.strictEqual(decoded.email, 'tester@hotel.com');
    assert.strictEqual(decoded.role, 'STAFF');

    const invalidToken = token + 'tampered';
    assert.strictEqual(verifyToken(invalidToken), null, 'Tampered token must be rejected');
  });

  test('Validation: Date range sanity validation', () => {
    const start = futureDate(10);
    const end = futureDate(14);
    const tooLong = futureDate(55);

    const valid = validateDateRange(start, end);
    assert.strictEqual(valid.nights, 4);

    assert.throws(() => {
      validateDateRange(end, start);
    }, /Check-out date must be strictly after check-in date/);

    assert.throws(() => {
      validateDateRange(end, end);
    }, /Check-out date must be strictly after check-in date/);

    assert.throws(() => {
      validateDateRange('2020-01-01', '2020-01-05');
    }, /Check-in date cannot be in the past/);

    assert.throws(() => {
      validateDateRange(start, tooLong);
    }, /limited to a maximum of 30 consecutive nights/);
  });

  test('Pricing Engine: Itemized price breakdown calculation', async () => {
    const roomType = await col('room_types').findOne({ slug: 'deluxe-ocean-king' });
    assert.ok(roomType, 'Room type must exist');

    const monday = futureWeekday(1);
    const wednesday = addDaysIso(monday, 2);
    const quote = await calculateStayPricing({
      roomTypeId: roomType.id,
      checkIn: monday,
      checkOut: wednesday,
      selectedAddOnIds: ['breakfast', 'airport_shuttle']
    });

    assert.strictEqual(quote.nights, 2);
    assert.strictEqual(quote.base_price_cents, 28000 * 2, '2 nights at $280 = $560');
    assert.strictEqual(quote.add_ons_price_cents, 11000, 'Add-ons should equal $110');
    assert.strictEqual(quote.taxes_cents, Math.round(67000 * 0.12));
    assert.strictEqual(quote.fees_cents, 5000);
    assert.strictEqual(quote.total_price_cents, quote.base_price_cents + quote.add_ons_price_cents + quote.taxes_cents + quote.fees_cents);
  });

  test('Pricing Engine: Weekend surcharge application', async () => {
    const roomType = await col('room_types').findOne({ slug: 'classic-courtyard-queen' });
    const friday = futureWeekday(5);
    const sunday = addDaysIso(friday, 2);
    const weekendQuote = await calculateStayPricing({
      roomTypeId: roomType.id,
      checkIn: friday,
      checkOut: sunday,
      selectedAddOnIds: []
    });

    const expectedBase = 18975 * 2;
    assert.strictEqual(weekendQuote.base_price_cents, expectedBase);
    assert.strictEqual(weekendQuote.night_breakdown[0].label.includes('Weekend Rate'), true);
  });
});
