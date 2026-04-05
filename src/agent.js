/**
 * Freight Bidding Agent — core agentic loop.
 *
 * Uses Claude with tool_use to orchestrate the quoting workflow:
 *   validate → fetch rates → select best → apply markup → generate quote
 *
 * State is maintained in `messages[]` — the full conversation history
 * passed to Claude on every turn (stateless API, stateful client).
 */

import Anthropic from "@anthropic-ai/sdk";
import { TOOL_DEFINITIONS, executeTool } from "./tools.js";

const MAX_ITERATIONS = 10; // guard against infinite loops

const SYSTEM_PROMPT = `You are a freight bidding agent for an Amazon Prep logistics broker.
Your job is to produce the best possible freight quote for inbound shipment requests.

Follow this exact workflow using the tools provided:
1. Call validate_shipment to normalize and validate the request
2. Call fetch_carrier_rates with the validated shipment details
3. Call select_best_rate with the returned quotes and timeline
4. Call apply_customer_markup with the selected carrier's rate
5. Call generate_quote to assemble the final structured output

Rules:
- Always validate first. If validation fails, return the errors clearly — do not proceed.
- Never skip a step. Each tool's output feeds the next.
- If no carriers are available, explain why and suggest alternatives (extend timeline, split LTL).
- Be concise in your reasoning between tool calls.
- After generate_quote, present the final quote to the user in a clean, readable format.`;

export async function runFreightAgent(freightRequest, { apiKey, onStep } = {}) {
  const client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });

  // Initial user message
  const messages = [
    {
      role: "user",
      content: `Please provide a freight quote for the following request:\n\n${JSON.stringify(freightRequest, null, 2)}`,
    },
  ];

  const steps   = [];
  let finalQuote = null;
  let iteration  = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    const response = await client.messages.create({
      model:      "claude-opus-4-6",
      max_tokens: 4096,
      system:     SYSTEM_PROMPT,
      tools:      TOOL_DEFINITIONS,
      messages,
    });

    // Collect any text the model emitted
    const textBlocks = response.content.filter(b => b.type === "text");
    if (textBlocks.length > 0) {
      const text = textBlocks.map(b => b.text).join("\n");
      steps.push({ type: "reasoning", text });
      onStep?.({ type: "reasoning", text });
    }

    // If the model is done (no more tool calls)
    if (response.stop_reason === "end_turn") {
      break;
    }

    // Process tool calls
    const toolUseBlocks = response.content.filter(b => b.type === "tool_use");
    if (toolUseBlocks.length === 0) break;

    // Append assistant message with all content blocks
    messages.push({ role: "assistant", content: response.content });

    // Execute each tool and build the tool_result message
    const toolResults = [];

    for (const toolUse of toolUseBlocks) {
      const stepInfo = {
        type:      "tool_call",
        toolName:  toolUse.name,
        input:     toolUse.input,
      };

      onStep?.({ ...stepInfo, status: "running" });

      let result;
      try {
        result = executeTool(toolUse.name, toolUse.input);
      } catch (err) {
        result = { error: err.message };
      }

      stepInfo.output = result;
      steps.push(stepInfo);
      onStep?.({ ...stepInfo, status: "done" });

      // Capture the final quote when generated
      if (toolUse.name === "generate_quote" && !result.error) {
        finalQuote = result;
      }

      toolResults.push({
        type:        "tool_result",
        tool_use_id: toolUse.id,
        content:     JSON.stringify(result),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  // Extract final assistant text summary
  const lastAssistantMsg = [...messages].reverse().find(m => m.role === "assistant");
  const summary = lastAssistantMsg
    ? lastAssistantMsg.content
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("\n")
    : "";

  return {
    quote:   finalQuote,
    summary,
    steps,
    iterations: iteration,
  };
}
