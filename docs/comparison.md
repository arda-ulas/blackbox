# How it compares

Checked on 2026-09-29 against each project's own documentation, repository or pricing page; every claim below links
its source. If something here is out of date, please [open an issue](https://github.com/arda-ulas/blackbox/issues).

## Laminar

[Laminar](https://github.com/lmnr-ai/lmnr) is an open-source (Apache-2.0) observability platform for AI agents, with
about 3.3k GitHub stars, Python and TypeScript SDKs, and an agent debugger
([repo](https://api.github.com/repos/lmnr-ai/lmnr), [license](https://raw.githubusercontent.com/lmnr-ai/lmnr/main/LICENSE.md)).
It is the closest tool to Blackbox in purpose, and they work differently.

**How Laminar's debugger reruns an agent.** You run the agent's own command again with `LMNR_DEBUG=true`, the trace to
replay (`LMNR_DEBUG_REPLAY_TRACE_ID`) and the last LLM call to serve from cache (`LMNR_DEBUG_CACHE_UNTIL`); calls after
that span run live ([process](https://laminar.sh/docs/debugger/process)). The cache is served by the Laminar backend,
keyed by the trace id and a hash of each LLM call's input; the first cache miss sends that call and every later one to
the model live; and the input hash deliberately leaves out system messages, so editing the system prompt still hits
the cache ([caching](https://laminar.sh/docs/debugger/caching.md)). The debugger needs a signed-in user, a project and
a project API key ([setup](https://laminar.sh/docs/debugger/setup.md)), and a Laminar backend: Laminar Cloud, which has
a free tier that includes the debugger ([pricing](https://laminar.sh/pricing)), or a self-hosted stack of PostgreSQL,
ClickHouse, Quickwit and Laminar's app server and frontend
([self-hosting](https://laminar.sh/docs/self-hosting/overview.md),
[compose file](https://raw.githubusercontent.com/lmnr-ai/lmnr/main/docker-compose.yml)).

| | Laminar debugger | Blackbox |
|---|---|---|
| Where a recording lives | In the Laminar backend (Cloud or self-hosted) ([caching](https://laminar.sh/docs/debugger/caching.md)) | A JSON file you can commit next to your code |
| Needs an account or a server | A signed-in user, a project and `LMNR_PROJECT_API_KEY` ([setup](https://laminar.sh/docs/debugger/setup.md)) | No |
| Before the chosen point | Cached LLM responses; the match ignores system messages ([caching](https://laminar.sh/docs/debugger/caching.md)) | Every request compared field by field with the recording; replay stops at the first difference and names the field |
| Tools during the replayed part | The caching docs describe caching LLM responses ([caching](https://laminar.sh/docs/debugger/caching)) | Wrapped tools return their recorded results without running |
| After the chosen point | The live model ([process](https://laminar.sh/docs/debugger/process)) | The live model (`--live`) or scripted replies (`--script`, no API call) |
| What you change | Your agent's code or prompt, then rerun ([process](https://laminar.sh/docs/debugger/process.md)) | One recorded tool result (`fork --at N --set …`) |
| TypeScript agent on the official Anthropic or OpenAI SDK | Replay caching in TypeScript works through the Vercel AI SDK only; with other integrations every call on a replay goes live ([caching](https://laminar.sh/docs/debugger/caching.md)) | Plugs into both SDKs through their `fetch` option |
| In CI | Evaluations via `npx lmnr eval`, reporting to a reachable Laminar instance ([evaluations](https://laminar.sh/docs/evaluations/introduction)) | `assert` and `replay` exit codes, offline, no key |

**Where Laminar does more.** Laminar is a full observability platform: hosted and self-hosted trace storage with a
UI, an evaluations framework ([evaluations](https://laminar.sh/docs/evaluations/introduction)), and Python as well as
TypeScript SDKs. Its launch post also says a rerun restores external state such as the browser DOM and sandbox
([launch post](https://laminar.sh/blog/2026-03-16-laminar-launch)). Blackbox has none of that: no server, no UI,
Node 22+ only, and it does not restore external state.

**Choose Laminar** when you want team-wide tracing, dashboards and evaluations, or you debug browser and sandbox
agents. **Choose Blackbox** when you want a run reproduced exactly from a file in your repository, a one-fact fork
with a first-divergence report, and a CI check that needs no key or network.

## LangGraph time travel

[LangGraph](https://docs.langchain.com/oss/javascript/langgraph/use-time-travel) (MIT, `@langchain/langgraph`
[1.4.18](https://registry.npmjs.org/@langchain/langgraph/latest)) can replay and fork a run from an earlier
checkpoint. It requires the agent to be a LangGraph graph compiled with a checkpointer
([checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers)). Nodes before the checkpoint are
not re-run; nodes after it re-execute, so LLM calls and API requests fire again live and may return different
results. A fork writes new state with `updateState` on a past checkpoint and continues from there, leaving the original
history intact ([time travel](https://docs.langchain.com/oss/javascript/langgraph/use-time-travel)). Execution picks up
only at super-step boundaries ([checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers)).

**Difference:** LangGraph time travel is built into the framework and works on graph state; Blackbox works under any
agent loop on the official SDKs, answers model calls from the recording instead of re-running them, forks at any
recorded tool result, and can continue a fork from scripted replies.

## backspin

[backspin](https://github.com/zaibuchihuoji/backspin) (MIT, created August 2026) is closest in shape: it records LLM
and tool calls into one file, replays offline, and `backspin diff` reports the first step where two runs differ
([README](https://raw.githubusercontent.com/zaibuchihuoji/backspin/HEAD/README.md)). It is Python-first (PyPI 0.5.1);
its TypeScript SDK installs from a GitHub branch and exports an OpenAI capture wrapper, without Anthropic capture or
`branch()` ([TS SDK](https://raw.githubusercontent.com/zaibuchihuoji/backspin/main/sdks/typescript/src/index.ts)). A
local proxy mode, which its README describes as working with any framework and language. Replay matches a fingerprint of the model and messages and falls back
to call order ([format spec](https://raw.githubusercontent.com/zaibuchihuoji/backspin/main/docs/format-spec.md)). Its
what-if feature changes a recorded LLM answer and replays the rest from the recording
([replay.py](https://raw.githubusercontent.com/zaibuchihuoji/backspin/main/backspin/replay.py)). The format spec uses
SHA-256 only for the request fingerprint, with no hash chain over the run file
([format spec](https://raw.githubusercontent.com/zaibuchihuoji/backspin/main/docs/format-spec.md)).

**Difference:** Blackbox matches every request field by field, forks at a recorded *tool result* and continues live or
scripted, supports both the Anthropic and OpenAI Node SDKs, and chains step hashes so a fork's shared prefix can be
checked against its parent. backspin's proxy covers any language, and it ships a Python package with a UI extra.

## HTTP cassette recorders

[Polly.js](https://github.com/Netflix/pollyjs) records raw HTTP to HAR files and matches on method, headers, body,
order and URL ([configuration](https://raw.githubusercontent.com/Netflix/pollyjs/master/docs/configuration.md)); its
last release, 6.0.6, is from July 2023 ([npm](https://registry.npmjs.org/@pollyjs/core)).
[nock](https://github.com/nock/nock) intercepts Node HTTP, including native `fetch` since v14
([release](https://github.com/nock/nock/releases/tag/v14.0.0)), and Nock Back records and plays back fixtures; its
default mode still allows real calls ([README](https://github.com/nock/nock)). In Python,
[VCR.py](https://vcrpy.readthedocs.io/en/latest/configuration.html) matches on method, host, path and query by default
(not the body), and [pytest-recording](https://raw.githubusercontent.com/kiwicom/pytest-recording/master/README.rst)
blocks new network calls by default.

**Difference:** these tools make tests deterministic at the HTTP level. None of them documents forking a recorded run
at an interaction and diffing the result against the original; Blackbox records model calls and tool results as
steps, and its `diff` names the first divergent step, the changed fields and the change in outcome.
