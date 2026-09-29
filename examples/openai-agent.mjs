// A small OpenAI Chat Completions tool-use agent with Blackbox wired in (the four
// marked lines). Run it through the CLI:
//
//   npx blackbox record --out runs/trip-openai.json -- node examples/openai-agent.mjs
//   npx blackbox replay runs/trip-openai.json -- node examples/openai-agent.mjs
//
// Recording and `fork --live` call the real API with your OPENAI_API_KEY.

import OpenAI from "openai";
import { blackbox } from "@ardaulas/blackbox";

const WEATHER = { Lisbon: { tempC: 24, sky: "sunny" }, Oslo: { tempC: 6, sky: "rain" } };

async function getWeather({ city }) {
  return WEATHER[city] ?? { error: `no data for ${city}` };
}

const bb = blackbox(); //                                    ← Blackbox
const client = new OpenAI({ fetch: bb.fetch }); //           ← Blackbox
const tools = bb.tools({ get_weather: getWeather }); //      ← Blackbox

const messages = [
  { role: "user", content: "I can go to Lisbon or Oslo this weekend. Which has better weather? Answer in one sentence." },
];
const toolSpecs = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Weekend forecast for a city",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    },
  },
];

for (let turn = 0; turn < 6; turn++) {
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
    messages,
    tools: toolSpecs,
  });
  const message = response.choices[0].message;
  if (!message.tool_calls?.length) {
    console.log(message.content);
    break;
  }
  messages.push(message);
  for (const call of message.tool_calls) {
    const output = await tools[call.function.name](JSON.parse(call.function.arguments));
    messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output) });
  }
}

await bb.finish(); //                                        ← Blackbox
