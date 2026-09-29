// The fleet-triage agent loop: an ordinary Anthropic tool-use loop. Blackbox is
// not mentioned here; agent.mjs wires it in.

import { TOOL_SPECS } from "./tools.mjs";

export const SYSTEM_PROMPT =
  "You triage maintenance tickets for a delivery-van fleet. Use the tools to look up the fault code and the " +
  "vehicle's current state, then open exactly one work order with the right priority: urgent (remove from " +
  "service now), soon (within 48 hours) or routine (next scheduled service). Finish with two sentences for the " +
  "dispatcher: the priority and why.";

export const DEFAULT_TICKET =
  "Telematics alert for VAN-14: check-engine light on, DTC P0217 set at 2026-09-29T07:58:00Z. Please triage.";

export async function runTriage({ client, tools, ticket = DEFAULT_TICKET, model = "claude-haiku-4-5" }) {
  const messages = [{ role: "user", content: ticket }];
  for (let turn = 0; turn < 8; turn++) {
    const response = await client.messages.create({
      model,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      tools: TOOL_SPECS,
      messages,
    });
    if (response.stop_reason !== "tool_use") {
      return response.content.filter((block) => block.type === "text").map((block) => block.text).join("");
    }
    messages.push({ role: "assistant", content: response.content });
    const results = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const output = await tools[block.name](block.input);
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(output) });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("triage did not finish in 8 turns");
}
