const { col, getNextId } = require('../db/database');

/**
 * Log a material business action into the MongoDB audit_logs collection
 */
async function logAction({
  actorId = null,
  actorRole = 'ANONYMOUS',
  actorEmail = 'anonymous@guest.com',
  action,
  entityType,
  entityId,
  details = {},
  ipAddress = '127.0.0.1'
}) {
  try {
    const id = await getNextId('audit_logs');
    await col('audit_logs').insertOne({
      id,
      actor_id: actorId,
      actor_role: actorRole,
      actor_email: actorEmail,
      action,
      entity_type: entityType,
      entity_id: String(entityId),
      details,
      details_json: JSON.stringify(details),
      ip_address: ipAddress,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

/**
 * Retrieve audit trail logs with optional filters and pagination
 */
async function getAuditLogs({ limit = 50, offset = 0, action = null, entityType = null } = {}) {
  const filter = {};
  if (action) filter.action = action;
  if (entityType) filter.entity_type = entityType;

  const rows = await col('audit_logs')
    .find(filter, { projection: { _id: 0 } })
    .sort({ created_at: -1 })
    .skip(Number(offset))
    .limit(Number(limit))
    .toArray();

  return rows.map(r => ({
    ...r,
    details: r.details || JSON.parse(r.details_json || '{}')
  }));
}

module.exports = {
  logAction,
  getAuditLogs
};
