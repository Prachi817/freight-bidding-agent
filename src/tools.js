/**
 * Tool definitions and implementations for the freight bidding agent.
 *
 * Each tool maps directly to a Claude tool_use block.
 * The agent decides which tools to call and in what order.
 */

import { getAllCarrierRates } from "./carriers.js";
import { applyMarkup, getMarkupConfig }        from "./markup.js";

// ─── Tool Schemas (sent to Claude) ────────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: "validate_shipment",
    description:
      "Validates a freight shipment request and normalizes fields. " +
      "Returns errors if required fields are missing or values are out of range. " +
      "Always call this first.",
    input_schema: {
      type: "object",
      properties: {
        origin: {
          type: "object",
          description: "Origin location",
          properties: {
            city:    { type: "string" },
            state:   { type: "string", description: "2-letter US state code" },
            zipCode: { type: "string" },
          },
          required: ["city", "state"],
        },
        destination: {
          type: "object",
          description: "Destination location",
          properties: {
            city:    { type: "string" },
            state:   { type: "string" },
            zipCode: { type: "string" },
          },
          required: ["city", "state"],
        },
        weightLbs: {
          type: "number",
          description: "Total shipment weight in pounds",
        },
        cargoType: {
          type: "string",
          enum: ["ftl", "ltl", "hazmat", "refrigerated", "oversized"],
          description: "Type of freight/cargo",
        },
        timelineDays: {
          type: "number",
          description: "Required delivery window in days from today",
        },
        customerId: {
          type: "string",
          description: "Optional customer ID for tier-based pricing",
        },
      },
      required: ["origin", "destination", "weightLbs", "cargoType", "timelineDays"],
    },
  },
  {
    name: "fetch_carrier_rates",
    description:
      "Fetches real-time rate quotes from all available carriers for the shipment. " +
      "Returns a list of carrier quotes including price, transit time, and availability.",
    input_schema: {
      type: "object",
      properties: {
        origin:       { type: "object", properties: { city: { type: "string" }, state: { type: "string" } }, required: ["city", "state"] },
        destination:  { type: "object", properties: { city: { type: "string" }, state: { type: "string" } }, required: ["city", "state"] },
        weightLbs:    { type: "number" },
        cargoType:    { type: "string" },
        timelineDays: { type: "number" },
      },
      required: ["origin", "destination", "weightLbs", "cargoType", "timelineDays"],
    },
  },
  {
    name: "select_best_rate",
    description:
      "Benchmarks all carrier quotes and selects the best one based on price, " +
      "availability, reliability, and transit time. Returns the winning carrier with reasoning.",
    input_schema: {
      type: "object",
      properties: {
        quotes: {
          type: "array",
          description: "Array of carrier quotes from fetch_carrier_rates",
          items: { type: "object" },
        },
        timelineDays: {
          type: "number",
          description: "Required delivery days (used to filter out slow carriers)",
        },
      },
      required: ["quotes", "timelineDays"],
    },
  },
  {
    name: "apply_customer_markup",
    description:
      "Applies the appropriate markup to the selected carrier rate based on customer tier. " +
      "Returns the final customer-facing price with full breakdown.",
    input_schema: {
      type: "object",
      properties: {
        baseRate:   { type: "number", description: "Carrier's base rate in USD" },
        customerId: { type: "string", description: "Customer ID (optional)" },
        cargoType:  { type: "string", description: "Cargo type for surcharge calculation" },
      },
      required: ["baseRate", "cargoType"],
    },
  },
  {
    name: "generate_quote",
    description:
      "Assembles the final structured freight quote from all collected data. " +
      "Call this last once you have the selected carrier and pricing.",
    input_schema: {
      type: "object",
      properties: {
        shipmentDetails: { type: "object", description: "Original validated shipment request" },
        selectedCarrier: { type: "object", description: "The winning carrier quote object" },
        pricing:         { type: "object", description: "Pricing breakdown from apply_customer_markup" },
        allQuotes:       { type: "array",  description: "All carrier quotes for transparency" },
      },
      required: ["shipmentDetails", "selectedCarrier", "pricing"],
    },
  },
];

// ─── Tool Implementations ──────────────────────────────────────────────────────

export function executeTool(toolName, input) {
  switch (toolName) {
    case "validate_shipment":        return validateShipment(input);
    case "fetch_carrier_rates":      return fetchCarrierRates(input);
    case "select_best_rate":         return selectBestRate(input);
    case "apply_customer_markup":    return applyCustomerMarkup(input);
    case "generate_quote":           return generateQuote(input);
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

function validateShipment(input) {
  const errors = [];

  if (!input.origin?.city || !input.origin?.state)           errors.push("origin.city and origin.state are required");
  if (!input.destination?.city || !input.destination?.state) errors.push("destination.city and destination.state are required");
  if (!input.weightLbs || input.weightLbs <= 0)              errors.push("weightLbs must be a positive number");
  if (input.weightLbs > 80000)                               errors.push("weightLbs exceeds legal limit of 80,000 lbs; permit required");
  if (!input.cargoType)                                      errors.push("cargoType is required");
  if (!input.timelineDays || input.timelineDays <= 0)        errors.push("timelineDays must be positive");

  const validCargo = ["ftl", "ltl", "hazmat", "refrigerated", "oversized"];
  if (input.cargoType && !validCargo.includes(input.cargoType)) {
    errors.push(`cargoType must be one of: ${validCargo.join(", ")}`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Normalize
  return {
    valid: true,
    normalized: {
      origin:       { city: input.origin.city, state: input.origin.state.toUpperCase(), zipCode: input.origin.zipCode },
      destination:  { city: input.destination.city, state: input.destination.state.toUpperCase(), zipCode: input.destination.zipCode },
      weightLbs:    Number(input.weightLbs),
      cargoType:    input.cargoType.toLowerCase(),
      timelineDays: Number(input.timelineDays),
      customerId:   input.customerId || null,
      requestedAt:  new Date().toISOString(),
    },
  };
}

function fetchCarrierRates(input) {
  const quotes = getAllCarrierRates(input);
  const available = quotes.filter(q => q.available);
  const unavailable = quotes.filter(q => !q.available);

  return {
    totalCarriersQueried: quotes.length,
    availableQuotes:      available.length,
    quotes:               available,
    unavailableCarriers:  unavailable.map(q => ({ carrierId: q.carrierId, reason: q.notes })),
    fetchedAt:            new Date().toISOString(),
  };
}

function selectBestRate({ quotes, timelineDays }) {
  if (!quotes || quotes.length === 0) {
    return { error: "No available carrier quotes to evaluate" };
  }

  // Filter: carrier transit must fit timeline
  const viable = quotes.filter(q => q.transitDays <= timelineDays + 1);

  if (viable.length === 0) {
    // Relax: just take what's available
    viable.push(...quotes);
  }

  // Score: lower rate is better, but weight reliability
  // Score = rate * (2 - reliability) — penalizes unreliable carriers
  const scored = viable.map(q => ({
    ...q,
    score: q.rate * (2 - q.reliability),
  }));

  scored.sort((a, b) => a.score - b.score);

  const winner    = scored[0];
  const runnerUp  = scored[1] ?? null;
  const savings   = runnerUp ? Math.round((runnerUp.rate - winner.rate) * 100) / 100 : 0;

  return {
    selected:   winner,
    runnerUp,
    allRanked:  scored.map(({ carrierId, carrierName, rate, transitDays, reliability, score }) =>
                  ({ carrierId, carrierName, rate, transitDays, reliability, score: Math.round(score * 100) / 100 })),
    reasoning: `Selected ${winner.carrierName} at $${winner.rate} (score: ${Math.round(winner.score * 100) / 100}). ` +
               `${savings > 0 ? `Saves $${savings} over next best option.` : "Only viable option."}`,
  };
}

function applyCustomerMarkup({ baseRate, customerId, cargoType }) {
  const pricing = applyMarkup(baseRate, { customerId, cargoType });
  const config  = getMarkupConfig(customerId);
  return {
    ...pricing,
    appliedRule: `${config.label} — ${pricing.markupPct}% markup`,
  };
}

function generateQuote({ shipmentDetails, selectedCarrier, pricing, allQuotes }) {
  const quoteId   = `QT-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const validUntil = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

  return {
    quoteId,
    status:     "QUOTED",
    validUntil,
    generatedAt: new Date().toISOString(),

    shipment: {
      origin:       shipmentDetails.origin,
      destination:  shipmentDetails.destination,
      weightLbs:    shipmentDetails.weightLbs,
      cargoType:    shipmentDetails.cargoType,
      requestedDeliveryDays: shipmentDetails.timelineDays,
    },

    selectedCarrier: {
      id:           selectedCarrier.carrierId,
      name:         selectedCarrier.carrierName,
      transitDays:  selectedCarrier.transitDays,
      reliability:  `${(selectedCarrier.reliability * 100).toFixed(0)}%`,
      quoteExpires: selectedCarrier.expiresAt,
    },

    pricing: {
      carrierCost:    pricing.baseRate,
      markupPct:      pricing.markupPct,
      markupAmount:   pricing.markupAmount,
      customerPrice:  pricing.customerRate,
      currency:       "USD",
      pricingTier:    pricing.customerLabel,
      breakdown:      pricing.breakdown,
    },

    marketContext: {
      carriersQueried:   allQuotes?.length ?? 1,
      competitiveRank:   "Lowest available rate",
    },

    nextSteps: [
      "Accept quote to lock in rate",
      "Provide pickup address and contact",
      "Schedule pickup window",
    ],
  };
}
