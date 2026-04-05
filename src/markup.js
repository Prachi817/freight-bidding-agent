/**
 * Markup rules engine.
 *
 * In production this would pull from a customer CRM / pricing DB.
 * Rules are applied in priority order — first match wins.
 */

const CUSTOMER_TIERS = {
  // customerId -> tier config
  "CUST-PREFERRED-001": { tier: "preferred",  markupPct: 5,  label: "Preferred Partner"    },
  "CUST-PREFERRED-002": { tier: "preferred",  markupPct: 5,  label: "Preferred Partner"    },
  "CUST-ENTERPRISE-01": { tier: "enterprise", markupPct: 7,  label: "Enterprise Account"   },
};

const TIER_DEFAULTS = {
  preferred:  { markupPct: 5  },
  enterprise: { markupPct: 7  },
  standard:   { markupPct: 10 },
};

const CARGO_SURCHARGES = {
  hazmat:       3.0,   // % additional for hazmat handling
  refrigerated: 2.0,
  oversized:    5.0,
};

/**
 * Returns the markup config for a customer.
 * Falls back to standard 10% if customer not found.
 */
export function getMarkupConfig(customerId) {
  if (customerId && CUSTOMER_TIERS[customerId]) {
    return CUSTOMER_TIERS[customerId];
  }
  return { tier: "standard", markupPct: 10, label: "Standard" };
}

/**
 * Applies markup to a carrier base rate and returns full pricing breakdown.
 */
export function applyMarkup(baseRate, { customerId, cargoType }) {
  const config      = getMarkupConfig(customerId);
  const cargoAdder  = CARGO_SURCHARGES[cargoType] ?? 0;
  const totalMarkup = config.markupPct + cargoAdder;

  const markupAmount = Math.round(baseRate * (totalMarkup / 100) * 100) / 100;
  const customerRate = Math.round((baseRate + markupAmount) * 100) / 100;

  return {
    baseRate,
    markupPct:      totalMarkup,
    markupAmount,
    customerRate,
    currency:       "USD",
    customerTier:   config.tier,
    customerLabel:  config.label,
    breakdown: {
      baseMarkupPct:  config.markupPct,
      cargoSurchargePct: cargoAdder,
    },
  };
}
