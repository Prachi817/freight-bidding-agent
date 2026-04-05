/**
 * Express HTTP server — exposes the freight agent as a REST API.
 *
 * POST /quote   — run the full agent and return a structured quote
 * GET  /health  — liveness check
 */

import "dotenv/config";
import express  from "express";
import { runFreightAgent } from "./agent.js";

const app  = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "freight-bidding-agent", ts: new Date().toISOString() });
});

/**
 * POST /quote
 *
 * Body:
 * {
 *   "origin":       { "city": "Los Angeles", "state": "CA" },
 *   "destination":  { "city": "Dallas", "state": "TX" },
 *   "weightLbs":    18000,
 *   "cargoType":    "ftl",
 *   "timelineDays": 3,
 *   "customerId":   "CUST-PREFERRED-001"   // optional
 * }
 */
app.post("/quote", async (req, res) => {
  const startTime = Date.now();

  try {
    const freightRequest = req.body;

    // Basic presence check before hitting the agent
    if (!freightRequest || typeof freightRequest !== "object") {
      return res.status(400).json({ error: "Request body must be a JSON object" });
    }

    const agentSteps = [];

    const result = await runFreightAgent(freightRequest, {
      onStep: (step) => {
        agentSteps.push(step);
        // Log progress to server console
        if (step.type === "tool_call") {
          console.log(`  [${step.status}] ${step.toolName}`);
        }
      },
    });

    const elapsed = Date.now() - startTime;
    console.log(`Quote generated in ${elapsed}ms — ${result.quote?.quoteId ?? "no quote"}`);

    return res.json({
      success:    true,
      quote:      result.quote,
      summary:    result.summary,
      meta: {
        agentIterations: result.iterations,
        processingMs:    elapsed,
      },
      // Include step trace for debugging (omit in prod or gate behind ?debug=true)
      ...(req.query.debug === "true" && { steps: result.steps }),
    });

  } catch (err) {
    console.error("Agent error:", err);

    const statusCode = err.status ?? 500;
    return res.status(statusCode).json({
      success: false,
      error:   err.message ?? "Internal agent error",
      ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
    });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Freight Bidding Agent running on http://localhost:${PORT}`);
  console.log(`  POST /quote   — request a freight quote`);
  console.log(`  GET  /health  — liveness check`);
});
