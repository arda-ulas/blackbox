# Blackbox

**Time-travel debugger for AI agents.** Record a run of your own agent through the official Anthropic or OpenAI
Node SDK into a tamper-evident, hash-chained cassette. Replay it through your real code with no network and no key;
fork at any recorded tool result with a different value; `diff` to the first step where the runs part. Plain local
JSON: no server, no account. (Unrelated to Blackbox AI, the coding assistant.)

[![CI](https://github.com/arda-ulas/blackbox/actions/workflows/ci.yml/badge.svg)](https://github.com/arda-ulas/blackbox/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ardaulas/blackbox)](https://www.npmjs.com/package/@ardaulas/blackbox)
[Docs](https://arda-ulas.github.io/blackbox/)

<img src="assets/brand/blackbox-readme-hero.svg"
     alt="blackbox inspect shows a fleet agent's telemetry reading captured the evening before the fault; blackbox diff shows the first divergence at step 5 when the live reading is injected, and the work order changing from routine to urgent."
     width="100%">

## See it find a root cause

A fleet-maintenance agent kept an overheating van in service: its telemetry tool served a reading cached before the
fault. The [fleet-triage example](https://arda-ulas.github.io/blackbox/example-fleet-triage) walks the investigation
offline, with no API key: **reproduce** the run with `replay`, **isolate** the stale reading with `inspect`, **test**
the hypothesis with `fork`, **confirm** the cause with `diff`, and **prevent** a recurrence with a freshness check and
an `assert` pinned in CI. A second example, [what did my coding agent do?](https://arda-ulas.github.io/blackbox/example-claude-code),
imports a real Claude Code session.

To see the whole loop in ten seconds with no agent of your own:

```bash
npx @ardaulas/blackbox check
```

## Quickstart: record your own agent

Needs Node.js 22+ and an agent built on `@anthropic-ai/sdk` or `openai`.

```bash
npm install --save-dev @ardaulas/blackbox
```

Add three lines where your agent creates its client and tools, and one at the end:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { blackbox } from "@ardaulas/blackbox";

const bb = blackbox();                                // does nothing unless run under `blackbox`
const client = new Anthropic({ fetch: bb.fetch });    // OpenAI: new OpenAI({ fetch: bb.fetch })
const tools = bb.tools({ get_weather, book_hotel });  // your functions, same names and arguments

// ...your agent loop, unchanged: client.messages.create(...), await tools.get_weather(...)

await bb.finish();
```

Then run your agent through the CLI:

```bash
# 1. Record a real run (uses your API key as usual)
npx blackbox record --out runs/trip.json -- node agent.js

# 2. Replay it: your code runs again, every model call and tool result comes from the cassette
npx blackbox replay runs/trip.json -- node agent.js

# 3. Find the step to change: fork points are tool_result steps, and --at takes that index
npx blackbox inspect runs/trip.json
```

```
   0  model_input     b9de1b85  Model called with 1 message(s)
   1  model_output    4312fcd4  Model → tool_calls: get_weather, get_weather
   2  tool_call       f0e0c05d  Tool called: get_weather
   3  tool_result     d948816f  Tool result: get_weather → ok
   ...
```

```bash
# 4. Fork: hand the agent a different result at step 3 and let it carry on with the live model
npx blackbox fork runs/trip.json --at 3 --set '{"tempC":9,"sky":"storm"}' --out runs/storm.json --live -- node agent.js

# 5. See where and how the two runs diverge
npx blackbox diff runs/trip.json runs/storm.json
```

```
First divergence at index 3
  changed value (result):
    parent: {"tempC":24,"sky":"sunny"}
    child:  {"tempC":9,"sky":"storm"}

Outcome:        same final status (success), but the final answer changed
  parent answer: Lisbon: 24°C and sunny beats Oslo's rain.
  child answer:  Neither is great; Lisbon has a storm and Oslo has rain.
```

`--set` replaces the whole tool result, as JSON. To fork without spending tokens, replace `--live` with
`--script replies.json`, a list of model replies to serve after the fork point
(`[{"type":"final_answer","text":"..."}]`).

`bb.finish({ result })` records the final answer explicitly; without it, the last text-only model reply counts as
the answer. If the process exits before `finish()`, the cassette is still written and the status is inferred at exit.
**In a long-running process** (a server, a worker), give each conversation its own session and file, e.g.
`blackbox({ mode: "record", out: \`runs/${id}.json\` })`, and call `bb.finish()` when that conversation ends. See
[integrations](https://arda-ulas.github.io/blackbox/integrations).

[`examples/`](examples/) has a complete agent for each provider.

## How it works

| Step | What happens |
|---|---|
| **record** | `bb.fetch` sits under the SDK client. Each model call is stored as two provider-neutral steps, request and response. Failed calls are not recorded. Wrapped tools store their arguments and results. Every step's SHA-256 covers its content and the previous step's hash: editing a step breaks the chain for `verify` unless every later hash is recomputed too, and comparing the last hash with a copy you trust catches even that. |
| **replay** | Your agent runs again. Each request it sends is compared with the recorded one. On a match, the recorded response comes back in the SDK's own shape. On a mismatch, replay stops at the first difference and names the path, e.g. `messages[0].content`. Wrapped tools return their recorded results without running. If a prompt changes on every run (a timestamp, say), `--match sequence` serves the responses in order without comparing. |
| **fork** | Replays the recording up to one tool result, returns your value instead, then continues with the live model (`--live`) or scripted replies (`--script`). Steps before the fork are copied verbatim, so their hashes match the parent's. |
| **diff** | Reports the first divergent step, the value that changed, and whether the outcome changed (status, final answer, tool path). |
| **verify / assert** | `verify` checks the schema, the hash chain, the absence of API keys and provider request ids, and that the cassette replays. `assert` adds expectations about the outcome, for CI. |

The format is plain JSON: see [trace format](https://arda-ulas.github.io/blackbox/trace-format).

## Use a cassette in CI

A committed cassette is a regression test that runs without a key:

```bash
npx blackbox assert runs/trip.json --expect-status success --expect-tools get_weather,get_weather
npx blackbox replay runs/trip.json -- node agent.js   # fails if your agent's requests changed
```

`replay` exits non-zero at the first request your agent sends differently from the recording, so a prompt or
tool-schema change shows up as a failing check with the exact step and field.
See [CI usage](https://arda-ulas.github.io/blackbox/ci).

## Import a Claude Code session

```bash
npx blackbox import --from claude-code --in ~/.claude/projects/<project>/<session>.jsonl --out runs/session.json
```

Now you can fork and diff a session Claude Code ran. The importer handles parallel tool calls and multi-turn
sessions, and writes the cassette only if it passes `verify`.

## What it doesn't do

- **Streaming.** `stream: true` and `messages.stream()` are rejected with a message telling you to use the
  non-streaming call.
- **OpenAI's Responses API.** Chat Completions only for now. Images, documents, server-side tools and `n > 1` are
  also rejected with a clear error rather than recorded incorrectly.
- **Extended thinking.** Thinking blocks are left out of cassettes. Record and replay work, but `fork --live` on a
  thinking-enabled agent is refused.
- **Concurrent conversations in one session.** Overlapping model calls through one `bb.fetch` are rejected. Use
  one `blackbox()` session per concurrent conversation.
- **Your other I/O.** Replay answers model calls made through `bb.fetch` and runs no wrapped tool. Anything else your
  agent does (unwrapped tools, other HTTP calls, the clock) still happens.
- **A dashboard.** There is no server or hosted service, and Blackbox does not find bugs for you. It makes a run
  reproducible, lets you change one fact, and shows what changed.

Cassettes contain your prompts and tool results, so treat them like logs. Blackbox refuses to write a cassette that
contains the API key it saw in the environment or the request headers.

## How it compares

Checked in September 2026; sources on the [comparison page](https://arda-ulas.github.io/blackbox/comparison).

- **[Laminar](https://github.com/lmnr-ai/lmnr)** is an open-source observability platform with an agent debugger. A
  rerun serves earlier LLM responses from a cache in the Laminar backend (Cloud or self-hosted, with a signed-in
  account) up to a chosen step, matching loosely (system messages are left out of the cache key), and calls the model
  live after it. In TypeScript its replay caching works through the Vercel AI SDK. Blackbox keeps the recording in a
  file in your repository, matches every request field by field, forks by changing one recorded tool result, and
  checks the result in CI with no key or network. Laminar adds what Blackbox lacks: tracing dashboards, evaluations
  and Python support.
- **[LangGraph time travel](https://docs.langchain.com/oss/javascript/langgraph/use-time-travel)** replays and forks
  a LangGraph graph from a checkpoint; nodes after it re-run with live model calls. Blackbox works under any agent
  loop on the official SDKs and answers model calls from the recording.
- **[backspin](https://github.com/zaibuchihuoji/backspin)** also records to a file, replays offline and diffs to the
  first divergence. It is Python-first, matches requests by a fingerprint of model and messages, forks by changing a
  recorded LLM answer, and has no hash chain.
- **HTTP cassette recorders** (Polly.js, nock, VCR.py) make tests deterministic at the HTTP level; none documents
  forking a recorded run at a step and diffing the outcome.

## Try it without an agent

```bash
npx @ardaulas/blackbox check    # records, verifies, forks and diffs a built-in demo run, fully offline
npx @ardaulas/blackbox demo     # writes the demo cassettes to ./traces to explore with inspect and diff
```

## Documentation

[Quickstart](https://arda-ulas.github.io/blackbox/quickstart) ·
[Concepts](https://arda-ulas.github.io/blackbox/concepts) ·
[Integrations](https://arda-ulas.github.io/blackbox/integrations) ·
[CLI reference](https://arda-ulas.github.io/blackbox/cli) ·
[Trace format](https://arda-ulas.github.io/blackbox/trace-format) ·
[CI](https://arda-ulas.github.io/blackbox/ci) ·
[Root-cause example](https://arda-ulas.github.io/blackbox/example-fleet-triage) ·
[Claude Code example](https://arda-ulas.github.io/blackbox/example-claude-code) ·
[Worked example](https://arda-ulas.github.io/blackbox/worked-example) ·
[Architecture](https://arda-ulas.github.io/blackbox/architecture)

## Development

```bash
npm ci
npm test                       # offline: no API key, no network
npm run typecheck && npm run build
node scripts/pack-smoke.mjs    # pack, install into a clean project, and use it
```

Blackbox was built in tagged milestones. [`CHANGELOG.md`](CHANGELOG.md) covers releases, and
[`docs/history/`](docs/history/) keeps the milestone plans and build log.

## License

MIT
