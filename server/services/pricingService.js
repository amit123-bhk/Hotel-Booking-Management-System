const { col } = require('../db/database');

const TAX_RATE = 0.12; // 12% Hotel Occupancy Tax
const RESORT_FEE_PER_NIGHT_CENTS = 2500; // $25.00/night

const AVAILABLE_ADD_ONS = [
  {
    id: 'breakfast',
    name: 'Daily Breakfast Buffet',
    description: 'Full morning buffet with freshly baked pastries, juice, coffee, and hot entrees',
    price_cents: 2500,
    per_night: true
  },
  {
    id: 'airport_shuttle',
    name: 'Private Airport Transfer',
    description: 'Direct sedan transfer between Goa International Airport (Dabolim) and the hotel',
    price_cents: 6000,
    per_night: false
  },
  {
    id: 'spa_pass',
    name: 'Thermal Spa Day Pass',
    description: 'Full-day access to sauna, salt room, cold plunge, and thermal pools',
    price_cents: 4500,
    per_night: false
  },
  {
    id: 'late_checkout',
    name: 'Guaranteed 15:00 Late Check-Out',
    description: 'Extended room access on departure day until 3:00 PM',
    price_cents: 3500,
    per_night: false
  }
];

function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Calculate itemized price breakdown for a stay
 */
async function calculateStayPricing({ roomTypeId, checkIn, checkOut, selectedAddOnIds = [] }) {
  const roomType = await col('room_types').findOne({ id: Number(roomTypeId) });
  if (!roomType) {
    const error = new Error('Room type not found');
    error.status = 404;
    throw error;
  }

  const startDate = parseDate(checkIn);
  const endDate = parseDate(checkOut);
  const diffTime = endDate - startDate;
  const nights = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (nights <= 0) {
    const error = new Error('Check-out date must be strictly after check-in date');
    error.status = 400;
    throw error;
  }
  if (nights > 30) {
    const error = new Error('Maximum reservation stay is 30 consecutive nights');
    error.status = 400;
    throw error;
  }

  const modifiers = await col('rate_modifiers').find({ is_active: 1 }).toArray();
  const weekendMod = modifiers.find(m => m.modifier_type === 'WEEKEND');
  const seasonalMods = modifiers.filter(m => m.modifier_type === 'SEASONAL' || m.modifier_type === 'HOLIDAY');

  const nightBreakdown = [];
  let totalBaseCents = 0;

  for (let i = 0; i < nights; i++) {
    const currentDate = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    const dayOfWeek = currentDate.getUTCDay();
    const isWeekend = (dayOfWeek === 5 || dayOfWeek === 6);
    const isoDate = currentDate.toISOString().split('T')[0];

    let multiplier = 1.0;
    let rateLabel = 'Standard Nightly Rate';

    if (isWeekend && weekendMod) {
      multiplier *= weekendMod.multiplier;
      rateLabel = `Weekend Rate (+${Math.round((weekendMod.multiplier - 1) * 100)}%)`;
    }

    for (const sm of seasonalMods) {
      if (sm.start_date && sm.end_date && isoDate >= sm.start_date && isoDate <= sm.end_date) {
        multiplier *= sm.multiplier;
        rateLabel += ` + ${sm.name}`;
      }
    }

    const nightlyCost = Math.round(roomType.base_price_cents * multiplier);
    totalBaseCents += nightlyCost;

    nightBreakdown.push({
      date: isoDate,
      day: currentDate.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      rate_cents: nightlyCost,
      rate_formatted: formatDollars(nightlyCost),
      label: rateLabel
    });
  }

  const resolvedAddOns = [];
  let totalAddOnsCents = 0;

  for (const addOnId of selectedAddOnIds) {
    const found = AVAILABLE_ADD_ONS.find(a => a.id === addOnId);
    if (found) {
      const cost = found.per_night ? (found.price_cents * nights) : found.price_cents;
      totalAddOnsCents += cost;
      resolvedAddOns.push({
        id: found.id,
        name: found.name,
        unit_price_cents: found.price_cents,
        total_cents: cost,
        total_formatted: formatDollars(cost),
        per_night: found.per_night
      });
    }
  }

  const taxesCents = Math.round((totalBaseCents + totalAddOnsCents) * TAX_RATE);
  const feesCents = RESORT_FEE_PER_NIGHT_CENTS * nights;
  const totalPriceCents = totalBaseCents + totalAddOnsCents + taxesCents + feesCents;

  return {
    room_type_id: roomType.id,
    room_type_name: roomType.name,
    check_in: checkIn,
    check_out: checkOut,
    nights,
    night_breakdown: nightBreakdown,
    base_price_cents: totalBaseCents,
    base_price_formatted: formatDollars(totalBaseCents),
    add_ons: resolvedAddOns,
    add_ons_price_cents: totalAddOnsCents,
    add_ons_price_formatted: formatDollars(totalAddOnsCents),
    taxes_cents: taxesCents,
    taxes_formatted: formatDollars(taxesCents),
    fees_cents: feesCents,
    fees_formatted: formatDollars(feesCents),
    total_price_cents: totalPriceCents,
    total_price_formatted: formatDollars(totalPriceCents)
  };
}

module.exports = {
  AVAILABLE_ADD_ONS,
  calculateStayPricing,
  formatDollars
};
