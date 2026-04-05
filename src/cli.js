/**
 * CLI runner — lets you test the agent directly without the HTTP server.
 * Usage: node src/cli.js
 *        node src/cli.js --preferred   (use preferred customer pricing)
 *        node src/cli.js --hazmat      (hazmat cargo scenario)
 */

import "dotenv/config";
import { runFreightAgent } from "./agent.js";

const args = process.argv.slice(2);

// ─── Sample Scenarios ─────────────────────────────────────────────────────────

const SCENARIOS = {
  default: {
    label: "Standard FTL — LA to Dallas, 3-day window",
    request: {
      origin:       { city: "Los Angeles", state: "CA", zipCode: "90001" },
      destination:  { city: "Dallas",      state: "TX", zipCode: "75201" },
      weightLbs:    22000,
      cargoType:    "ftl",
      timelineDays: 3,
    },
  },
  preferred: {
    label: "Preferred Customer — NY to Miami, next-day LTL",
    request: {
      origin:       { city: "New York",  state: "NY", zipCode: "10001" },
      destination:  { city: "Miami",     state: "FL", zipCode: "33101" },
      weightLbs:    8500,
      cargoType:    "ltl",
      timelineDays: 2,
      customerId:   "CUST-PREFERRED-001",
    },
  },
  hazmat: {
    label: "Hazmat — Chicago to Atlanta, flexible timeline",
    request: {
      origin:       { city: "Chicago",  state: "IL", zipCode: "60601" },
      destination:  { city: "Atlanta",  state: "GA", zipCode: "30301" },
      weightLbs:    15000,
      cargoType:    "hazmat",
      timelineDays: 7,
    },
  },
  refrigerated: {
    label: "Refrigerated — Seattle to Phoenix, tight window",
    request: {
      origin:       { city: "Seattle",  state: "WA", zipCode: "98101" },
      destination:  { city: "Phoenix",  state: "AZ", zipCode: "85001" },
      weightLbs:    30000,
      cargoType:    "refrigerated",
      timelineDays: 2,
    },
  },
};

function pickScenario() {
  if (args.includes("--preferred"))    return SCENARIOS.preferred;
  if (args.includes("--hazmat"))       return SCENARIOS.hazmat;
  if (args.includes("--refrigerated")) return SCENARIOS.refrigerated;
  return SCENARIOS.default;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const scenario = pickScenario();

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║         FREIGHT BIDDING AGENT — CLI Runner          ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");
  console.log(`Scenario: ${scenario.label}`);
  console.log("Request:", JSON.stringify(scenario.request, null, 2));
  console.log("\n── Agent running... ──────────────────────────────────\n");

  const startTime = Date.now();

  try {
    const result = await runFreightAgent(scenario.request, {
      onStep: (step) => {
        if (step.type === "tool_call" && step.status === "running") {
          process.stdout.write(`  ▸ ${step.toolName}... `);
        }
        if (step.type === "tool_call" && step.status === "done") {
          console.log("done");
        }
        if (step.type === "reasoning" && step.text.trim()) {
          console.log(`\n  Agent: ${step.text.trim()}\n`);
        }
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log("\n── Quote Output ──────────────────────────────────────\n");

    if (result.quote) {
      const q = result.quote;
      console.log(`Quote ID:       ${q.quoteId}`);
      console.log(`Valid Until:    ${new Date(q.validUntil).toLocaleString()}`);
      console.log(`\nShipment:`);
      console.log(`  ${q.shipment.origin.city}, ${q.shipment.origin.state} → ${q.shipment.destination.city}, ${q.shipment.destination.state}`);
      console.log(`  ${q.shipment.weightLbs.toLocaleString()} lbs | ${q.shipment.cargoType.toUpperCase()} | ${q.shipment.requestedDeliveryDays}-day window`);
      console.log(`\nSelected Carrier: ${q.selectedCarrier.name}`);
      console.log(`  Transit:     ${q.selectedCarrier.transitDays} days`);
      console.log(`  Reliability: ${q.selectedCarrier.reliability}`);
      console.log(`\nPricing (${q.pricing.pricingTier}):`);
      console.log(`  Carrier Cost:    $${q.pricing.carrierCost.toLocaleString()}`);
      console.log(`  Markup:          ${q.pricing.markupPct}% (+$${q.pricing.markupAmount.toLocaleString()})`);
      console.log(`  ─────────────────────────────`);
      console.log(`  Customer Price:  $${q.pricing.customerPrice.toLocaleString()} USD`);
      console.log(`\nMarket Context: ${q.marketContext.carriersQueried} carriers queried`);
    }

    if (result.summary) {
      console.log(`\nAgent Summary:\n${result.summary}`);
    }

    console.log(`\nCompleted in ${elapsed}s (${result.iterations} agent iteration${result.iterations !== 1 ? "s" : ""})`);

  } catch (err) {
    console.error("\nFatal error:", err.message);
    if (err.status === 401) {
      console.error("→ Check your ANTHROPIC_API_KEY in .env");
    }
    process.exit(1);
  }
}

main();
