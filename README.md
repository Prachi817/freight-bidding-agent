# Freight Bidding Agent MVP

Automated freight quoting agent that replaces a 3–24 hour manual workflow with near real-time quotes.

## Quick Start

```bash
# Install dependencies
npm install

# Run without an API key (no setup needed)
node src/cli.js --no-ai

# Other scenarios
node src/cli.js --no-ai --preferred     # preferred customer pricing (5% markup)
node src/cli.js --no-ai --hazmat        # hazmat cargo
node src/cli.js --no-ai --refrigerated  # refrigerated, tight timeline
```

## Using the AI Agent (requires API key)

```bash
# Get a free API key at console.anthropic.com, then:
cp .env.example .env
# edit .env → add your ANTHROPIC_API_KEY

# Run CLI with Claude orchestrating the workflow
node src/cli.js

# Or run the HTTP API server
npm start
```

## HTTP API

**POST** `/quote`

```bash
curl -X POST http://localhost:3000/quote \
  -H "Content-Type: application/json" \
  -d '{
    "origin":       { "city": "Los Angeles", "state": "CA" },
    "destination":  { "city": "Dallas",      "state": "TX" },
    "weightLbs":    22000,
    "cargoType":    "ftl",
    "timelineDays": 3
  }'
```

Add `?debug=true` to include full agent step trace in the response.

**Supported cargo types:** `ftl` | `ltl` | `hazmat` | `refrigerated` | `oversized`

### Example Response

```json
{
  "success": true,
  "quote": {
    "quoteId": "QT-1712345678-AB3XY",
    "status": "QUOTED",
    "validUntil": "2024-04-05T20:00:00.000Z",
    "shipment": {
      "origin": { "city": "Los Angeles", "state": "CA" },
      "destination": { "city": "Dallas", "state": "TX" },
      "weightLbs": 22000,
      "cargoType": "ftl",
      "requestedDeliveryDays": 3
    },
    "selectedCarrier": {
      "id": "ECHO",
      "name": "Echo Global Logistics",
      "transitDays": 3,
      "reliability": "94%"
    },
    "pricing": {
      "carrierCost": 4823.50,
      "markupPct": 10,
      "markupAmount": 482.35,
      "customerPrice": 5305.85,
      "currency": "USD",
      "pricingTier": "Standard"
    },
    "marketContext": {
      "carriersQueried": 5,
      "competitiveRank": "Lowest available rate"
    }
  }
}
```

## Customer Tiers & Markup

| Customer ID | Tier | Markup |
|---|---|---|
| (none) | Standard | 10% |
| CUST-PREFERRED-001 | Preferred Partner | 5% |
| CUST-PREFERRED-002 | Preferred Partner | 5% |
| CUST-ENTERPRISE-01 | Enterprise | 7% |

Additional cargo surcharges apply: hazmat +3%, refrigerated +2%, oversized +5%.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the agent loop, state management, production roadmap, and failure modes.

## Stack

- **Runtime:** Node.js (ESM)
- **LLM:** Claude claude-opus-4-6 via Anthropic SDK
- **Framework:** Express
- **Carrier data:** Simulated (mock rates with realistic variance)
