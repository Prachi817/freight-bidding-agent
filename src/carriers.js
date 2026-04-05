/**
 * Mock carrier data and rate simulation.
 * In production: replace with real carrier API integrations
 * (e.g. Uber Freight API, Echo Global, XPO Connect, Coyote).
 */

export const CARRIERS = [
  { id: "ECHO",    name: "Echo Global Logistics",  tier: "standard",  reliability: 0.94 },
  { id: "XPO",     name: "XPO Logistics",           tier: "premium",   reliability: 0.97 },
  { id: "COYOTE",  name: "Coyote Logistics",        tier: "standard",  reliability: 0.92 },
  { id: "UBER",    name: "Uber Freight",             tier: "standard",  reliability: 0.91 },
  { id: "CONVOY",  name: "Convoy",                   tier: "economy",   reliability: 0.89 },
  { id: "ESTES",   name: "Estes Express",            tier: "ltl",       reliability: 0.95 },
];

// Base rate matrix: $/mile by cargo type
const BASE_RATES = {
  standard:    { ftl: 2.80, ltl: 3.40, hazmat: 4.50, refrigerated: 4.20, oversized: 5.10 },
  premium:     { ftl: 3.20, ltl: 3.80, hazmat: 5.00, refrigerated: 4.80, oversized: 5.80 },
  economy:     { ftl: 2.40, ltl: 3.00, hazmat: 4.00, refrigerated: 3.90, oversized: 4.60 },
  ltl:         { ftl: 2.60, ltl: 3.20, hazmat: 4.20, refrigerated: 4.00, oversized: 4.80 },
};

// Approximate lane distances (miles) — would be geocoded in prod
const LANE_DISTANCES = {
  "CA-TX": 1560, "TX-CA": 1560,
  "NY-FL": 1280, "FL-NY": 1280,
  "IL-GA": 730,  "GA-IL": 730,
  "WA-AZ": 1420, "AZ-WA": 1420,
  "OH-NC": 560,  "NC-OH": 560,
  "DEFAULT": 900,
};

/**
 * Weight surcharge tiers (lbs)
 */
function weightSurcharge(weightLbs) {
  if (weightLbs <= 10000)  return 0;
  if (weightLbs <= 20000)  return 0.08;
  if (weightLbs <= 30000)  return 0.14;
  if (weightLbs <= 44000)  return 0.20;
  return 0.28; // overweight / permit required
}

/**
 * Timeline urgency multiplier
 */
function timelineMultiplier(timelineDays) {
  if (timelineDays <= 1)  return 1.45;  // same/next day
  if (timelineDays <= 2)  return 1.25;
  if (timelineDays <= 3)  return 1.10;
  if (timelineDays <= 5)  return 1.00;
  return 0.90;                           // flexible / spot rate discount
}

/**
 * Simulate fetching a rate from a single carrier.
 * Adds realistic variance + random availability simulation.
 */
export function getCarrierRate(carrier, { origin, destination, weightLbs, cargoType, timelineDays }) {
  const laneKey = `${origin.state}-${destination.state}`;
  const distance = LANE_DISTANCES[laneKey] ?? LANE_DISTANCES["DEFAULT"];

  const tier = carrier.tier;
  const baseRatePerMile = BASE_RATES[tier]?.[cargoType] ?? BASE_RATES[tier]?.ftl ?? 3.00;

  const weightFactor    = 1 + weightSurcharge(weightLbs);
  const urgencyFactor   = timelineMultiplier(timelineDays);

  // Add ±8% market variance per carrier
  const variance = 1 + (Math.random() * 0.16 - 0.08);

  const rawRate = distance * baseRatePerMile * weightFactor * urgencyFactor * variance;
  const rate    = Math.round(rawRate * 100) / 100;

  // Simulate ~15% chance a carrier is unavailable for the lane
  const available = Math.random() > 0.15;

  const transitDays = Math.ceil(distance / 500) + (timelineDays <= 2 ? 0 : 1);

  return {
    carrierId:    carrier.id,
    carrierName:  carrier.name,
    available,
    rate,
    currency:     "USD",
    distance,
    transitDays,
    reliability:  carrier.reliability,
    expiresAt:    new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // 4hr quote window
    notes:        available ? null : "No capacity on this lane for requested dates",
  };
}

/**
 * Fetch rates from all carriers (simulates parallel API calls).
 */
export function getAllCarrierRates(shipmentDetails) {
  return CARRIERS.map(c => getCarrierRate(c, shipmentDetails));
}
