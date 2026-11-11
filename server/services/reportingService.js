const { col } = require('../db/database');
const { formatDollars } = require('./pricingService');

function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function getTodayIso() {
  return new Date().toISOString().split('T')[0];
}

function addDaysIso(dateStr, days) {
  const d = parseDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Generate Operations & Business Analytics Report from MongoDB
 */
async function getOperationsReport({ startDate = null, endDate = null } = {}) {
  const today = getTodayIso();
  const start = startDate || today;
  const end = endDate || addDaysIso(today, 6);

  const d1 = parseDate(start);
  const d2 = parseDate(end);
  const daysInPeriod = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1);

  const [allRooms, allTypes, reservationsInPeriod, arrivalsRaw, departuresRaw] = await Promise.all([
    col('rooms').find({}, { projection: { _id: 0 } }).toArray(),
    col('room_types').find({}, { projection: { _id: 0 } }).toArray(),
    col('reservations').find({
      check_in: { $lte: end },
      check_out: { $gte: start }
    }, { projection: { _id: 0 } }).toArray(),
    col('reservations').find({
      check_in: { $gte: start, $lte: end },
      status: { $in: ['CONFIRMED', 'HOLD'] }
    }, { projection: { _id: 0 } }).sort({ check_in: 1 }).toArray(),
    col('reservations').find({
      check_out: { $gte: start, $lte: end },
      status: { $in: ['CHECKED_IN', 'CONFIRMED'] }
    }, { projection: { _id: 0 } }).sort({ check_out: 1 }).toArray()
  ]);

  const activeRooms = allRooms.filter(r => r.status !== 'OUT_OF_ORDER');
  const totalRooms = activeRooms.length || 1;
  const totalAvailableRoomNights = totalRooms * daysInPeriod;

  const roomMap = new Map(allRooms.map(r => [r.id, r]));
  const typeMap = new Map(allTypes.map(t => [t.id, t]));

  let totalRevenueCents = 0;
  let occupiedRoomNights = 0;
  let confirmedCount = 0;
  let checkedInCount = 0;
  let checkedOutCount = 0;
  let cancelledCount = 0;
  let refundedCents = 0;

  const roomTypeBreakdownMap = {};
  allTypes.forEach(t => {
    roomTypeBreakdownMap[t.id] = {
      id: t.id,
      name: t.name,
      slug: t.slug,
      bookings_count: 0,
      occupied_nights: 0,
      revenue_cents: 0
    };
  });

  for (const r of reservationsInPeriod) {
    if (r.status === 'CANCELLED') {
      cancelledCount++;
      refundedCents += r.total_price_cents;
      continue;
    }

    if (r.status === 'CONFIRMED') confirmedCount++;
    if (r.status === 'CHECKED_IN') checkedInCount++;
    if (r.status === 'CHECKED_OUT') checkedOutCount++;

    if (['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'].includes(r.status)) {
      totalRevenueCents += r.total_price_cents;

      const resCheckIn = parseDate(r.check_in);
      const resCheckOut = parseDate(r.check_out);
      const overlapStart = new Date(Math.max(d1.getTime(), resCheckIn.getTime()));
      const overlapEnd = new Date(Math.min(d2.getTime() + 24 * 60 * 60 * 1000, resCheckOut.getTime()));
      const overlapNights = Math.max(0, Math.round((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)));

      occupiedRoomNights += overlapNights;

      const rm = roomMap.get(r.room_id);
      const rtId = rm ? rm.room_type_id : null;
      if (rtId && roomTypeBreakdownMap[rtId]) {
        roomTypeBreakdownMap[rtId].bookings_count++;
        roomTypeBreakdownMap[rtId].occupied_nights += overlapNights;
        roomTypeBreakdownMap[rtId].revenue_cents += r.total_price_cents;
      }
    }
  }

  const occupancyRatePct = totalAvailableRoomNights > 0
    ? Number(((occupiedRoomNights / totalAvailableRoomNights) * 100).toFixed(1))
    : 0;

  const adrCents = occupiedRoomNights > 0
    ? Math.round(totalRevenueCents / occupiedRoomNights)
    : 0;

  const revParCents = totalAvailableRoomNights > 0
    ? Math.round(totalRevenueCents / totalAvailableRoomNights)
    : 0;

  const statusCountsObj = {};
  for (const rm of allRooms) {
    statusCountsObj[rm.status] = (statusCountsObj[rm.status] || 0) + 1;
  }
  const roomStatusCounts = Object.entries(statusCountsObj).map(([status, count]) => ({ status, count }));

  const mapTraveler = (r) => {
    const rm = roomMap.get(r.room_id) || {};
    const rt = typeMap.get(rm.room_type_id) || {};
    return {
      booking_reference: r.booking_reference,
      guest_name: r.guest_name,
      guest_email: r.guest_email,
      guest_phone: r.guest_phone,
      room_number: rm.room_number,
      room_type_name: rt.name,
      check_in: r.check_in,
      check_out: r.check_out,
      num_adults: r.num_adults,
      num_children: r.num_children,
      status: r.status,
      total_price_formatted: formatDollars(r.total_price_cents)
    };
  };

  return {
    period: {
      start_date: start,
      end_date: end,
      days_in_period: daysInPeriod
    },
    metrics: {
      total_rooms: totalRooms,
      total_available_room_nights: totalAvailableRoomNights,
      occupied_room_nights: occupiedRoomNights,
      occupancy_rate_percentage: occupancyRatePct,
      total_revenue_cents: totalRevenueCents,
      total_revenue_formatted: formatDollars(totalRevenueCents),
      average_daily_rate_cents: adrCents,
      average_daily_rate_formatted: formatDollars(adrCents),
      revpar_cents: revParCents,
      revpar_formatted: formatDollars(revParCents),
      total_active_bookings: confirmedCount + checkedInCount,
      confirmed_bookings: confirmedCount,
      checked_in_guests: checkedInCount,
      completed_stays: checkedOutCount,
      cancellations_count: cancelledCount,
      refunded_amount_cents: refundedCents,
      refunded_amount_formatted: formatDollars(refundedCents)
    },
    room_type_breakdown: Object.values(roomTypeBreakdownMap).map(t => ({
      ...t,
      revenue_formatted: formatDollars(t.revenue_cents),
      occupancy_share_pct: occupiedRoomNights > 0 ? Number(((t.occupied_nights / occupiedRoomNights) * 100).toFixed(1)) : 0
    })),
    room_status_distribution: roomStatusCounts,
    upcoming_arrivals: arrivalsRaw.map(mapTraveler),
    upcoming_departures: departuresRaw.map(mapTraveler)
  };
}

module.exports = {
  getOperationsReport
};
