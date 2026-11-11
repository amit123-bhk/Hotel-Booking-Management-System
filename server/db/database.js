const { MongoClient } = require('mongodb');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.MONGODB_DB_NAME || 'grand_horizon_hotel';

let clientInstance = null;
let dbInstance = null;

// Async mutex queue to serialize critical booking state mutations on standalone MongoDB
let lockTail = Promise.resolve();

/**
 * Connect to MongoDB and initialize collections & indexes
 */
async function connectDb(customDbName = null) {
  if (dbInstance && (!customDbName || dbInstance.databaseName === customDbName)) {
    return dbInstance;
  }

  if (!clientInstance) {
    clientInstance = new MongoClient(MONGODB_URI);
    await clientInstance.connect();
  }

  const targetDbName = customDbName || process.env.MONGODB_DB_NAME || DB_NAME;
  dbInstance = clientInstance.db(targetDbName);
  await ensureIndexes(dbInstance);
  return dbInstance;
}

/**
 * Get active MongoDB database instance
 */
function getDb() {
  if (!dbInstance) {
    throw new Error('MongoDB is not connected. Call connectDb() first.');
  }
  return dbInstance;
}

/**
 * Get a MongoDB collection by name
 */
function col(name) {
  return getDb().collection(name);
}

/**
 * Generate an auto-incrementing integer ID for clean numeric entity references
 */
async function getNextId(sequenceName) {
  const result = await col('counters').findOneAndUpdate(
    { _id: sequenceName },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return result.seq;
}

/**
 * Execute an asynchronous critical section under an exclusive serialized lock
 * Prevents race conditions on overlapping room holds/confirmations.
 */
async function withLock(fn) {
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const previous = lockTail;
  lockTail = previous.then(() => current).catch(() => current);
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Create unique and query-performance indexes across collections
 */
async function ensureIndexes(db) {
  await Promise.all([
    db.collection('users').createIndexes([
      { key: { id: 1 }, unique: true },
      { key: { email: 1 }, unique: true }
    ]),
    db.collection('room_types').createIndexes([
      { key: { id: 1 }, unique: true },
      { key: { slug: 1 }, unique: true }
    ]),
    db.collection('rooms').createIndexes([
      { key: { id: 1 }, unique: true },
      { key: { room_number: 1 }, unique: true },
      { key: { room_type_id: 1, status: 1 } }
    ]),
    db.collection('rate_modifiers').createIndexes([
      { key: { id: 1 }, unique: true },
      { key: { is_active: 1, modifier_type: 1 } }
    ]),
    db.collection('reservations').createIndexes([
      { key: { id: 1 }, unique: true },
      { key: { booking_reference: 1 }, unique: true },
      { key: { room_id: 1, check_in: 1, check_out: 1, status: 1 } },
      { key: { status: 1 } },
      { key: { guest_email: 1 } },
      { key: { user_id: 1 } },
      {
        key: { idempotency_key: 1 },
        unique: true,
        partialFilterExpression: { idempotency_key: { $type: 'string' } }
      }
    ]),
    db.collection('payments').createIndexes([
      { key: { id: 1 }, unique: true },
      { key: { transaction_reference: 1 }, unique: true },
      { key: { reservation_id: 1 } }
    ]),
    db.collection('audit_logs').createIndexes([
      { key: { created_at: -1 } },
      { key: { entity_type: 1, entity_id: 1 } }
    ])
  ]);
}

/**
 * Close MongoDB client connection cleanly
 */
async function closeDb() {
  if (clientInstance) {
    await clientInstance.close();
    clientInstance = null;
    dbInstance = null;
  }
}

module.exports = {
  connectDb,
  getDb,
  col,
  getNextId,
  withLock,
  closeDb,
  MONGODB_URI,
  DB_NAME
};
