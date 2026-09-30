# Integrations

Blackbox plugs in through the official SDKs' `fetch` option. It does not patch or wrap the client object, so every
SDK method that goes through `fetch` keeps working.

## Anthropic

```ts
import Anthropic from "@anthropic-ai/sdk";
import { blackbox } from "@ardaulas/blackbox";

const bb = blackbox();
const client = new Anthropic({ fetch: bb.fetch });
```

- **Recorded:** `client.messages.create(...)` with text, tool use (parallel tool calls included) and tool results.
- **Kept as params:** `max_tokens`, `temperature`, `top_p`, `top_k`, `tool_choice`, `stop_sequences`,
  `output_config`, `thinking`.
- **Not supported yet:** streaming (`stream: true`, `messages.stream()`), images and documents, and server-side
  tools such as web search. Each raises an error that says what to use instead.
- **Extended thinking:** thinking blocks are left out of the cassette. Recording and replaying a thinking-enabled
  agent works; `fork --live` for one is refused, because the API requires the thinking blocks on tool-use turns.

## OpenAI

```ts
import OpenAI from "openai";
import { blackbox } from "@ardaulas/blackbox";

const bb = blackbox();
const client = new OpenAI({ fetch: bb.fetch });
```

- **Recorded:** `client.chat.completions.create(...)` with function tools (parallel calls included), refusals and
  truncated replies. Leading `system`/`developer` messages become the system prompt.
- **Kept as params:** `max_tokens` / `max_completion_tokens`, `temperature`, `top_p`, `tool_choice`,
  `response_format`, `stop`, `parallel_tool_calls`, `seed`, `reasoning_effort`.
- **Not supported yet:** the Responses API (`client.responses.create`), streaming, image/audio/file parts, custom
  tools, `n > 1`, and system messages after the conversation starts.
- The OpenAI SDK refuses to start without a key. Under `blackbox replay` and `blackbox fork --script`, the CLI sets a
  placeholder `OPENAI_API_KEY` (and `ANTHROPIC_API_KEY`) when none is set. Nothing is sent with it.

## Tools

```ts
const tools = bb.tools({ get_weather, book_hotel });
await tools.get_weather({ city: "Lisbon" });

// When the function name differs from the tool name the model uses:
const forecast = bb.tool("get_weather", fetchForecast);
```

- Wrapped tools keep their parameters and always return a Promise.
- A call is matched to the model's request for that tool by name and arguments. Record mode stores the arguments
  the tool was actually called with, and replay checks them.
- In replay a wrapped tool never runs. It returns the recorded result, or throws the recorded error message.
- Tools you do not wrap still run in replay. Their results still reach the model through your messages, so strict
  replay still checks them, but they cannot be fork points.
- Return values are stored as JSON. `undefined` becomes `null`, and class instances are stored as plain objects.

## Ending a run

```ts
await bb.finish();                          // status from the last model reply
await bb.finish({ result: "Booked." });      // record the answer explicitly
await bb.finish({ error });                  // record a failed run
```

- In record and fork mode, `finish()` writes the cassette. It refuses to, and throws, if the cassette fails `verify`
  or contains the API key from the environment or the request headers.
- In replay mode, `finish()` checks that the agent made every recorded model call and ran every recorded tool (with
  `--match sequence` too), and that it ended the run the way the recording did: the result or error passed to
  `finish()` (without one, the last model reply) must equal the recorded outcome. Otherwise it throws a
  `ReplayDivergenceError`.
- If the process exits (or gets Ctrl-C) before `finish()`, a record or fork cassette is still written. A non-zero
  exit is recorded as `run_failed`.

## Servers and other long-running processes

The CLI launcher suits a script that runs one conversation and exits. In a server, create a session per
conversation with explicit options, and finish it when that conversation ends:

```ts
const bb = blackbox({ mode: process.env.RECORD ? "record" : "off", out: `runs/${conversationId}.json` });
const client = new Anthropic({ fetch: bb.fetch });
// ... handle the conversation ...
await bb.finish();
```

One session handles one conversation at a time. Overlapping model calls through the same `bb.fetch` are rejected
rather than recorded out of order.

## Programmatic use (tests)

Every option the CLI sets can be passed directly. That makes replay a plain unit test:

```ts
import { blackbox } from "@ardaulas/blackbox";

test("the agent still books Lisbon", async () => {
  const bb = blackbox({ mode: "replay", cassette: "runs/trip.json" });
  const answer = await runAgent(new Anthropic({ apiKey: "unused", fetch: bb.fetch }), bb.tools({ get_weather }));
  await bb.finish();
  expect(answer).toContain("Lisbon");
});
```

| Option | Meaning |
|---|---|
| `mode` | `"off"` (default), `"record"`, `"replay"` or `"fork"` |
| `out` | Where record and fork write the cassette |
| `cassette` | The cassette replay and fork read |
| `forkAt`, `forkSet` | Fork step index and replacement result |
| `continueWith`, `script` | `"live"`, or `"script"` with a list of model outputs |
| `match` | `"strict"` (default) or `"sequence"` |
| `traceId` | Id stored in the cassette (default: the file name) |

The analysis functions (`loadTrace`, `verifyTrace`, `diffTraces`, `diffOutcome`, `assertCassette`, `replayTrace`)
are exported too. They read cassettes and never call a model or run a tool.

## Errors

Blackbox errors raised inside an SDK call reach your code as the SDK's own `400` error, with a message starting
with `[blackbox]`. They are not retried. `isBlackboxError(error)` recognizes them, and `bb.finish()` rethrows the
original typed error: `ReplayDivergenceError` or `BlackboxUnsupportedError`.
