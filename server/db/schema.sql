-- Grand Horizon Hotel & Resort Database Schema
-- SQLite 3 DDL with Foreign Keys, Constraints, and Indexes

PRAGMA foreign_keys = ON;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK(role IN ('GUEST', 'STAFF', 'ADMIN')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Room Types Table
CREATE TABLE IF NOT EXISTS room_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  base_price_cents INTEGER NOT NULL CHECK(base_price_cents > 0),
  max_occupancy INTEGER NOT NULL CHECK(max_occupancy > 0),
  max_adults INTEGER NOT NULL CHECK(max_adults > 0),
  max_children INTEGER NOT NULL DEFAULT 0 CHECK(max_children >= 0),
  bed_type TEXT NOT NULL,
  size_sqft INTEGER NOT NULL,
  amenities_json TEXT NOT NULL DEFAULT '[]',
  images_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Individual Rooms Table
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_number TEXT UNIQUE NOT NULL,
  floor INTEGER NOT NULL CHECK(floor >= 1),
  room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE', 'OCCUPIED', 'CLEANING', 'MAINTENANCE', 'OUT_OF_ORDER')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Rate Modifiers Table (Weekend, Seasonal, Holiday surcharges)
CREATE TABLE IF NOT EXISTS rate_modifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_type_id INTEGER REFERENCES room_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  modifier_type TEXT NOT NULL CHECK(modifier_type IN ('WEEKEND', 'SEASONAL', 'HOLIDAY')),
  multiplier REAL NOT NULL DEFAULT 1.0 CHECK(multiplier >= 0.5 AND multiplier <= 3.0),
  start_date TEXT,
  end_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Reservations Table
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_reference TEXT UNIQUE NOT NULL,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL COLLATE NOCASE,
  guest_phone TEXT NOT NULL,
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  num_adults INTEGER NOT NULL DEFAULT 1 CHECK(num_adults >= 1),
  num_children INTEGER NOT NULL DEFAULT 0 CHECK(num_children >= 0),
  status TEXT NOT NULL CHECK(status IN ('HOLD', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'EXPIRED')),
  hold_expires_at TEXT,
  special_requests TEXT,
  add_ons_json TEXT DEFAULT '[]',
  base_price_cents INTEGER NOT NULL CHECK(base_price_cents >= 0),
  add_ons_price_cents INTEGER NOT NULL DEFAULT 0 CHECK(add_ons_price_cents >= 0),
  taxes_cents INTEGER NOT NULL CHECK(taxes_cents >= 0),
  fees_cents INTEGER NOT NULL CHECK(fees_cents >= 0),
  total_price_cents INTEGER NOT NULL CHECK(total_price_cents >= 0),
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Payments Table (Simulated / Sandbox)
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  transaction_reference TEXT UNIQUE NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL CHECK(status IN ('PAID', 'REFUNDED', 'FAILED')),
  payment_method TEXT NOT NULL DEFAULT 'MOCK_CARD',
  card_last_four TEXT NOT NULL DEFAULT '4242',
  refund_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(refund_amount_cents >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. Audit Trail Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  ip_address TEXT DEFAULT '127.0.0.1',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance & integrity
CREATE INDEX IF NOT EXISTS idx_reservations_room_dates ON reservations(room_id, check_in, check_out, status);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_reference ON reservations(booking_reference);
CREATE INDEX IF NOT EXISTS idx_reservations_guest_email ON reservations(guest_email);
CREATE INDEX IF NOT EXISTS idx_reservations_user_id ON reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(room_type_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_payments_reservation ON payments(reservation_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
