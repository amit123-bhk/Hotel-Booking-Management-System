const { connectDb, col, getNextId, closeDb } = require('./database');
const { hashPassword } = require('../services/authService');

function formatIsoDate(d) {
  return d.toISOString().split('T')[0];
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

async function seed({ closeOnFinish = false } = {}) {
  console.log('--- Connecting to MongoDB & initializing indexes ---');
  await connectDb();

  console.log('--- Seeding Users in MongoDB ---');
  const users = [
    {
      email: 'admin@grandhorizon.com',
      password: 'Admin123!',
      full_name: 'Rajesh Kulkarni (General Manager)',
      phone: '+91 832 245 6780',
      role: 'ADMIN'
    },
    {
      email: 'staff@grandhorizon.com',
      password: 'Staff123!',
      full_name: 'Meera Nair (Front Desk Supervisor)',
      phone: '+91 832 245 6781',
      role: 'STAFF'
    },
    {
      email: 'guest@example.com',
      password: 'Guest123!',
      full_name: 'Aarav Sharma',
      phone: '+91 98201 44510',
      role: 'GUEST'
    },
    {
      email: 'rohan.mehta@example.in',
      password: 'Guest123!',
      full_name: 'Rohan Mehta',
      phone: '+91 98112 73045',
      role: 'GUEST'
    }
  ];

  // Migrate any legacy placeholder account profiles in existing databases
  await col('users').updateOne(
    { email: 'john.doe@example.com' },
    { $set: { email: 'rohan.mehta@example.in', full_name: 'Rohan Mehta', phone: '+91 98112 73045' } }
  );

  for (const u of users) {
    const existing = await col('users').findOne({ email: u.email });
    if (!existing) {
      const id = await getNextId('users');
      await col('users').insertOne({
        id,
        email: u.email,
        password_hash: hashPassword(u.password),
        full_name: u.full_name,
        phone: u.phone,
        role: u.role,
        created_at: new Date().toISOString()
      });
      console.log(` Created user: ${u.email} [${u.role}]`);
    } else if (existing.phone && existing.phone.startsWith('+1 ')) {
      await col('users').updateOne(
        { email: u.email },
        { $set: { full_name: u.full_name, phone: u.phone } }
      );
    }
  }

  console.log('--- Seeding Room Types in MongoDB ---');
  const roomTypes = [
    {
      slug: 'deluxe-ocean-king',
      name: 'Deluxe Ocean King Room',
      description: 'Private ocean-facing balcony, King bed, deep soaking tub, rain shower, and espresso station.',
      base_price_cents: 28000,
      max_occupancy: 3,
      max_adults: 2,
      max_children: 1,
      bed_type: '1 King Bed',
      size_sqft: 480,
      amenities: [
        'Ocean View',
        'Private Balcony',
        'Wi-Fi 6',
        'Soaking Tub',
        'Rain Shower',
        'Espresso Bar',
        '55" Smart TV',
        'Minibar'
      ],
      images: [
        '/assets/images/deluxe-king.webp',
        '/assets/images/deluxe-king-2.webp'
      ]
    },
    {
      slug: 'presidential-penthouse',
      name: 'Grand Horizon Penthouse Suite',
      description: 'Top-floor corner suite with wraparound ocean terrace, outdoor hot tub, dining area for 8, and two bathrooms.',
      base_price_cents: 75000,
      max_occupancy: 6,
      max_adults: 4,
      max_children: 2,
      bed_type: '2 King Beds + Sofa Bed',
      size_sqft: 1450,
      amenities: [
        '180-Degree Ocean View',
        'Wraparound Terrace',
        'Outdoor Hot Tub',
        'Dining Room',
        'Two Bathrooms',
        'Private Elevator Entry',
        'Airport Transfer Included'
      ],
      images: [
        '/assets/images/penthouse.webp',
        '/assets/images/penthouse-2.webp'
      ]
    },
    {
      slug: 'garden-pool-villa',
      name: 'Garden Villa with Plunge Pool',
      description: 'Ground-level walled garden suite featuring a private heated plunge pool, outdoor shower, and lounge patio.',
      base_price_cents: 49000,
      max_occupancy: 4,
      max_adults: 3,
      max_children: 2,
      bed_type: '1 King Bed + 1 Daybed',
      size_sqft: 850,
      amenities: [
        'Heated Plunge Pool',
        'Private Garden Patio',
        'Outdoor Shower',
        'Audio System',
        'King Bedding',
        'Bar Station'
      ],
      images: [
        '/assets/images/villa.webp',
        '/assets/images/villa-2.webp'
      ]
    },
    {
      slug: 'executive-twin',
      name: 'Executive Double Queen Room',
      description: 'Two Queen beds, ergonomic work desk, fiber internet, dual-vanity marble bathroom, and city skyline exposure.',
      base_price_cents: 22000,
      max_occupancy: 4,
      max_adults: 2,
      max_children: 2,
      bed_type: '2 Queen Beds',
      size_sqft: 420,
      amenities: [
        'City View',
        '2 Queen Beds',
        'Work Desk',
        'Fiber Wi-Fi',
        'Coffee Station',
        'Dual Vanity'
      ],
      images: [
        '/assets/images/executive.webp',
        '/assets/images/executive-2.webp'
      ]
    },
    {
      slug: 'classic-courtyard-queen',
      name: 'Classic Courtyard Queen',
      description: 'Quiet interior room overlooking the stone courtyard fountain with soundproofed windows and marble bath.',
      base_price_cents: 16500,
      max_occupancy: 2,
      max_adults: 2,
      max_children: 0,
      bed_type: '1 Queen Bed',
      size_sqft: 340,
      amenities: [
        'Courtyard View',
        '1 Queen Bed',
        'Marble Bathroom',
        'Soundproof Windows',
        'Tea Station',
        'High-Speed Wi-Fi'
      ],
      images: [
        '/assets/images/classic.webp',
        '/assets/images/classic-2.webp'
      ]
    }
  ];

  for (const rt of roomTypes) {
    const existing = await col('room_types').findOne({ slug: rt.slug });
    if (!existing) {
      const id = await getNextId('room_types');
      await col('room_types').insertOne({
        id,
        slug: rt.slug,
        name: rt.name,
        description: rt.description,
        base_price_cents: rt.base_price_cents,
        max_occupancy: rt.max_occupancy,
        max_adults: rt.max_adults,
        max_children: rt.max_children,
        bed_type: rt.bed_type,
        size_sqft: rt.size_sqft,
        amenities: rt.amenities,
        images: rt.images,
        amenities_json: JSON.stringify(rt.amenities),
        images_json: JSON.stringify(rt.images),
        is_active: 1,
        created_at: new Date().toISOString()
      });
      console.log(` Created room type: ${rt.name}`);
    } else if (existing.images && existing.images[0] && existing.images[0].startsWith('https://images.unsplash.com')) {
      await col('room_types').updateOne(
        { slug: rt.slug },
        { $set: { images: rt.images, images_json: JSON.stringify(rt.images) } }
      );
    }
  }

  console.log('--- Seeding Individual Rooms in MongoDB ---');
  const dbTypes = await col('room_types').find({}).toArray();
  const typeMap = {};
  dbTypes.forEach(t => { typeMap[t.slug] = t.id; });

  const rooms = [
    { number: '101', floor: 1, type: 'classic-courtyard-queen', status: 'AVAILABLE', notes: 'Quiet corner room near fountain' },
    { number: '102', floor: 1, type: 'classic-courtyard-queen', status: 'AVAILABLE', notes: 'Ground floor garden access' },
    { number: '103', floor: 1, type: 'classic-courtyard-queen', status: 'CLEANING', notes: 'Turned over this morning' },
    { number: '104', floor: 1, type: 'executive-twin', status: 'AVAILABLE', notes: 'Double queen configuration' },
    { number: '105', floor: 1, type: 'executive-twin', status: 'AVAILABLE', notes: 'Accessible bathroom features' },

    { number: '201', floor: 2, type: 'deluxe-ocean-king', status: 'AVAILABLE', notes: 'Central balcony, clear coastal view' },
    { number: '202', floor: 2, type: 'deluxe-ocean-king', status: 'AVAILABLE', notes: 'Sunset orientation' },
    { number: '203', floor: 2, type: 'deluxe-ocean-king', status: 'OCCUPIED', notes: 'Guest currently in-house' },
    { number: '204', floor: 2, type: 'deluxe-ocean-king', status: 'AVAILABLE', notes: 'High demand room' },
    { number: '205', floor: 2, type: 'deluxe-ocean-king', status: 'MAINTENANCE', notes: 'Balcony door latch inspection scheduled' },

    { number: '301', floor: 3, type: 'deluxe-ocean-king', status: 'AVAILABLE', notes: 'High floor ocean panorama' },
    { number: '302', floor: 3, type: 'deluxe-ocean-king', status: 'AVAILABLE', notes: 'Connecting door available with 303' },
    { number: '303', floor: 3, type: 'deluxe-ocean-king', status: 'CLEANING', notes: 'Deep cleaning underway' },

    { number: '401', floor: 4, type: 'garden-pool-villa', status: 'AVAILABLE', notes: 'Private plunge pool heated at 29C' },
    { number: '402', floor: 4, type: 'garden-pool-villa', status: 'AVAILABLE', notes: 'Private walled garden patio' },

    { number: '501', floor: 5, type: 'presidential-penthouse', status: 'AVAILABLE', notes: 'North Penthouse with wraparound terrace' },
    { number: '502', floor: 5, type: 'presidential-penthouse', status: 'AVAILABLE', notes: 'South Penthouse with private hot tub' }
  ];

  for (const r of rooms) {
    const existing = await col('rooms').findOne({ room_number: r.number });
    if (!existing) {
      const id = await getNextId('rooms');
      await col('rooms').insertOne({
        id,
        room_number: r.number,
        floor: r.floor,
        room_type_id: typeMap[r.type],
        status: r.status,
        notes: r.notes,
        created_at: new Date().toISOString()
      });
      console.log(` Created room: ${r.number} (Floor ${r.floor}) [${r.status}]`);
    }
  }

  console.log('--- Seeding Rate Modifiers in MongoDB ---');
  const existingModsCount = await col('rate_modifiers').countDocuments();
  if (existingModsCount === 0) {
    await col('rate_modifiers').insertMany([
      {
        id: await getNextId('rate_modifiers'),
        room_type_id: null,
        name: 'Weekend Surcharge (Fri-Sat)',
        modifier_type: 'WEEKEND',
        multiplier: 1.15,
        start_date: null,
        end_date: null,
        is_active: 1,
        created_at: new Date().toISOString()
      },
      {
        id: await getNextId('rate_modifiers'),
        room_type_id: null,
        name: 'Summer High Season',
        modifier_type: 'SEASONAL',
        multiplier: 1.25,
        start_date: '2026-06-01',
        end_date: '2026-08-31',
        is_active: 1,
        created_at: new Date().toISOString()
      }
    ]);
    console.log(' Created weekend and seasonal rate modifiers');
  }

  console.log('--- Seeding Sample Reservations & Operations Data in MongoDB ---');
  const existingResCount = await col('reservations').countDocuments();
  if (existingResCount === 0) {
    const today = new Date();
    const room203 = await col('rooms').findOne({ room_number: '203' });
    const room201 = await col('rooms').findOne({ room_number: '201' });
    const room101 = await col('rooms').findOne({ room_number: '101' });
    const room401 = await col('rooms').findOne({ room_number: '401' });
    const adminUser = await col('users').findOne({ role: 'ADMIN' });
    const staffUser = await col('users').findOne({ role: 'STAFF' });
    const guestUser = await col('users').findOne({ email: 'guest@example.com' });

    const checkIn1 = formatIsoDate(addDays(today, -1));
    const checkOut1 = formatIsoDate(addDays(today, 2));
    const res1Id = await getNextId('reservations');
    await col('reservations').insertOne({
      id: res1Id,
      booking_reference: 'BK-2026-8812',
      room_id: room203.id,
      user_id: guestUser.id,
      guest_name: 'Aarav Sharma',
      guest_email: 'guest@example.com',
      guest_phone: '+91 98201 44510',
      check_in: checkIn1,
      check_out: checkOut1,
      num_adults: 2,
      num_children: 0,
      status: 'CHECKED_IN',
      hold_expires_at: null,
      special_requests: 'Quiet room away from elevator, extra pillows',
      add_ons: [{ id: 'breakfast', name: 'Daily Breakfast Buffet', price_cents: 5000 }],
      add_ons_json: JSON.stringify([{ id: 'breakfast', name: 'Daily Breakfast Buffet', price_cents: 5000 }]),
      base_price_cents: 84000,
      add_ons_price_cents: 5000,
      taxes_cents: 10680,
      fees_cents: 7500,
      total_price_cents: 107180,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    await col('payments').insertOne({
      id: await getNextId('payments'),
      reservation_id: res1Id,
      transaction_reference: 'TXN-SANDBOX-8812-OK',
      amount_cents: 107180,
      currency: 'USD',
      status: 'PAID',
      payment_method: 'MOCK_CARD',
      card_last_four: '4242',
      refund_amount_cents: 0,
      created_at: new Date().toISOString()
    });

    const checkIn2 = formatIsoDate(addDays(today, 1));
    const checkOut2 = formatIsoDate(addDays(today, 4));
    const res2Id = await getNextId('reservations');
    await col('reservations').insertOne({
      id: res2Id,
      booking_reference: 'BK-2026-9140',
      room_id: room201.id,
      user_id: null,
      guest_name: 'Vikramaditya Rao',
      guest_email: 'vikram.rao@example.in',
      guest_phone: '+91 98450 32199',
      check_in: checkIn2,
      check_out: checkOut2,
      num_adults: 2,
      num_children: 1,
      status: 'CONFIRMED',
      hold_expires_at: null,
      special_requests: 'Late check-in expected around 20:00',
      add_ons: [],
      add_ons_json: '[]',
      base_price_cents: 84000,
      add_ons_price_cents: 0,
      taxes_cents: 10080,
      fees_cents: 7500,
      total_price_cents: 101580,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    await col('payments').insertOne({
      id: await getNextId('payments'),
      reservation_id: res2Id,
      transaction_reference: 'TXN-SANDBOX-9140-OK',
      amount_cents: 101580,
      currency: 'USD',
      status: 'PAID',
      payment_method: 'MOCK_CARD',
      card_last_four: '1111',
      refund_amount_cents: 0,
      created_at: new Date().toISOString()
    });

    const checkIn3 = formatIsoDate(addDays(today, -7));
    const checkOut3 = formatIsoDate(addDays(today, -3));
    const res3Id = await getNextId('reservations');
    await col('reservations').insertOne({
      id: res3Id,
      booking_reference: 'BK-2026-7201',
      room_id: room101.id,
      user_id: null,
      guest_name: 'Ananya Iyer',
      guest_email: 'ananya.iyer@example.in',
      guest_phone: '+91 98801 77888',
      check_in: checkIn3,
      check_out: checkOut3,
      num_adults: 2,
      num_children: 0,
      status: 'CHECKED_OUT',
      hold_expires_at: null,
      special_requests: '',
      add_ons: [],
      add_ons_json: '[]',
      base_price_cents: 66000,
      add_ons_price_cents: 0,
      taxes_cents: 7920,
      fees_cents: 10000,
      total_price_cents: 83920,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    await col('payments').insertOne({
      id: await getNextId('payments'),
      reservation_id: res3Id,
      transaction_reference: 'TXN-SANDBOX-7201-OK',
      amount_cents: 83920,
      currency: 'USD',
      status: 'PAID',
      payment_method: 'MOCK_CARD',
      card_last_four: '4242',
      refund_amount_cents: 0,
      created_at: new Date().toISOString()
    });

    const checkIn4 = formatIsoDate(addDays(today, 5));
    const checkOut4 = formatIsoDate(addDays(today, 8));
    const res4Id = await getNextId('reservations');
    await col('reservations').insertOne({
      id: res4Id,
      booking_reference: 'BK-2026-6405',
      room_id: room401.id,
      user_id: null,
      guest_name: 'Kavita Deshmukh',
      guest_email: 'kavita.deshmukh@example.in',
      guest_phone: '+91 98220 44333',
      check_in: checkIn4,
      check_out: checkOut4,
      num_adults: 2,
      num_children: 0,
      status: 'CANCELLED',
      hold_expires_at: null,
      special_requests: '',
      add_ons: [],
      add_ons_json: '[]',
      base_price_cents: 147000,
      add_ons_price_cents: 0,
      taxes_cents: 17640,
      fees_cents: 7500,
      total_price_cents: 172140,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    await col('payments').insertOne({
      id: await getNextId('payments'),
      reservation_id: res4Id,
      transaction_reference: 'TXN-SANDBOX-6405-REF',
      amount_cents: 172140,
      currency: 'USD',
      status: 'REFUNDED',
      payment_method: 'MOCK_CARD',
      card_last_four: '4242',
      refund_amount_cents: 172140,
      created_at: new Date().toISOString()
    });

    await col('audit_logs').insertMany([
      {
        id: await getNextId('audit_logs'),
        actor_id: adminUser.id,
        actor_role: 'ADMIN',
        actor_email: adminUser.email,
        action: 'DATABASE_SEEDED',
        entity_type: 'SYSTEM',
        entity_id: '1',
        details: { note: 'Initial MongoDB seed data populated' },
        details_json: JSON.stringify({ note: 'Initial MongoDB seed data populated' }),
        ip_address: '127.0.0.1',
        created_at: new Date().toISOString()
      },
      {
        id: await getNextId('audit_logs'),
        actor_id: staffUser.id,
        actor_role: 'STAFF',
        actor_email: staffUser.email,
        action: 'BOOKING_CHECKED_IN',
        entity_type: 'RESERVATION',
        entity_id: 'BK-2026-8812',
        details: { guest: 'Aarav Sharma', room: '203', check_in_time: checkIn1 },
        details_json: JSON.stringify({ guest: 'Aarav Sharma', room: '203', check_in_time: checkIn1 }),
        ip_address: '127.0.0.1',
        created_at: new Date().toISOString()
      }
    ]);

    console.log(' Created demo reservations, payments, and audit logs in MongoDB');
  } else {
    // Migrate existing sample reservations & audit log from legacy Western demo names to Indian demo names
    await Promise.all([
      col('reservations').updateOne({ booking_reference: 'BK-2026-8812', guest_name: 'Eleanor Rigby' }, { $set: { guest_name: 'Aarav Sharma', guest_phone: '+91 98201 44510' } }),
      col('reservations').updateOne({ booking_reference: 'BK-2026-9140', guest_name: 'Marcus Aurelius' }, { $set: { guest_name: 'Vikramaditya Rao', guest_email: 'vikram.rao@example.in', guest_phone: '+91 98450 32199' } }),
      col('reservations').updateOne({ booking_reference: 'BK-2026-7201', guest_name: 'Sophia Chen' }, { $set: { guest_name: 'Ananya Iyer', guest_email: 'ananya.iyer@example.in', guest_phone: '+91 98801 77888' } }),
      col('reservations').updateOne({ booking_reference: 'BK-2026-6405', guest_name: 'David Miller' }, { $set: { guest_name: 'Kavita Deshmukh', guest_email: 'kavita.deshmukh@example.in', guest_phone: '+91 98220 44333' } }),
      col('audit_logs').updateOne({ entity_id: 'BK-2026-8812', 'details.guest': 'Eleanor Rigby' }, { $set: { 'details.guest': 'Aarav Sharma' } }),
      col('rooms').updateOne({ room_number: '401', notes: 'Private plunge pool heated at 84F' }, { $set: { notes: 'Private plunge pool heated at 29C' } })
    ]);
  }

  console.log('--- MongoDB seed completed successfully! ---');
  if (closeOnFinish) {
    await closeDb();
  }
}

if (require.main === module) {
  seed({ closeOnFinish: true }).catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}

module.exports = { seed };
