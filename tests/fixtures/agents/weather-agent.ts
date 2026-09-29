// A small Anthropic tool-use agent, written the way a user's agent is written,
// plus the three Blackbox lines. The CLI launcher tests run it as a child
// process. Its model upstream is a canned fake (never the network), and it
// prints how many times that upstream was called so tests can prove replay
// sends nothing.

import Anthropic from "@anthropic-ai/sdk";
import { blackbox } from "../../../src/index.ts";

const RESPONSES = [
  {
    id: "msg_01FAKEFAKEFAKEFAKEFAKE01",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [
      { type: "text", text: "Checking both cities." },
      { type: "tool_use", id: "toolu_01FAKEFAKEFAKEFAKEFAKE1", name: "weather", input: { city: "Paris" } },
      { type: "tool_use", id: "toolu_01FAKEFAKEFAKEFAKEFAKE2", name: "weather", input: { city: "Rome" } },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  },
  {
    id: "msg_01FAKEFAKEFAKEFAKEFAKE02",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "text", text: "Rome is warmer (24°C vs 18°C)." }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  },
];

let upstreamCalls = 0;
const cannedUpstream: typeof fetch = async () => {
  const body = RESPONSES[upstreamCalls++];
  if (body === undefined) throw new Error("canned upstream exhausted");
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};

const TEMPS: Record<string, number> = { Paris: 18, Rome: 24 };

const bb = blackbox({ baseFetch: cannedUpstream });
const client = new Anthropic({ fetch: bb.fetch, maxRetries: 0 });
const tools = bb.tools({
  weather: async ({ city }: { city: string }) => ({ city, temp: TEMPS[city] }),
});

const messages: Anthropic.MessageParam[] = [{ role: "user", content: process.env["AGENT_PROMPT"] ?? "Is Paris or Rome warmer?" }];
let answer = "";
for (let turn = 0; turn < 5; turn++) {
  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 256,
    tools: [{ name: "weather", description: "Current weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }],
    messages,
  });
  if (response.stop_reason !== "tool_use") {
    answer = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    break;
  }
  messages.push({ role: "assistant", content: response.content });
  const results = await Promise.all(
    response.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
      .map(async (block) => ({
        type: "tool_result" as const,
        tool_use_id: block.id,
        content: JSON.stringify(await tools.weather(block.input as { city: string })),
      })),
  );
  messages.push({ role: "user", content: results });
}

if (process.env["AGENT_CRASH"] === "1") throw new Error("agent crashed after answering");
console.log(`answer: ${answer}`);
console.log(`upstream calls: ${upstreamCalls}`);
await bb.finish();
