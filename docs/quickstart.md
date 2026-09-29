# Quickstart

This takes about ten minutes with an agent you already have. You need Node.js 22+ and an agent that uses
`@anthropic-ai/sdk` (`messages.create`) or `openai` (`chat.completions.create`).

## 1. Install

```bash
npm install --save-dev @ardaulas/blackbox
```

## 2. Add the session

Where your agent creates its client and tool functions:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { blackbox } from "@ardaulas/blackbox";

const bb = blackbox();                                // does nothing unless run under `blackbox`
const client = new Anthropic({ fetch: bb.fetch });    // OpenAI: new OpenAI({ fetch: bb.fetch })
const tools = bb.tools({ get_weather, book_hotel });  // same functions, same arguments; results become Promises
```

Call your tools through `tools.get_weather(...)` instead of `get_weather(...)`, and end the run with:

```ts
await bb.finish();
```

Outside `blackbox record|replay|fork`, the session passes everything through untouched, so these lines can stay in
your code. The keys of `bb.tools({...})` must be the tool names the model uses. For a different name, use
`bb.tool("get_weather", fetchForecast)`.

## 3. Record a run

```bash
npx blackbox record --out runs/trip.json -- node agent.js
```

Your agent runs normally against the real API. When it finishes, Blackbox writes `runs/trip.json` and prints
`wrote runs/trip.json (9 steps, success)` on stderr.

## 4. Replay it offline

```bash
npx blackbox replay runs/trip.json -- node agent.js
```

Your code runs again. Every model call is answered from the cassette, and every wrapped tool returns its recorded
result without running. No key is needed and nothing reaches the network. If your agent sends a request that differs
from the recording, replay stops and names the field:

```text
[blackbox] replay diverged at step 0, messages[0].content
  recorded: "Is Lisbon or Oslo nicer this weekend?"
  actual:   "Is Lisbon or Porto nicer this weekend?"
```

## 5. Pick a step and fork

```bash
npx blackbox inspect runs/trip.json
```

```text
   0  model_input     b9de1b85  Model called with 1 message(s)
   1  model_output    4312fcd4  Model → tool_calls: get_weather, get_weather
   2  tool_call       f0e0c05d  Tool called: get_weather
   3  tool_result     d948816f  Tool result: get_weather → ok
   4  tool_call       521e3670  Tool called: get_weather
   5  tool_result     a150bc86  Tool result: get_weather → ok
   6  model_input     52f06c0d  Model called with 3 message(s)
   7  model_output    05de789d  Model → final_answer: "Lisbon: 24°C and sunny beats Oslo's rain."
   8  metadata        f7b0af0c  Run completed: "Lisbon: 24°C and sunny beats Oslo's rain."
```

Fork points are `tool_result` steps. Give the agent a stormy Lisbon at step 3 and let the live model carry on:

```bash
npx blackbox fork runs/trip.json --at 3 --set '{"tempC":9,"sky":"storm"}' --out runs/storm.json --live -- node agent.js
```

`--set` replaces the whole tool result. Steps 0–2 are replayed from the cassette (and checked), step 3 gets your
value, and from there the model and tools run for real.

To fork without calling the API, script the model's replies after the fork point instead of `--live`:

```bash
echo '[{"type":"final_answer","text":"Oslo, then."}]' > replies.json
npx blackbox fork runs/trip.json --at 3 --set '{"tempC":9,"sky":"storm"}' --out runs/storm.json --script replies.json -- node agent.js
```

## 6. Diff

```bash
npx blackbox diff runs/trip.json runs/storm.json
```

```text
First divergence at index 3
  parent  tool result     d948816f  Tool result: get_weather → ok
  child   tool result     0f9c100a  Tool result: get_weather → ok
  changed value (result):
    parent: {"tempC":24,"sky":"sunny"}
    child:  {"tempC":9,"sky":"storm"}

Outcome:        same final status (success), but the final answer changed
  parent answer: Lisbon: 24°C and sunny beats Oslo's rain.
  child answer:  Neither is great; Lisbon has a storm and Oslo has rain.
```

Everything before step 3 is hash-identical to the parent, so the divergence is exactly the fact you changed.

## Next

- [Use a cassette in CI](./ci)
- [Integration details](./integrations) (OpenAI, tools, servers, programmatic use)
- [What Blackbox doesn't do](./limitations)
