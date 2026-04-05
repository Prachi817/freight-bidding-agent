# Freight Bidding Agent — Architecture

## Agent Loop

```
User Request
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Claude (claude-opus-4-6)                  │
│                                                              │
│  System Prompt: workflow rules + domain context              │
│                                                              │
│  Turn 1: validate_shipment ──────────────► normalize input   │
│  Turn 2: fetch_carrier_rates ───────────► 6 parallel quotes  │
│  Turn 3: select_best_rate ──────────────► score + rank       │
│  Turn 4: apply_customer_markup ─────────► tier-based pricing │
│  Turn 5: generate_quote ────────────────► structured output  │
│                                                              │
│  stop_reason = "end_turn" → return result                    │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
Structured Quote JSON
```

The agent uses Claude's `tool_use` capability. Each tool call is a real function executed server-side. Claude decides call order and handles error cases (e.g. no available carriers) through natural language reasoning.

## State Management

State lives entirely in `messages[]` — the conversation history passed to Claude on each API call. No external state store. Each tool result is appended as a `tool_result` block, giving Claude full context at every step.

```
messages = [
  { role: "user",      content: "Quote request JSON" },
  { role: "assistant", content: [tool_use: validate_shipment] },
  { role: "user",      content: [tool_result: { valid: true, normalized: {...} }] },
  { role: "assistant", content: [tool_use: fetch_carrier_rates] },
  ... and so on
]
```

This is simple and auditable. Downside: latency scales with message count. For production, compress/summarize early turns once validation is confirmed.

## Production Swap-Ins

| Component | Current (MVP) | Production |
|---|---|---|
| Carrier rates | Mock with variance simulation | Real carrier APIs (Uber Freight, Echo, XPO) |
| Lane distances | Static lookup table | Google Maps / HERE geocoding |
| Customer tiers | In-memory hardcoded map | CRM / Postgres customer table |
| Markup rules | Simple percentage tiers | Dynamic rules engine per lane/customer/season |
| State storage | In-memory messages[] | Redis session store for async/polling |
| API auth | None | API keys / JWT |
| Rate caching | None | TTL cache (carrier quotes valid ~4hrs) |
| Observability | console.log | OpenTelemetry traces per tool call |

## Failure Modes & Handling

| Failure | Current Handling | Production Approach |
|---|---|---|
| Validation error | Agent returns errors, halts | HTTP 400 with field-level errors |
| All carriers unavailable | Agent surfaces message, suggests timeline extension | Trigger human escalation queue |
| Carrier API timeout | N/A (mock) | Per-carrier timeout (3s), skip unavailable, log |
| Claude API error | Propagates as HTTP 500 | Retry with exponential backoff (max 3x) |
| Infinite agent loop | MAX_ITERATIONS=10 guard | Same + timeout budget per request |
| Stale quotes | 4hr expiry on quote object | Re-quote check before booking confirmation |
| Overweight cargo | Validation flags >80k lbs | Route to permit specialist |

## What I'd Build Next

1. **Async quote jobs** — POST `/quote` returns a job ID immediately; client polls `/quote/:id`. Enables parallel carrier API calls without HTTP timeout.
2. **Carrier API integrations** — Uber Freight and Echo Global both have REST APIs. Rate fetch becomes genuinely parallel (Promise.all).
3. **Quote history + rebid** — Store quotes in Postgres. Allow customers to rebid on expiry or benchmark against spot market.
4. **Booking flow** — Accept quote → lock carrier → generate BOL → send pickup confirmation.
5. **Rate intelligence** — Track historical rates per lane to flag outliers and improve markup strategy.
