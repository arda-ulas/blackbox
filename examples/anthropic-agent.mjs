// A small Anthropic tool-use agent with Blackbox wired in (the four marked lines).
// Run it through the CLI:
//
//   npx blackbox record --out runs/trip.json -- node examples/anthropic-agent.mjs
//   npx blackbox replay runs/trip.json -- node examples/anthropic-agent.mjs
//
// Recording and `fork --live` call the real API with your ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";
import { blackbox } from "@ardaulas/blackbox";

const WEATHER = { Lisbon: { tempC: 24, sky: "sunny" }, Oslo: { tempC: 6, sky: "rain" } };

async function getWeather({ city }) {
  return WEATHER[city] ?? { error: `no data for ${city}` };
}

const bb = blackbox(); //                                    ← Blackbox
const client = new Anthropic({ fetch: bb.fetch }); //        ← Blackbox
const tools = bb.tools({ get_weather: getWeather }); //      ← Blackbox

const messages = [{ role: "user", content: "I can go to Lisbon or Oslo this weekend. Which has better weather? Answer in one sentence." }];
const toolSpecs = [
  {
    name: "get_weather",
    description: "Weekend forecast for a city",
    input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
];

for (let turn = 0; turn < 6; turn++) {
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
    max_tokens: 400,
    tools: toolSpecs,
    messages,
  });
  if (response.stop_reason !== "tool_use") {
    console.log(response.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
    break;
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

await bb.finish(); //                                        ← Blackbox
