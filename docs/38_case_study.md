# Blackbox — Portfolio Case Study

> **Status note.** This is the portfolio-facing case study for the completed engine scope through tag
> `week-fourteen-package-readiness`. Technical claims are tied to repository sources and tests where applicable;
> manually verified CI and packaging results are labeled separately. The document distinguishes implemented
> behavior from production capabilities that remain out of scope.

---

## 1. Overview

**Blackbox is a time-travel debugger for AI agents.**

Blackbox records a multi-step agent run — model inputs, model outputs, tool calls, and tool results — as a
hash-chained **cassette**. It plays that cassette back offline with zero model or tool calls, then lets a caller
**fork** the recorded history, **mutate** a tool result, **continue** through an injected model/tool boundary, and
**diff** parent against child to report the first trace step where their hashes diverge. The default CLI
demonstration uses a deterministic local fake for continuation.

| | |
|---|---|
| **What it is** | A local, offline-by-default debugging kernel and CLI for single-agent, tool-using runs |
| **Language** | TypeScript, no agent frameworks, model calls behind a `ModelClient` interface |
| **Tests** | 583 passing across 26 files — fully offline, zero live provider calls, no API key required |
| **CI** | GitHub Actions: `npm ci` → full test suite → offline self-check, on Node 20 |
| **Packaging** | Installable `blackbox` CLI from a local npm tarball, verified on Node 20 and Node 22 |
| **Scope honesty** | A portfolio-grade debugging kernel — not a hosted product, not npm-published, not an observability platform |

Blackbox is an **active** debugger, not a passive dashboard: instead of only viewing a recorded run, it lets a
caller change one recorded fact and observe how an injected continuation reacts. In the default demonstration, continuation runs
through a deterministic fake, making the cause-and-effect path repeatable and offline. Blackbox complements
tracing and observability platforms; it does not replace them.

**30-second reviewer path:** `npm ci && npm test -- --run && npm run cli -- check` — 583 offline tests, then the
record → verify → fork/mutate/continue → verify → diff self-check to a single `PASS`.

---

## 2. The problem

Agent runs are multi-step and stochastic. When a run produces a bad answer, the question a debugger should answer
is a counterfactual:

> *"What would the agent have done if this one tool result had been different?"*

With a live agent, that question is expensive to ask and unreliable to answer:

- **Re-running doesn't reproduce.** Model outputs vary between runs, so the original failure may simply not
  recur.
- **Re-running isn't free.** Every attempt costs tokens and time, and tools may touch real external state.
- **You can't isolate the variable.** A live re-run changes everything at once; you can't hold the first N steps
  fixed and vary exactly one fact.

Existing framework mechanisms only partly help. [LangGraph's time-travel documentation](https://docs.langchain.com/oss/python/langgraph/use-time-travel)
states that nodes after a checkpoint re-execute, including LLM calls and API requests, and may therefore return
different results. That is checkpointed fork-and-re-execution rather than playback of a fixed recording.

Blackbox makes replay, verification, assertion, and comparison deterministic reads of the recording, while routing
counterfactual continuation through explicit injected model and tool boundaries.

---

## 3. The core insight

**Separate execution from analysis, and make the analysis side consume only recorded data.**

Blackbox draws one seam through the system: the `ModelClient` interface (`src/agent/modelClient.ts:103`) and the
tool-executor boundary. Everything on the execution side of that seam — recording a run, continuing a fork — goes
through injected clients (deterministic fakes by default; an opt-in, key-gated Anthropic adapter exists for
manually run proof scripts only). Everything on the analysis side — replay, verify, diff, assert — takes a `Trace`
as input and returns data. No model, no tools, no network.

Three properties make this useful as a debugger rather than just a log format:

1. **Replay is playback, not re-execution.** `replayTrace(trace)` accepts only a `Trace`
   (`src/replay/CassetteReplay.ts:141`). There is no parameter through which a model or tool client could enter,
   and the replay module imports no model, tool, or network code. Given the same valid cassette, replay returns
   the same summary — offline by construction, not by discipline.
2. **Canonical hashing makes divergence localizable.** Every step is SHA-256-hashed over a canonical
   serialization with recursively sorted object keys and chained to the previous step's hash. Two traces whose
   hashed fields — including timestamps — agree through step N have identical hashes through step N, so structural
   divergence can be found by locating the first unequal hash.
3. **Forking is surgical.** In the worked example's tool-result mutation (section 5), steps before the mutation are copied verbatim.
   The selected result value changes, hashes are re-chained from that step, model-visible history is reconstructed,
   and continuation crosses the injected execution boundary. The example changes one semantic input while
   preserving the earlier recorded steps exactly.

---

## 4. The debugging workflow

The core loop is `record → replay → fork → mutate → continue → diff → verify → check`, exposed as a CLI
(`src/cli.ts`), plus an `assert` utility for CI. In plain terms:

| Stage | What it means | Implementation |
|---|---|---|
| **record** | Run the agent through the `ModelClient`/tool seam; append every step to a hash-chained trace and save it as a JSON cassette | `runAgentLoop` + `TraceRecorder` (`src/agent/agentLoop.ts`, `src/trace/TraceRecorder.ts`) |
| **replay** | Play the cassette back offline: render one event per recorded step and reconstruct the terminal outcome. No model, no tools | `replayTrace` (`src/replay/CassetteReplay.ts:141`) |
| **fork** | Choose a continuation boundary. Steps `[0, forkIndex)` form the child's prefix; in mutation mode only the steps before the earliest mutation remain verbatim | `forkRun` (`src/fork/forkRun.ts:54`) |
| **mutate** | Replace the *value* of one recorded tool result in that prefix, preserving the tool name and correlation id | `forkRun` (`src/fork/forkRun.ts:150-158`) |
| **continue** | Reconstruct model-visible history from the mutated prefix and re-enter the agent loop through required injected clients; the default CLI supplies a deterministic fake model and fixture tools | `forkRun` (`src/fork/forkRun.ts:169-187`) |
| **diff** | Walk parent and child step-by-step to the **first divergence** — the first index where step hashes differ — then compare outcomes: terminal status, final answer string, and ordered tool path, by exact match | `diffTraces`, `diffOutcome` (`src/fork/diffTraces.ts:34`, `src/fork/diffOutcome.ts`) |
| **verify** | Check a cassette's schema version, recompute and validate the full hash chain, scan for known provider-native markers, and confirm replay consistency | `verifyTrace` (`src/trace/verifyTrace.ts:139`) |
| **check** | Run the five visible offline stages: record → verify parent → fork/mutate/continue → verify child → diff. Replayability is exercised inside verification | `runSelfCheck` (`src/workflow/selfCheck.ts:108`) |
| **assert** (CI) | Pin a cassette's verified state and exact expected outcome as a CI gate with deterministic exit codes | `assertCassette` (`src/workflow/assertCassette.ts:154`) |

The in-memory replay, verification, assertion, and diff primitives consume fixed traces and require no model/tool
credentials. Their CLI wrappers additionally read cassette files. Fork continuation is separate: it crosses the
injected model/tool boundary.

---

## 5. A worked debugging example

The committed fixture `fixtures/traces/success-tool-use.v2.json` records a hotel-booking agent run: the agent
searches hotels, checks a calendar, books a room, and answers with a confirmation. Suppose that booking answer is
the bug — in reality no hotel was available, and the agent should have declined. Blackbox does not *find* that
bug; it lets you reproduce the run, test the counterfactual, and pin the corrected behavior. All commands below
are offline and deterministic, and each was verified to exit 0.

**Step 1 — Replay the recorded run.**

```sh
npm run cli -- replay --trace fixtures/traces/success-tool-use.v2.json
```

Playback shows the full recorded timeline — the model's tool calls, each tool result, and the final booking
answer — without invoking anything.

**Step 2 — Fork with a mutated tool result.**

Fork at index 4 and mutate the recorded hotel-search result at step 3 to an empty result set. `--fork-index 4` makes
steps 0–3 the child prefix and starts continuation where the original step-4 `model_input` occurred;
`--mutation-step 3` selects the search result inside that prefix.

```sh
npm run cli -- fork \
  --trace fixtures/traces/success-tool-use.v2.json \
  --out traces/case-study-fix.json \
  --mode tool-result \
  --fork-index 4 \
  --mutation-step 3 \
  --payload-json '{"results":[],"available":false,"message":"No hotels available for that date."}'
```

The child keeps steps 0–2 verbatim, carries the injected "no hotels available" result at step 3, reconstructs the
conversation history the model would have seen, and continues. The default continuation client
(`ReactiveDemoModelClient`, `src/agent/reactiveDemoModel.ts:93-156`) is a pure function of the transcript — no
clock, randomness, or I/O — and *derives* its answer from the most recent tool result. Seeing an empty result
set, it produces a decline instead of a booking. The child's answer reacts to the mutation; it is not scripted.

**Step 3 — Diff parent against child.**

```sh
npm run cli -- diff \
  --parent fixtures/traces/success-tool-use.v2.json \
  --child traces/case-study-fix.json
```

The report shows the shared hash-identical prefix, **first divergence at step index 3** (the mutated tool
result), the changed value on each side, and the behavioral outcome: the tool path collapses from
`search → calendar → booking` to `search`, and the final answer changes from a confirmation to a decline.

**Step 4 — Pin the corrected behavior in CI.**

```sh
npm run cli -- assert \
  --trace traces/case-study-fix.json \
  --expect-status success \
  --expect-final-answer 'Based on the search result, no options are available: "No hotels available for that date.". I could not complete the booking.' \
  --expect-tools search
```

`assert` verifies the cassette's integrity and checks the exact expected outcome, exiting non-zero on any drift —
the corrected behavior becomes a regression gate. This same geometry (fork index 4, mutation step 3) is encoded
in the offline self-check (`src/workflow/selfCheck.ts:39-46`), so `npm run cli -- check` exercises this exact
scenario end-to-end on every CI run.

---

## 6. Architecture

Framework-free, layered TypeScript with a single CLI entry point. The design splits into an **execution/ingestion
lane** (may touch a model or tools, always through injected clients) and a **trace-only analysis lane** (pure
functions of recorded data).

```
EXECUTION / INGESTION
────────────────────────────────────────────────────────────────────────────
prompt ─► runAgentLoop
           ├─► ModelClient      ◄─ deterministic fake in the default CLI
           │                    ◄─ optional provider adapter
           ├─► ToolExecutor     ◄─ fixture tools in the default CLI
           └─► TraceRecorder ─► Trace v2 cassette

synthetic foreign transcript ─► adaptForeignTranscript ─► same Trace grammar

ACTIVE FORK / CONTINUATION
────────────────────────────────────────────────────────────────────────────
Parent Trace ─► forkRun
                 ├─ copy prefix / replace selected result / re-chain hashes
                 ├─ reconstruct MessagePart[] history
                 └─ re-enter runAgentLoop through injected clients ─► Child Trace

TRACE-ONLY ANALYSIS
────────────────────────────────────────────────────────────────────────────
Trace         ─► replayTrace       recorded timeline + terminal outcome
Trace         ─► verifyTrace       version + hash chain + known-marker scan
Trace         ─► assertCassette    verification + exact expectations
Trace × Trace ─► diffTraces        first hash divergence
Trace × Trace ─► diffOutcome       exact status / answer / tool path
```

| Module | Responsibility |
|---|---|
| `src/trace/` | Data model and integrity: schema (`TraceTypes.ts`), canonical hashing (`hash.ts`), append-only recorder (`TraceRecorder.ts`), verification, neutrality audit, outcome extraction |
| `src/replay/` | Cassette load/save/validate and offline playback (`CassetteReplay.ts`) |
| `src/agent/` | Agent loop, `ModelClient` interface, deterministic fakes, fixture tools, opt-in Anthropic adapter (proof scripts only), provider-neutral tool-call ids |
| `src/fork/` | Fork/mutate/continue (`forkRun.ts`), first-divergence and outcome diffing |
| `src/ingest/` | Foreign-transcript adapter boundary (`foreignTranscript.ts`) |
| `src/workflow/` | Composed utilities: `check` self-check, `assert` CI gate — no new hash or replay logic, only composition |
| `src/cli.ts` | Single entry point: `record`, `replay`, `fork`, `diff`, `list`, `inspect`, `verify`, `assert`, `check` |

Each `TraceStep` carries `id`, `index`, `type`, `timestamp`, `payload`, `prevHash`, and `hash`
(`src/trace/TraceTypes.ts:39-53`). The recorder appends and chains steps and uses `structuredClone` at its input and
output boundaries, so callers cannot mutate the recorder's internal state through retained payload references or a
returned trace object.

---

## 7. Technical deep dives

### 7.1 Canonical hashing and the hash chain

Each step's hash is SHA-256 over a canonical serialization of `(index, type, timestamp, payload, prevHash)`;
`id` and `hash` itself are excluded (`src/trace/TraceTypes.ts:55-67`, `src/trace/hash.ts:62-70`).
Canonicalization recursively sorts object keys, preserves array order, and removes incidental whitespace. The same
JSON value therefore hashes identically regardless of object-key insertion order. Because `prevHash` is included,
editing one step leaves that step's stored hash stale and requires every later step to be re-chained. Frozen-hash
tests pin expected hashes and one complete chain against unintended drift (`tests/fixtures.test.ts`).

**What the chain does and doesn't prove.** It proves *self-consistency* — it catches accidental or stale edits
and gives forking its divergence-localization property. It does **not** prove authenticity: there is no
signature or HMAC, so anyone who edits a cassette and recomputes all subsequent hashes produces a valid chain.
Cassettes are plain JSON on disk by design.

### 7.2 Structurally offline replay

Replay is deterministic playback, not re-execution. `replayTrace(trace: Trace): ReplaySummary` reads recorded
steps, renders one event per step, and derives the terminal status and result from the final metadata step. The
API is trace-only — there is no parameter for a model or tool client — and the replay module contains no
model-client, tool-executor, or network code (verified by direct inspection: no such symbols exist anywhere in
`src/replay/`). `verifyTrace`, `assertCassette`, `diffTraces`, and `diffOutcome` share the same trace-in,
data-out shape. Stated precisely: the type signature prevents callers from injecting execution
dependencies, and the current implementation has none — a structural property of the code, though not a formal
purity proof.

The default CLI, workflow utilities, agent loop, reactive fake, and fixture tools do not import the Anthropic
adapter or SDK. Within production source, the adapter is used only by the three opt-in, key-gated proof scripts.
Two offline test files also import it, but always with injected fake clients; the live proof scripts are not part of
`npm test`.

### 7.3 Fork semantics and history reconstruction

`forkRun` (`src/fork/forkRun.ts`) treats steps `[0, forkIndex)` as the child's prefix. Two cases:

- **No-mutation fork:** the prefix is cloned verbatim — ids, timestamps, payloads, and hashes — so the child's
  prefix is canonical-hash-identical to the parent (manually verified).
- **Tool-result mutation:** only the `result` value of the targeted step is replaced; `toolName` and the
  correlation id are preserved so call↔result pairing survives. Steps before the earliest mutation remain
  verbatim; from the mutation onward, steps are re-appended and re-chained, since the changed payload changes
  every subsequent `prevHash`.

Invalid forks are rejected with clear errors (exit 1 at the CLI), each covered by negative tests: out-of-range or
non-integer fork index; forking at a terminal metadata step; mutation keys that aren't canonical non-negative
integers, are out of range, or don't target a `tool_result` step; and — the subtlest guard — a mutation that
would leave a later `model_input` in the prefix still carrying *pre-mutation* history. Blackbox refuses to
fabricate a history the model never saw; it rejects rather than silently rewrites.

Continuation then reconstructs structured `MessagePart[]` history from the mutated prefix and re-enters
`runAgentLoop` with a seeded tool-call index so new correlation ids never collide with recorded ones. Lineage
(`parentId`, `forkedFromStepId`) is recorded in the child's schema. In total, 41 fork tests and 7 continuation tests cover
this surface (`tests/fork.test.ts`, `tests/forkAnthropicContinuation.test.ts`).

### 7.4 First divergence and behavioral outcome

`diffTraces` walks both step lists in lockstep to the first index where hashes differ (or one side ends),
returning the shared prefix length, the first-divergence index, and strict-prefix flags. The human-readable
render shows each side's step label, short hash, and the specific changed field — not a truncated JSON dump.
`diffOutcome` adds a behavioral verdict: terminal status, final answer, and ordered tool path, compared by
**exact match**. This is deliberate — a deterministic comparison with no model call — at the acknowledged cost of
not understanding semantic equivalence ("declined politely" vs. "declined curtly" is a difference).

### 7.5 Provider-neutral cassettes and foreign ingest

Blackbox-generated traces and the defined adapters use `call-N` correlation ids rather than persisting
provider-native tool ids. A neutrality audit scans cassettes for known provider markers (`toolu_`, `msg_`, usage
and stop metadata, and Anthropic-key patterns). This is a denylist of known markers, not a universal redaction
layer; arbitrary user-supplied payloads may still contain provider-specific or sensitive data.

The `adaptForeignTranscript` adapter (`src/ingest/foreignTranscript.ts:178`) converts a *synthetic, non-official*
chat-shaped transcript into a v2 cassette. It allowlist-copies supported fields, remaps foreign call ids to
`call-N`, and drops source metadata such as token usage, finish reasons, model names, message ids, and unrecognized
fields. Tests byte-compare the conversion against the committed golden cassette and assert that the source
fixture's provider-like sentinel fields and foreign ids do not cross the boundary.

### 7.6 What "deterministic" means here — precisely

- Playback, verification, diffing, and assertion of a *fixed* cassette are fully deterministic.
- The default model clients are deterministic: `FakeDeterministicModelClient` returns scripted responses in
  order (and throws if over-called); `ReactiveDemoModelClient` is a pure function of the transcript.
- Fresh recordings and fork continuations include real timestamps (which are hashed), so two *new* recordings
  are not generally byte-identical across runs. Frozen fixtures use controlled timestamps.
- `forkRun` as a library function accepts arbitrary injected clients; determinism is the default, not an
  enforced property of every possible caller.

---

## 8. Verification and testing

**583 tests pass across 26 files.** The suite passes in Node 20 CI and was reproduced locally on Node 22.22.2
with no API key present; `npx tsc --noEmit` also passes. The useful evidence is the scope:

- **Frozen artifacts:** five native cassettes under `fixtures/traces/` have frozen expected hashes and are
  byte-compared with the in-memory generator. The generator's default mode writes nothing and exits non-zero on
  drift. Separately, the synthetic foreign transcript is converted in memory and byte-compared with its committed
  golden cassette.
- **Negative paths:** malformed mutation keys, invalid fork targets, stale-history rejection, parent isolation,
  and corrupted-cassette failures localized to the broken step.
- **Boundary tests:** the Anthropic adapter is exercised through injected fake clients, covering translation and
  error normalization without live provider calls.
- **CLI regression:** 62 core CLI tests and 24 no-ANSI tests cover output and exit behavior. A separate regression
  test proves `check` output is byte-identical run-to-run; the no-ANSI suite proves escape-free output under
  `NO_COLOR` and CI conditions.
- **Packaging:** the current `npm pack --dry-run` contains 41 files and is 72,122 bytes (72.1 kB), excluding
  `tests/`, `docs/`, `scripts/`, `assets/brand/`, and root `traces/`. A local-tarball install was manually
  smoke-tested with `blackbox check` on Node 20 and Node 22.
- **CI:** GitHub Actions runs `npm ci`, `npm test -- --run`, and `npm run cli -- check` on Node 20 with
  `NO_COLOR=1`; its first run completed successfully.
- **Live proof scripts:** three Anthropic scripts exist but are opt-in, key-gated, manually run, and excluded from
  the default suite.

---

## 9. Tradeoffs and limitations

**Deliberate design tradeoffs:**

| Decision | Cost accepted |
|---|---|
| Canonical-hash identity over full step-object byte identity | Equal hashes indicate equality of the canonical hashed fields (`index`, `type`, `timestamp`, `payload`, `prevHash`), not every field of the step object; `id` is excluded |
| Trace-only replay API over replay-with-substituted-clients | Replay cannot exercise alternate clients; forking is the only counterfactual mechanism |
| Exact-string behavioral diff over an LLM judge | No semantic equivalence — deterministic and offline, but literal |
| Generated `call-N` ids over persisted provider ids | Original provider correlation ids are not preserved |
| Reject-don't-rewrite on stale history | Some conceivable forks are refused rather than approximated |
| Schema v2 hard cut, no v1 migration | Old cassettes must be re-recorded |

**Honest limitations — what a production tool would need that Blackbox does not have:**

- The default `record` CLI runs a hard-coded demonstration agent; wiring a *real* agent means implementing
  `ModelClient` and real tools as a library consumer. There is no general CLI integration for arbitrary agents.
- Single-agent, one tool call at a time; the foreign adapter accepts one documented synthetic format — not
  provider wire formats, OpenTelemetry, or framework traces.
- Local CLI only: no UI, backend, remote storage, multi-user sharing, or observability/analytics surface — by
  explicit guardrail.
- The hash chain is unauthenticated (no signatures); `loadTrace` validates the schema version but does not perform
  comprehensive runtime schema validation of every field.
- Ships TypeScript executed via a `tsx` launcher — installable, but not dependency-free.
- `"private": true` — not npm-published; installation is via local tarball. Publishing is a separate, explicit
  go/no-go.

---

## 10. Outcome and lessons

**Outcome.** A scope-complete portfolio debugging kernel, developed through the tagged W14-A packaging-readiness
milestone: offline cassette playback, fork/mutate/continue semantics, structural and exact-outcome diffing, a CI
`assert` utility, a constrained foreign-transcript adapter, a frozen regression corpus, 583 offline tests, a green
Node 20 CI run, and a CLI manually verified from local tarball installs on Node 20 and Node 22. Generated root
`traces/` outputs are not committed, and the default workflow requires no API key or live provider call.

**What the project demonstrates:** careful state modeling (append-only, hash-chained, cloned-on-boundary),
dependency-boundary discipline (one seam deciding live vs. offline), counterfactual execution semantics
(surgical mutation with reject-don't-rewrite validation), deterministic test design (frozen artifacts,
byte-compared fixtures, negative paths), and honest scope control.

**Lessons:**

1. **Narrow guarantees through API boundaries.** `replayTrace` exposes a trace-only public API, preventing callers
   from injecting model or tool clients; direct source inspection confirms that the current implementation has no
   execution dependency.
2. **Canonical serialization supports reliable structural comparison.** Stable sorted-key JSON enables
   hash-identical preserved prefixes, first-divergence detection, frozen fixtures, and drift-detecting assertions.
3. **Compose primitives instead of adding logic.** `verify`, `assert`, and `check` contain no new hash or
   replay code — they compose existing functions. Every new guarantee inherits the old tests.
4. **Precision about what you do not claim improves trust.** Playback is not re-execution; hash chains prove
   consistency, not authenticity; exact-match comparison is not semantic understanding; and a synthetic adapter is
   not provider support. Unsupported fork geometries and ingest shapes are rejected explicitly.

---

## 11. Repository and reviewer path

```sh
git clone https://github.com/arda-ulas/blackbox.git && cd blackbox
npm ci
npm test -- --run        # 583 tests, fully offline, no API key required
npm run cli -- check     # record → verify → fork/mutate/continue → verify → diff → PASS
```

Then, in reading order:

1. **README.md** — hero demo and the worked hotel-booking example with real CLI output.
2. **DEMO.md** — the complete reviewer walkthrough, including the limitations list.
3. **docs/37_architecture_overview.md** — the architecture reference.
4. **Key source, if you read only four files:** `src/trace/hash.ts` (canonical hashing),
   `src/replay/CassetteReplay.ts` (trace-only replay), `src/fork/forkRun.ts` (fork/mutate/continue —
   the heart of the debugger), `src/fork/diffTraces.ts` (first divergence).
5. **Key tests, for the evidence:** `tests/fork.test.ts` (41 fork cases including negative paths),
   `tests/fixtures.test.ts` (frozen hashes, byte-compared corpus), `tests/cliNoAnsi.test.ts`
   (deterministic CLI output).

---

## Appendix — Portfolio collateral

**Portfolio card (1 sentence):**

> A time-travel debugger for AI agents — records a run as a hash-chained cassette, plays it back offline with zero
> model or tool calls, then forks it, mutates one tool result, and pinpoints the first trace step where parent and
> child diverge.

**50-word summary:**

> Blackbox is a local TypeScript CLI that records single-agent tool runs as hash-chained cassettes, plays them back
> offline, forks a run at a chosen boundary, mutates one tool result, continues through a deterministic fake in the
> default demo, and reports the first trace divergence. 583 fully offline tests; CI green.

**150-word summary:**

> Debugging AI agents is difficult because rerunning a stochastic, multi-step execution may not reproduce the same
> failure or isolate one changed input. Blackbox records model inputs, model outputs, tool calls, and tool results
> as a canonically hash-chained cassette. Replay is deterministic playback: its trace-only API and current
> implementation read stored events without invoking a model or tool. Forking preserves the parent steps before a
> selected mutation, replaces one recorded tool-result value, reconstructs the model-visible conversation, and
> continues through injected clients; the default CLI uses a deterministic fake. Diffing locates the first hash
> divergence and compares exact terminal status, final-answer text, and ordered tool path. Cassette assertions turn
> a verified recorded outcome into a CI regression gate. The repository includes 583 offline tests, frozen-hash
> fixtures, a green Node 20 CI run, and an installable npm tarball. It remains a single-agent, local debugging
> kernel, not a hosted observability or production execution platform.

**Résumé bullets:**

- Designed a canonically hash-chained trace format for AI-agent runs, using sorted-key SHA-256 serialization and an
  append-only recorder to support preserved fork prefixes, first-divergence localization, and drift-detecting
  regression cassettes guarded by frozen-hash tests.
- Built a trace-only replay, verification, diff, and assertion surface with no model, tool, or network dependency
  in its current implementation, then composed it into CI utilities with deterministic exit codes; 583 offline
  tests across 26 files.
- Implemented counterfactual fork-and-continue semantics with tool-result mutation, verbatim preservation before
  the mutation, hash re-chaining, model-visible history reconstruction, correlation-id continuity, and
  stale-history rejection.

**Suggested captions for case-study visuals:**

1. *`blackbox check` screenshot:* "The full loop in one command: record → verify → fork → verify → diff to a
   single PASS — entirely offline, no API key, deterministic output under `NO_COLOR`."
2. *`blackbox fork` screenshot (worked example):* "The counterfactual: one recorded tool result mutated to 'no
   hotels available,' and the deterministic continuation changes its answer — the tool path collapses from
   search → calendar → booking to search alone."
3. *`blackbox verify` on a corrupted cassette:* "Integrity in practice: a hand-edited cassette fails
   verification with the broken step named, stored-vs-recomputed hashes shown, and a plain-language fix — the
   hash chain catches stale edits, by design."
4. *Architecture diagram:* "Execution crosses injected model and tool boundaries into an append-only,
   hash-chained cassette. Replay, verify, diff, and assert are trace-only reads; fork reconstruction crosses back
   through the execution boundary to continue the child — playback is not re-execution."
