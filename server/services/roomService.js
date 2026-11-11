const { col, getNextId } = require('../db/database');
const { logAction } = require('./auditService');
const { formatDollars } = require('./pricingService');

/**
 * List all room types with individual room status counts
 */
async function getAllRoomTypes({ includeInactive = false } = {}) {
  const filter = includeInactive ? {} : { is_active: 1 };
  const [types, rooms] = await Promise.all([
    col('room_types').find(filter, { projection: { _id: 0 } }).sort({ base_price_cents: 1 }).toArray(),
    col('rooms').find({}, { projection: { _id: 0 } }).toArray()
  ]);

  return types.map(rt => {
    const typeRooms = rooms.filter(r => r.room_type_id === rt.id);
    return {
      ...rt,
      base_price_formatted: formatDollars(rt.base_price_cents),
      amenities: rt.amenities || JSON.parse(rt.amenities_json || '[]'),
      images: rt.images || JSON.parse(rt.images_json || '[]'),
      total_rooms: typeRooms.length,
      available_rooms: typeRooms.filter(r => r.status === 'AVAILABLE').length,
      occupied_rooms: typeRooms.filter(r => r.status === 'OCCUPIED').length,
      cleaning_rooms: typeRooms.filter(r => r.status === 'CLEANING').length,
      maintenance_rooms: typeRooms.filter(r => r.status === 'MAINTENANCE').length
    };
  });
}

/**
 * Get room type by ID or slug
 */
async function getRoomTypeById(idOrSlug) {
  const isNumeric = !isNaN(idOrSlug);
  const query = isNumeric ? { id: Number(idOrSlug) } : { slug: String(idOrSlug) };
  const row = await col('room_types').findOne(query, { projection: { _id: 0 } });
  if (!row) return null;

  return {
    ...row,
    base_price_formatted: formatDollars(row.base_price_cents),
    amenities: row.amenities || JSON.parse(row.amenities_json || '[]'),
    images: row.images || JSON.parse(row.images_json || '[]')
  };
}

/**
 * Admin: Create a new room type
 */
async function createRoomType({
  slug,
  name,
  description,
  basePriceCents,
  maxOccupancy,
  maxAdults,
  maxChildren = 0,
  bedType,
  sizeSqft,
  amenities = [],
  images = [],
  actor = null
}) {
  if (!name || !slug || !basePriceCents || !maxOccupancy) {
    const err = new Error('Name, slug, base price, and max occupancy are required');
    err.status = 400;
    throw err;
  }

  const normalizedSlug = slug.trim().toLowerCase();
  const existing = await col('room_types').findOne({ slug: normalizedSlug });
  if (existing) {
    const err = new Error(`Room type slug '${slug}' already exists`);
    err.status = 409;
    throw err;
  }

  const id = await getNextId('room_types');
  const doc = {
    id,
    slug: normalizedSlug,
    name: name.trim(),
    description: description || '',
    base_price_cents: Number(basePriceCents),
    max_occupancy: Number(maxOccupancy),
    max_adults: Number(maxAdults || maxOccupancy),
    max_children: Number(maxChildren || 0),
    bed_type: bedType || 'King Bed',
    size_sqft: Number(sizeSqft || 400),
    amenities,
    images,
    amenities_json: JSON.stringify(amenities),
    images_json: JSON.stringify(images),
    is_active: 1,
    created_at: new Date().toISOString()
  };

  await col('room_types').insertOne(doc);

  await logAction({
    actorId: actor?.id,
    actorRole: actor?.role || 'ADMIN',
    actorEmail: actor?.email || 'admin@grandhorizon.com',
    action: 'ROOM_TYPE_CREATED',
    entityType: 'ROOM_TYPE',
    entityId: id,
    details: { name, slug: normalizedSlug, base_price_cents: basePriceCents }
  });

  return getRoomTypeById(id);
}

/**
 * Admin: Update room type
 */
async function updateRoomType(id, updates, actor = null) {
  const numId = Number(id);
  const current = await col('room_types').findOne({ id: numId });
  if (!current) {
    const err = new Error('Room type not found');
    err.status = 404;
    throw err;
  }

  const amenities = updates.amenities !== undefined ? updates.amenities : (current.amenities || JSON.parse(current.amenities_json || '[]'));
  const images = updates.images !== undefined ? updates.images : (current.images || JSON.parse(current.images_json || '[]'));

  const patch = {
    name: updates.name !== undefined ? updates.name : current.name,
    description: updates.description !== undefined ? updates.description : current.description,
    base_price_cents: updates.basePriceCents !== undefined ? Number(updates.basePriceCents) : current.base_price_cents,
    max_occupancy: updates.maxOccupancy !== undefined ? Number(updates.maxOccupancy) : current.max_occupancy,
    max_adults: updates.maxAdults !== undefined ? Number(updates.maxAdults) : current.max_adults,
    max_children: updates.maxChildren !== undefined ? Number(updates.maxChildren) : current.max_children,
    bed_type: updates.bedType !== undefined ? updates.bedType : current.bed_type,
    size_sqft: updates.sizeSqft !== undefined ? Number(updates.sizeSqft) : current.size_sqft,
    amenities,
    images,
    amenities_json: JSON.stringify(amenities),
    images_json: JSON.stringify(images),
    is_active: updates.isActive !== undefined ? (updates.isActive ? 1 : 0) : current.is_active
  };

  await col('room_types').updateOne({ id: numId }, { $set: patch });

  await logAction({
    actorId: actor?.id,
    actorRole: actor?.role || 'ADMIN',
    actorEmail: actor?.email || 'admin@grandhorizon.com',
    action: 'ROOM_TYPE_UPDATED',
    entityType: 'ROOM_TYPE',
    entityId: numId,
    details: updates
  });

  return getRoomTypeById(numId);
}

/**
 * List all individual rooms with room type details
 */
async function getAllRooms({ floor = null, status = null, roomTypeId = null } = {}) {
  const filter = {};
  if (floor) filter.floor = Number(floor);
  if (status && status !== 'ALL') filter.status = status;
  if (roomTypeId) filter.room_type_id = Number(roomTypeId);

  const [rooms, types] = await Promise.all([
    col('rooms').find(filter, { projection: { _id: 0 } }).sort({ floor: 1, room_number: 1 }).toArray(),
    col('room_types').find({}, { projection: { _id: 0 } }).toArray()
  ]);

  const typeMap = new Map(types.map(t => [t.id, t]));
  return rooms.map(r => {
    const rt = typeMap.get(r.room_type_id) || {};
    return {
      ...r,
      room_type_name: rt.name || '',
      room_type_slug: rt.slug || '',
      base_price_cents: rt.base_price_cents || 0,
      base_price_formatted: formatDollars(rt.base_price_cents || 0)
    };
  });
}

/**
 * Update individual room status (Front Desk / Housekeeping)
 */
async function updateRoomStatus(roomId, newStatus, notes = null, actor = null) {
  const validStatuses = ['AVAILABLE', 'OCCUPIED', 'CLEANING', 'MAINTENANCE', 'OUT_OF_ORDER'];
  if (!validStatuses.includes(newStatus)) {
    const err = new Error(`Invalid room status '${newStatus}'. Must be one of: ${validStatuses.join(', ')}`);
    err.status = 400;
    throw err;
  }

  const numId = Number(roomId);
  const room = await col('rooms').findOne({ id: numId });
  if (!room) {
    const err = new Error('Room not found');
    err.status = 404;
    throw err;
  }

  const oldStatus = room.status;
  const updatedNotes = notes !== null ? notes : room.notes;

  await col('rooms').updateOne(
    { id: numId },
    { $set: { status: newStatus, notes: updatedNotes } }
  );

  await logAction({
    actorId: actor?.id,
    actorRole: actor?.role || 'STAFF',
    actorEmail: actor?.email || 'staff@grandhorizon.com',
    action: 'ROOM_STATUS_CHANGE',
    entityType: 'ROOM',
    entityId: room.room_number,
    details: {
      room_id: numId,
      old_status: oldStatus,
      new_status: newStatus,
      notes: updatedNotes
    }
  });

  const rt = await col('room_types').findOne({ id: room.room_type_id });
  const updated = await col('rooms').findOne({ id: numId }, { projection: { _id: 0 } });
  return {
    ...updated,
    room_type_name: rt ? rt.name : ''
  };
}

/**
 * Admin: Add a new physical room
 */
async function createRoom({ roomNumber, floor, roomTypeId, status = 'AVAILABLE', notes = '', actor = null }) {
  if (!roomNumber || !floor || !roomTypeId) {
    const err = new Error('Room number, floor, and room type ID are required');
    err.status = 400;
    throw err;
  }

  const numStr = String(roomNumber).trim();
  const existing = await col('rooms').findOne({ room_number: numStr });
  if (existing) {
    const err = new Error(`Room number '${roomNumber}' already exists`);
    err.status = 409;
    throw err;
  }

  const type = await col('room_types').findOne({ id: Number(roomTypeId) });
  if (!type) {
    const err = new Error('Specified room type does not exist');
    err.status = 404;
    throw err;
  }

  const id = await getNextId('rooms');
  const doc = {
    id,
    room_number: numStr,
    floor: Number(floor),
    room_type_id: Number(roomTypeId),
    status,
    notes: notes || '',
    created_at: new Date().toISOString()
  };

  await col('rooms').insertOne(doc);

  await logAction({
    actorId: actor?.id,
    actorRole: actor?.role || 'ADMIN',
    actorEmail: actor?.email || 'admin@grandhorizon.com',
    action: 'ROOM_CREATED',
    entityType: 'ROOM',
    entityId: numStr,
    details: { room_number: numStr, floor: Number(floor), room_type_id: Number(roomTypeId) }
  });

  return {
    ...doc,
    room_type_name: type.name
  };
}

module.exports = {
  getAllRoomTypes,
  getRoomTypeById,
  createRoomType,
  updateRoomType,
  getAllRooms,
  updateRoomStatus,
  createRoom
};
