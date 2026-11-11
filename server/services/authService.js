const crypto = require('node:crypto');
const { col, getNextId } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'grand-horizon-luxury-hotel-secret-key-2026';

/**
 * Hash a password using PBKDF2 with a random 16-byte salt
 */
function hashPassword(password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify a password against stored salt:hash
 */
function verifyPassword(password, storedPasswordHash) {
  if (!storedPasswordHash || !storedPasswordHash.includes(':')) {
    return false;
  }
  const [salt, originalHash] = storedPasswordHash.split(':');
  const hashToTest = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hashToTest, 'hex'), Buffer.from(originalHash, 'hex'));
}

/**
 * Generate a signed JWT-like token (HMAC-SHA256)
 */
function generateToken(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.full_name,
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
  })).toString('base64url');

  const signature = crypto.createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * Verify and decode token
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  if (signature !== expectedSig) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded;
  } catch (err) {
    return null;
  }
}

/**
 * Authenticate user with email and password against MongoDB
 */
async function authenticate(email, password) {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await col('users').findOne({ email: normalizedEmail });
  if (!user) {
    return null;
  }
  if (!verifyPassword(password, user.password_hash)) {
    return null;
  }
  const token = generateToken(user);
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.full_name,
      role: user.role,
      phone: user.phone
    },
    token
  };
}

/**
 * Register a new user and persist in MongoDB
 */
async function register({ email, password, fullName, phone, role = 'GUEST' }) {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await col('users').findOne({ email: normalizedEmail });
  if (existing) {
    const error = new Error('Email is already registered');
    error.status = 409;
    throw error;
  }

  if (!password || password.length < 6) {
    const error = new Error('Password must be at least 6 characters long');
    error.status = 400;
    throw error;
  }

  const id = await getNextId('users');
  const passwordHash = hashPassword(password);
  const newUser = {
    id,
    email: normalizedEmail,
    password_hash: passwordHash,
    full_name: fullName.trim(),
    phone: phone ? phone.trim() : null,
    role,
    created_at: new Date().toISOString()
  };

  await col('users').insertOne(newUser);
  const token = generateToken(newUser);

  return {
    user: {
      id: newUser.id,
      email: newUser.email,
      name: newUser.full_name,
      role: newUser.role,
      phone: newUser.phone
    },
    token
  };
}

async function getUserById(userId) {
  return col('users').findOne(
    { id: Number(userId) },
    { projection: { password_hash: 0, _id: 0 } }
  );
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  authenticate,
  register,
  getUserById
};
