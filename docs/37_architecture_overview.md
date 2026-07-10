# Architecture Overview

A public-facing map of how Blackbox works internally. It is deliberately concise; for the exact
cassette format see [03_trace_schema.md](03_trace_schema.md), and for the provider-neutral adapter
boundary see [13_adapter_contract.md](13_adapter_contract.md).

## What Blackbox records

Blackbox records a single agent's tool-using run as an **append-only, hash-chained trace** (a
"cassette"). A run is a sequence of steps — the initial prompt, each model turn, each tool call, each
tool result, and the terminal answer or error. Each step is stored as a provider-neutral
`TraceStep` with an `index`, a `type`, a `timestamp`, a JSON `payload`, and a `hash` that chains to
the previous step. Tool rounds are recorded as structured transcript parts (`MessagePart`) carrying
a deterministic, provider-neutral `toolCallId` (`call-0`, `call-1`, …) — never a provider's native
id, usage, or stop metadata.

## Entry points

There are two ways a trace comes into existence, and both produce the *same* trace grammar:

- **Record a run** — the CLI (`src/cli.ts`) and the example scripts drive `runAgentLoop`
  (`src/agent/agentLoop.ts`) over a `ModelClient` and a set of tools, and a `TraceRecorder`
  (`src/trace/TraceRecorder.ts`) captures each step.
- **Adapt a foreign transcript** — `adaptForeignTranscript` (`src/ingest/foreignTranscript.ts`)
  converts an externally-shaped, chat-style transcript into a normal Blackbox v2 trace by *composing*
  the same `TraceRecorder`. No provider noise crosses the boundary.

Every downstream command — replay, fork, diff, verify, assert, check — operates on a `Trace`, so it
does not matter whether the trace was recorded natively or adapted.

## Recording flow

```
prompt ─▶ agentLoop ─▶ ModelClient turn ─▶ (tool call ─▶ tool result)* ─▶ final answer/error
                 │
                 ▼
     TraceRecorder.append(type, payload, timestamp?)  ──chains hash──▶  Trace (append-only cassette)
```

`agentLoop` alternates model turns and tool calls until the model emits a final answer (or an error
terminates the run). Each emitted step is appended via `TraceRecorder.append(...)`, which computes
the chained step hash and stores the step (steps are append-only, never mutated in place). Model
calls always sit behind the `ModelClient` interface (`src/agent/modelClient.ts`); the default clients
are fake and offline (see **Real vs fake**).

## Canonical hash and the hash chain

Each step's hash is `hashTraceStepInput` (`src/trace/hash.ts`) over exactly these fields: `index`,
`type`, `timestamp`, `payload`, and `prevHash`. The step's own `id` and `hash` are **excluded** so the
hash is reproducible from content and chain position alone. Hashing uses canonical serialization
(`canonicalize`: object keys sorted recursively, stable JSON) — so field order in the source object
does not affect the hash, and the same logical content always produces the same SHA-256. Because each
step folds in the previous step's hash via `prevHash`, the cassette is tamper-evident: change any step
and every hash from that point forward changes.

## Why replay cannot call models or tools

`replayTrace(trace)` (`src/replay/CassetteReplay.ts`) takes **only a `Trace`** — no `ModelClient`, no
tools, no network. This is a structural guarantee, not a convention: replay re-derives the run's
outcome purely from recorded bytes, so it is impossible to make a live call from inside replay. This
is what makes replay deterministic and offline by construction.

## Fork, mutate, rehash, continue

`forkRun` (`src/fork/forkRun.ts`) branches a new child trace from a supported non-terminal step at
`forkIndex`, then continues the agent loop forward from there with a deterministic model. How the
prefix is built depends on the mode:

- **Prompt mode** — the steps `[0, forkIndex)` are copied **verbatim** (canonical-hash-identical to
  the parent), and the child diverges only at the continuation: the continuing run starts at
  `forkIndex` with the mutated prompt.
- **Tool-result mode** — only the steps **before the earliest mutation** are copied verbatim. From
  the earliest mutation index up to `forkIndex`, each step is **re-appended and re-hashed** — the
  mutated step carries the injected result (its original `toolCallId`/`toolName` preserved), and every
  step after it in that range is re-chained. So in tool-result mode the prefix is *not* wholly
  byte-for-byte: it is verbatim up to the mutation, then rebuilt from the mutation onward. (A
  `model_input` step between the mutation and `forkIndex` is rejected, since it would carry stale
  message history.)

In both modes the continuation runs the agent loop from `forkIndex` and appends new steps onto the
child. Metadata and terminal steps are not valid fork points.

## Structural diff vs behavioral outcome diff

Two complementary comparisons:

- **Structural diff** — `diffTraces` (`src/fork/diffTraces.ts`) walks parent and child in lockstep and
  reports the **first divergent step index** plus the shared-prefix length. `formatFirstDivergence`
  renders which field changed.
- **Behavioral outcome diff** — `diffOutcome` (`src/fork/diffOutcome.ts`) compares the two runs'
  *terminal behavior*: final status, final answer (or failure reason), and tool-call path — computed
  offline by exact-string comparison over `terminalOutcome` (`src/trace/traceOutcome.ts`). No model
  call, no semantic judge. `formatDiffReport` appends this `Outcome:` verdict below the structural
  block.

## Verification invariant order

`verifyTrace` (`src/trace/verifyTrace.ts`) runs one ordered hygiene pass and short-circuits at the
first failure, reporting the first failing invariant and the offending step:

1. `schema_version` — the cassette is a supported v2 trace.
2. `hash_chain` — every step hash recomputes and chains correctly.
3. `provider_neutrality` — no provider key/id/usage/stop metadata leaked into any payload.
4. `replayability` — the trace replays cleanly offline.

## Assert = verify + exact expectations

`assertCassette` (`src/workflow/assertCassette.ts`) is `verify` plus declared expectations. It runs
the four verify invariants and then, for each supplied expectation, does an **exact-match** check
against the replayed terminal outcome and tool-call sequence (status, final answer, failure reason,
ordered tool list). `verify ⊂ assert`: invariants gate expectations, so on invariant failure the
expectation checks are skipped rather than silently passing. It exits `0` only when verification and
every declared expectation pass — a scriptable, fully offline CI regression gate.

## Foreign transcript adapter

`adaptForeignTranscript` proves the trace grammar is a genuine boundary, not a private format: a
synthetic external transcript (carrying deliberate provider-like noise — token usage, a finish
reason, a model name, foreign tool-call ids) is converted into an ordinary v2 cassette with every
payload rebuilt field-by-field and every foreign id remapped to `call-N`. The result verifies,
replays, asserts, forks, and diffs under unchanged semantics. It is an adapter-boundary proof, **not**
a framework/SDK/LangChain/MCP/OpenAI integration, and there is no live ingestion.

## Real vs fake boundary

- **Real:** the trace format, canonical hashing and hash chain, recorder, replay, fork/rehash, diff,
  verify, assert, and the foreign adapter — all real product code.
- **Fake / offline (default):** the model clients (`FakeDeterministicModelClient` scripted +
  `ReactiveDemoModelClient` reactive continuation) and the fixture tools. Zero live calls, no API key,
  no network — in both the CLI and `npm test`.
- **Opt-in live:** three human-run proof scripts exercise a real provider; they are never wired into
  the default CLI or `npm test`, and they still replay offline.

## Module map

| Area | Module | Responsibility |
|---|---|---|
| Agent loop | `src/agent/agentLoop.ts` | Drive model/tool turns to a terminal step |
| Model interface | `src/agent/modelClient.ts` | Interface all model calls sit behind |
| Fake models | `src/agent/{fixtureTools,reactiveDemoModel}.ts` | Deterministic offline model + tools |
| Recorder | `src/trace/TraceRecorder.ts` | Append steps, compute chained hashes |
| Trace types | `src/trace/TraceTypes.ts` | `Trace` / `TraceStep` / schema version |
| Hashing | `src/trace/hash.ts` | Canonical serialization + step hash |
| Replay | `src/replay/CassetteReplay.ts` | Offline re-derivation from a `Trace` |
| Fork | `src/fork/forkRun.ts` | Prefix copy, mutate, rehash, continue |
| Diff | `src/fork/{diffTraces,diffOutcome}.ts` | Structural + behavioral divergence |
| Outcome | `src/trace/traceOutcome.ts` | Terminal status / answer / tool path |
| Verify | `src/trace/verifyTrace.ts` | Ordered invariant hygiene pass |
| Assert | `src/workflow/assertCassette.ts` | Verify + exact-match expectations |
| Self-check | `src/workflow/selfCheck.ts` | Full record→verify→fork→verify→diff loop |
| Foreign adapter | `src/ingest/foreignTranscript.ts` | External transcript → v2 trace |
| Rendering | `src/render/termStyle.ts` | Shared terminal grammar (color-gated) |
| CLI | `src/cli.ts` | Command dispatch + flag parsing |

## What is intentionally not built

No web UI, dashboard, backend, hosted service, or sharing. No observability / OpenTelemetry / metrics
platform. No agent framework or orchestrator (no LangChain, LlamaIndex, or MCP) — Blackbox records and
debugs histories; it sits beside frameworks, not in place of them. No multi-agent orchestration. No
live-by-default calls. These are deliberate boundaries, not a backlog.
