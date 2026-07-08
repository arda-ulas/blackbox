# Build Log

## Purpose

Chronological record of what was built, in what order, and whether it worked. Entry added after each implementation session.

## Format

Each entry: date, phase, files written, outcome (pass/fail/partial), notes.

---

## Log

### 2026-07-04 — Foundation
- Phase: Project scaffold
- Files: package.json, tsconfig.json, src/ directory structure, tests/ stubs, docs/00–04
- Outcome: Clean repo, no implementation
- Notes: All src files are 0-byte stubs. All test files are 0-byte stubs. Scripts declared but not runnable yet.

### 2026-07-04 — Agent instructions
- Phase: Docs
- Files: AGENTS.md, CLAUDE.md
- Outcome: Complete
- Notes: Scope guard in place. Both files committed on master.

### 2026-07-04 — Phase 1: Trace core and canonical hashing
- Phase: Core data model
- Files: src/trace/TraceTypes.ts, src/trace/hash.ts, src/trace/TraceRecorder.ts, tests/trace.test.ts
- Outcome: Pass
- Notes: Append-only recorder with SHA-256 hash chain. canonicalize() sorts keys recursively. Timestamps included in hash input — two runs of identical events at different wall times produce different hashes. structuredClone used throughout for mutation isolation.

### 2026-07-04 — Phase 1 hardening
- Phase: Mutation hardening patch
- Files: src/trace/TraceRecorder.ts (minor), tests/trace.test.ts (minor)
- Outcome: Pass
- Notes: Verified structuredClone isolation on append() and getTrace(). Timestamp/hash policy documented.

### 2026-07-04 — Phase 2A: Deterministic model client and fixture tools
- Phase: Agent primitives
- Files: src/agent/modelClient.ts, src/agent/fixtureTools.ts, tests/agentFixtures.test.ts
- Outcome: Pass
- Notes: FakeDeterministicModelClient plays back scripted ModelOutput responses in order. Three fixture tools: search, calendar, booking — all deterministic, no network calls.

### 2026-07-04 — Phase 2B: Deterministic agent loop
- Phase: Agent loop
- Files: src/agent/agentLoop.ts, tests/agentLoop.test.ts
- Outcome: Pass
- Notes: runAgentLoop drives model → tool → model cycle. All events recorded into TraceRecorder. Terminates on final_answer or max_steps. Terminal metadata step appended before any throw so partial traces are well-formed.

### 2026-07-04 — Phase 2C: Terminal trace contract patch
- Phase: Contract clarification
- Files: src/agent/agentLoop.ts (patch), docs/03_trace_schema.md
- Outcome: Pass
- Notes: Codex audit flagged terminal step schema gaps. Unified terminal metadata payloads across success and both failure paths. Timestamp/hash policy documented in schema.

### 2026-07-04 — Phase 3A: Cassette persistence and replay
- Phase: Replay foundation
- Files: src/replay/CassetteReplay.ts, tests/replay.test.ts
- Outcome: Pass (15 tests)
- Notes: saveTrace/loadTrace round-trips via JSON. validateTrace checks index sequence, prevHash chain, and hash recomputation. replayTrace(trace: Trace): ReplaySummary — no ModelClient or FixtureTool parameter, making offline guarantee structural not convention.

### 2026-07-04 — Phase 3B: CLI record and replay examples
- Phase: CLI scripts
- Files: src/examples/record.ts, src/examples/replay.ts, tests/examples.test.ts
- Outcome: Pass
- Notes: example:record runs 3-tool scripted run (search → calendar → booking → final answer), produces 15-step trace. example:replay loads cassette, validates, and prints all events — zero model/tool instantiation.

### 2026-07-04 — Phase 3C: Fork trace foundation
- Phase: Fork
- Files: src/fork/forkRun.ts, src/trace/TraceRecorder.ts (loadPrefix addition), tests/fork.test.ts
- Outcome: Pass (10 tests)
- Notes: forkRun copies parent prefix steps verbatim via loadPrefix(), then re-enters runAgentLoop. Prefix steps preserve original timestamps and hashes. First new child step chains prevHash to last prefix step's hash. validateTrace passes on child traces.

### 2026-07-04 — Phase 3D: Trace divergence diff
- Phase: Diff
- Files: src/fork/diffTraces.ts, tests/diffTraces.test.ts
- Outcome: Pass (11 tests)
- Notes: diffTraces walks both step arrays by index, compares hash fields. Returns sharedPrefixLength, firstDivergenceIndex, both steps at divergence, and strict-prefix flags. formatFirstDivergence() produces deterministic terminal output.

### 2026-07-04 — Phase 3E: Fork CLI example
- Phase: CLI script
- Files: src/examples/fork.ts, tests/examples.test.ts (fork describe block added)
- Outcome: Pass (7 additional tests)
- Notes: example:fork loads example-trace.json, forks at index 8 (after search + calendar rounds, before booking), runs child with mutated prompt, saves example-trace-fork.json, prints first-divergence diff. All three scripts chain cleanly.

### 2026-07-04 — Final docs polish
- Phase: Docs
- Files: README.md, src/examples/fork.ts (comment only)
- Outcome: Complete
- Notes: Removed overclaim ("break a tool") from README tagline. Added Quick Start section with commands in correct run order. Fixed fork.ts file comment to accurately describe fake deterministic model.

---

## 2026-07-04 — Week-One Completion

### Tag
`week-one-cli-proof` → commit `dda0c72 docs: polish week-one proof wording`

### What Was Built
- **Trace core**: append-only `TraceStep` chain with canonical SHA-256 hashing (`src/trace/`)
- **Agent primitives**: `FakeDeterministicModelClient`, three deterministic fixture tools, `runAgentLoop` (`src/agent/`)
- **Cassette**: `saveTrace`, `loadTrace`, `validateTrace`, `replayTrace` — fully offline replay (`src/replay/`)
- **Fork**: `forkRun` — copies parent prefix verbatim, continues with mutated prompt (`src/fork/forkRun.ts`)
- **Diff**: `diffTraces`, `formatFirstDivergence` — finds first hash divergence, marks strict-prefix cases (`src/fork/diffTraces.ts`)
- **CLI examples**: `example:record`, `example:replay`, `example:fork` (`src/examples/`)
- **Tests**: 85 tests across 7 files, all passing

### Final Acceptance Criteria Status
| Criterion | Status |
|---|---|
| `npm test` passes | ✓ 85/85 |
| `example:record` creates a trace file | ✓ `traces/example-trace.json`, 15 steps |
| `example:replay` replays fully offline — no model/tool calls | ✓ structural guarantee (no params) |
| `example:fork` creates a child trace | ✓ `traces/example-trace-fork.json`, 11 steps |
| Parent and child share canonical-hash-identical prefix before fork point | ✓ steps 0–7 identical hashes |
| Terminal output marks first divergence clearly | ✓ `First divergence at index 8` with hashes |

### Demo Commands (in order)
```sh
npm test -- --run
npm run example:record
npm run example:replay
npm run example:fork
```

### Known Limitations
1. **Prompt mutation only.** `forkRun` mutates the prompt fed to the agent at the fork point. Tool-result mutation (injecting a different tool response at a past step) is not yet implemented.
2. **Fake model and tools only.** `FakeDeterministicModelClient` and fixture tools are deterministic stubs. No real model or tool integration exists; the proof is entirely local.
3. **CLI only, no UI.** All interaction is terminal output. No web UI, dashboard, or graph view.
4. **Replay summarizes, does not re-execute.** `replayTrace` reads recorded payloads and builds a summary. It does not re-run the model or tools, so replay cannot detect whether a re-execution would differ.
5. **No cassette versioning.** The JSON schema has no version field; forward compatibility is unguarded.

### Recommended Next Phase (scoped)
In priority order — do not expand scope without explicit decision:
1. **Tool-result mutation**: allow `forkRun` to inject a replacement tool result at a past step and continue from there (alongside prompt mutation).
2. **Harden fork/continuation semantics**: define and test what happens when the fork point is a non-`model_input` step (e.g., a `tool_result`). Currently the fork always re-enters `runAgentLoop` with a fresh prompt.
3. **Cassette schema versioning**: add a `version` field to `Trace` so future format changes can be detected and rejected gracefully.
4. **Better demo traces**: richer example runs — longer chains, error paths, max-step exceeded — to make the diff output more illustrative.
5. **UI (deferred)**: no web UI until the above is solid and explicitly chosen.

---

## 2026-07-05 — Week Two Completion

### Tag
`week-two-core-hardening` → commit `42e2b4f docs: clarify fork prefix wording`

### What Was Built

**W2-A — Cassette schema versioning**
- Added `CURRENT_TRACE_VERSION = 1` constant and `version: number` to `Trace`
- `loadTrace` is the deserialization gate: rejects cassettes with no version or an unsupported version number
- `validateTrace` unchanged — hash-chain integrity only
- Files: `src/trace/TraceTypes.ts`, `src/trace/TraceRecorder.ts`, `src/replay/CassetteReplay.ts`, `tests/replay.test.ts`, `tests/trace.test.ts`

**W2-B — Tool-result mutation**
- Extended `forkRun` with `toolResultMutations?: Record<number, JsonValue>`
- Verbatim prefix before earliest mutation; re-appended (re-chained) from mutation point to `forkIndex`
- Mutated `tool_result` payload preserves original `toolName`, replaces only the `result` value
- `reconstructMessages()` rebuilds message history with injected values, passed as `initialMessages` to agent loop
- Guards: rejects non-canonical keys (`"abc"`, `"3.5"`, `"03"`), out-of-prefix targets, non-`tool_result` targets, stale `model_input` between mutation and fork point
- Audited and patched twice by Codex before acceptance
- Files: `src/fork/forkRun.ts`, `src/agent/agentLoop.ts`, `tests/fork.test.ts`

**W2-C — Fork continuation semantics**
- Defined and documented fork-point behavior for every step type (`model_input`, `model_output`, `tool_call`, `tool_result`, `metadata`)
- Added guard rejecting fork at `metadata` steps (terminal run markers with no meaningful continuation)
- Added tests for fork at `model_output` (step 1) and `tool_call` (step 2); both produce valid hash chains
- Codex audit polish: added `forkedFromStepId` and `prevHash` boundary assertions to new tests
- Files: `src/fork/forkRun.ts`, `docs/03_trace_schema.md`, `tests/fork.test.ts`

**W2-D — Richer demo traces and clearer terminal output**
- `example:record` now produces two traces: success path (`traces/example-trace.json`, search → calendar → booking) and error path (`traces/example-error-trace.json`, model hallucinates unknown tool `"flights"`)
- `example:fork` switched from prompt mutation to tool-result mutation: injects "no hotels available" at step 3, forks at step 4, shows labeled terminal sections (original run / mutation / prefix / child run / trace diff)
- `docs/03_trace_schema.md` Fork Policy updated to precisely state the no-mutation and mutation-mode prefix invariants
- `README.md` updated: Status reflects Week Two completion; Week-Two Hardening section added; Quick Start corrected for tool-result mutation
- Codex audit patch: added error-path `describe` block (5 tests) and docs fixes
- Files: `src/examples/record.ts`, `src/examples/fork.ts`, `tests/examples.test.ts`, `README.md`, `docs/03_trace_schema.md`, `docs/09_week_two_plan.md`

### Final Acceptance Criteria Status
| Criterion | Status |
|---|---|
| `npm test` passes | ✓ 111/111 |
| `example:record` creates success trace | ✓ `traces/example-trace.json`, 15 steps |
| `example:record` creates error trace | ✓ `traces/example-error-trace.json`, 5 steps, `run_failed/unknown_tool` |
| `example:replay` replays fully offline | ✓ structural guarantee (no model/tool params) |
| `example:fork` creates child trace via tool-result mutation | ✓ `traces/example-trace-fork.json`, 7 steps |
| Prefix hashes identical before first divergent step | ✓ steps 0–2 match; step 3 (mutation target) diverges |
| Terminal output marks first divergence clearly | ✓ labeled sections; `First divergence at index 3` with hashes |
| Cassette schema versioning guards | ✓ `loadTrace` rejects missing/unsupported version |
| Fork at non-`model_input` steps works | ✓ `model_output` and `tool_call` fork points tested |
| Fork at `metadata` step rejected | ✓ clear error message |
| Codex audit verdict | ✓ Week Two accepted |

### Demo Commands (in order)
```sh
npm test -- --run
npm run example:record   # creates traces/example-trace.json and traces/example-error-trace.json
npm run example:replay   # replays success trace offline from cassette
npm run example:fork     # injects different search result, forks at step 4, diffs histories
```

### Known Limitations
1. **Local/CLI only.** No hosted backend, no sharing, no remote cassette storage. Everything runs on the local filesystem.
2. **Fake model and tools only.** `FakeDeterministicModelClient` and fixture tools are deterministic stubs. No real model API or external tool integration exists.
3. **No UI.** All interaction is terminal output. No web UI, dashboard, branch graph, or timeline view.
4. **Continuation semantics are demo-hardened, not a general SDK.** Fork and mutation behavior is well-defined and tested for the demo scenarios. Edge cases outside the tested paths (e.g., deeply nested multi-agent runs, partial-step interruptions) are not handled.
5. **Single-agent only.** The loop, recorder, and fork logic assume one agent running one tool at a time. Multi-agent orchestration is out of scope.
6. **Replay summarizes, does not re-execute.** `replayTrace` reads stored payloads; it does not re-run the model or tools and cannot detect whether a re-execution would differ.

### Recommended Next Milestone (scoped)
In priority order — do not expand scope without explicit decision:
1. **Package the CLI experience**: add a single entry-point CLI command (e.g., `npx blackbox record`, `blackbox fork`) so the tool is usable without knowing the internal script paths.
2. **Improve cassette ergonomics**: named cassette IDs, cassette listing, and a `blackbox diff <cassette-a> <cassette-b>` command that works on any two saved traces without writing a script.
3. **Richer mutation scenarios**: multiple simultaneous tool-result mutations, mutation of `model_input` payloads (system prompt injection), and a `--dry-run` flag that validates the mutation without running the agent.
4. **Portfolio/demo writeup**: a short published post or README demo video showing the record → fork → diff loop on a realistic agent task; useful for sharing progress and gathering feedback.
5. **Web UI (explicitly deferred)**: no UI work until the CLI is solid and UI is explicitly chosen as the next milestone.

---

## 2026-07-05 — Week Three Completion

### Tag
`week-three-cli-packaging` → commit `9e98fd6 docs: polish week three demo docs`

### What Was Built

**W3-A — Unified CLI entry point**
- `src/cli.ts`: hand-rolled arg parser; per-command flag allow-lists and value-presence checks; `record`, `replay`, `fork`, `diff` subcommands dispatched via a top-level switch
- `npm run cli -- <subcommand> [flags]` is the single supported invocation; no global binary, no `bin/` directory, no new dependencies
- Codex audit patch: unknown flags rejected before file I/O; missing value flags rejected; default fork output path derived from parent path (`traces/example-trace-fork.json`) rather than trace ID
- Files: `src/cli.ts`, `tests/cli.test.ts`, `package.json`, `docs/10_week_three_plan.md`, `docs/11_cli_spec.md`

**W3-B — Cassette list and inspect commands**
- `list` scans a directory for `.json` files, loads each with `loadTrace`, validates each with `validateTrace` (hash-chain check), prints a compact `id/version/steps/status/createdAt/parentId` row; invalid files get a `[warning]` row and are excluded from the valid count
- `inspect` loads one cassette, validates it, runs `replayTrace` offline, then prints a full step-by-step timeline with index, type, 8-char hash prefix, and payload summary
- Codex audit patch: `list` was not calling `validateTrace` — hash-tampered cassettes were silently counted as valid; fixed; tampered-trace integration test added
- Files: `src/cli.ts`, `tests/cli.test.ts`, `docs/11_cli_spec.md`

**W3-C — Terminal output polish**
- Consistent `[blackbox]` section headers across all six commands; sub-section markers (`--- events ---`, `--- parent ---`, `--- mutation ---`, `--- child ---`, `--- trace diff ---`, `--- steps ---`) added for visual structure
- `diff` command gained a `[blackbox] --- diff ---` header with file paths before the formatted output
- `list` summary line changed to `[blackbox] N of M trace(s) valid, W warning(s).`
- `humanSummary()` added to `src/fork/diffTraces.ts`: derives a one-line description of the first divergence from the `TraceDiff` struct — `"<type> differs at index N"`, `"parent ended before child at index N"`, or `"child ended before parent at index N"` — surfaced as `Summary: ...` in `formatFirstDivergence` output above raw hash/payload lines
- Four new unit tests for `humanSummary` variants; CLI fork and diff integration tests assert `"Summary:"` present
- Files: `src/cli.ts`, `src/fork/diffTraces.ts`, `tests/diffTraces.test.ts`, `tests/cli.test.ts`, `docs/11_cli_spec.md`

**W3-D — Demo walkthrough**
- `DEMO.md`: full command-by-command walkthrough of the six-command demo flow with expected output shapes, explanations of what each command reads/writes, key proof points (offline replay structural guarantee, prefix hash identity, tool-result mutation mechanics, human divergence summary), real-vs-mocked table, and limitations
- `README.md`: status updated, Week Three CLI section added (W3-A through W3-D), Quick Start updated to `npm run cli --` form with a link to `DEMO.md`
- Docs polish: `docs/10_week_three_plan.md` acceptance criteria updated to match implemented flag interface; `docs/11_cli_spec.md` fork output section description corrected to actual section names

### Final Acceptance Criteria Status
| Criterion | Status |
|---|---|
| `npm test -- --run` passes | ✓ 162/162 |
| `npm run cli -- record` creates both demo traces | ✓ `traces/example-trace.json` (15 steps), `traces/example-error-trace.json` (5 steps) |
| `npm run cli -- list` shows valid/warning counts | ✓ validates hash chains; tampered files counted as warnings |
| `npm run cli -- inspect` prints step timeline | ✓ offline; no model/tool instantiation |
| `npm run cli -- replay` replays fully offline | ✓ structural guarantee (no model/tool params) |
| `npm run cli -- fork` creates child trace via tool-result mutation | ✓ `traces/example-trace-fork.json`, 7 steps, valid hash chain |
| `npm run cli -- diff` prints human summary and first divergence | ✓ `Summary: tool_result differs at index 3` + raw hash/payload lines |
| Flag validation: unknown flags and missing values rejected | ✓ checked before any file I/O |
| `DEMO.md` exists and is accurate | ✓ all six commands documented with output shapes |
| Codex audit verdict | ✓ Week Three accepted |

### Demo Commands (in order)
```sh
npm install
npm test -- --run
npm run cli -- record
npm run cli -- list
npm run cli -- inspect
npm run cli -- replay
npm run cli -- fork
npm run cli -- diff --parent traces/example-trace.json --child traces/example-trace-fork.json
```

### Known Limitations
1. **Local CLI only.** No hosted backend, no sharing, no remote cassette storage. Everything runs on the local filesystem.
2. **Fake model and tools only.** `FakeDeterministicModelClient` plays back scripted responses; fixture tools are deterministic in-memory stubs. No real model API or external tool integration exists.
3. **No real-agent adapter.** Running Blackbox against arbitrary agent code requires implementing the `ModelClient` interface. No adapter for any real LLM SDK ships yet.
4. **No UI.** All interaction is terminal output. No web UI, dashboard, branch graph, or timeline view.
5. **No npm package or global binary.** The CLI is invoked via `npm run cli --` inside the repo. Packaging as a global binary or published package is a future phase.
6. **Single-agent only.** The loop, recorder, and fork logic assume one agent running one tool at a time. Multi-agent orchestration is out of scope.
7. **Replay summarizes, does not re-execute.** `replayTrace` reads stored payloads and cannot detect whether a re-execution of the same inputs would produce different outputs.

### Recommended Next Milestone (scoped)
In priority order — do not expand scope without explicit decision:
1. **Real-agent adapter spike**: implement a thin `ModelClient` wrapper around one real LLM SDK (e.g., Anthropic SDK) so Blackbox can record an actual model run. Fake tools are fine for the first spike; the point is to prove the hash chain and replay hold against real model output.
2. **Install ergonomics**: add a `"bin"` entry and a shebang wrapper so the CLI is invocable as `npx blackbox` or a global `blackbox` command without `npm run`.
3. **Richer mutation scenarios**: multiple simultaneous tool-result mutations, `model_input` payload mutation (system-prompt injection), `--dry-run` flag that validates a fork without running the agent.
4. **Portfolio/demo polish**: record an `asciinema` cast of the full demo flow and commit it to `docs/`; add a "Demo" section to `README.md` with an embedded or linked terminal recording.
5. **Web UI (explicitly deferred)**: no UI work until the above is solid and UI is explicitly chosen as the next milestone.

---

## 2026-07-06 — Week Four W4-C Completion (Anthropic adapter spike)

### What Was Built

**W4-C1 — Adapter skeleton with injected-client tests**
- `src/agent/anthropicModelClient.ts`: `AnthropicModelClient implements ModelClient`, constructor accepts an optional injected `client` so tests need no `ANTHROPIC_API_KEY`; missing key throws `ModelCallError("provider_auth_error")`
- Added `inputSchema?: JsonObject` to `ToolDefinition` in `src/agent/modelClient.ts` (additive, backward-compatible)
- Mocked tests added to the **default suite** — no live calls

**W4-C2 — Request/response translation with mocked tests**
- `complete()` translates `ModelInput` → Anthropic `messages.create` params (system, messages, tools with `input_schema` fallback) and Anthropic response → `ModelOutput` (`end_turn` → final_answer, `tool_use` → tool_call, `refusal`/others → `ModelCallError`)
- SDK errors normalized to sanitized `ModelCallError`; no provider-native fields (`tool_use_id`, `usage`, `message.id`) reach `agentLoop` or `TraceStep.payload`
- Non-streaming: `stream` omitted, SDK default overload selected

**W4-C3 — Explicit proof script**
- `src/examples/realRunProof.ts`, run with `npm run example:real-proof`
- Proof is **final-text-only** record → offline replay: records one real run with a final-text-only prompt (no tools), saves `traces/anthropic-proof-trace.json`, then replays fully offline via `loadTrace` + `replayTrace`
- Missing `ANTHROPIC_API_KEY` **fails safely** — exits 1 with a clear message and writes no trace
- The real Anthropic provider is used only during the record phase; replay never calls the provider

### Guardrails Held
- No CLI Anthropic adapter wiring — `FakeDeterministicModelClient` remains the default in all tests and CLI commands
- No default live tests — `npm test -- --run` passes with 216 tests and zero real provider calls
- Replay remains structurally offline (`replayTrace` takes only a `Trace`)
- API key read only from `ANTHROPIC_API_KEY`; never logged, never stored in any trace or file

### Deferred
- Real-provider **tool-use / fork continuation** is deferred until structured transcript migration (Path B in `docs/13_adapter_contract.md`). The legacy transcript encoding cannot persist `tool_use_id`, so a fresh adapter instance cannot reconstruct tool-result correlation from a cassette. W4-C proves record → offline replay only.

### Final Acceptance Criteria Status
| Criterion | Status |
|---|---|
| `npm test -- --run` passes | ✓ 216/216, zero live calls |
| `npm run cli -- record` / `replay` / `fork` unchanged | ✓ fake model/tools still default |
| `npm run example:real-proof` without key | ✓ exits 1, no trace written |
| No CLI adapter flag wiring | ✓ proof-script only |
| Codex audit verdict | ✓ W4-C ready to close, no critical issues |

---

## 2026-07-06 — Week Four W4-D Completion (structured transcript migration)

### What Was Built

**W4-D1 — Structured transcript types + `toolCallId` helper** (`ff7f44d`)
- Added the `MessagePart` union to `src/agent/modelClient.ts` and widened `Message.content` to `string | MessagePart[]`; `ModelOutput` unchanged.
- Added a deterministic, provider-neutral `toolCallId` helper (`call-0`, `call-1`, …; pure function of run-local index). Types/helper only — no schema bump, no behavior change.

**W4-D2 — Atomic schema v2 writer** (`0269e24`)
- Bumped `CURRENT_TRACE_VERSION` to 2; `loadTrace` rejects v1 cassettes with a re-record message (no migration shim).
- `agentLoop` emits structured `tool_use`/`tool_result` `MessagePart[]` rounds; `toolCallId` added to `model_output`/`tool_call`/`tool_result` payloads. Replay stayed offline.

**W4-D3 — Structured fork reconstruction + id preservation/seeding** (`a6ab058`)
- `forkRun` reconstructs structured `MessagePart[]` histories; mutated `tool_result` preserves `toolCallId`/`toolName`, replacing only `result`.
- `runAgentLoop` gained `initialToolCallIndex`; continued runs seed the next id past the prefix so `call-0` is never reused. Stale `model_input` guard unchanged; `hash.ts` untouched.

**W4-D4 — Anthropic adapter mocked structured translation** (`41f0db7`)
- `translateMessages` consumes `MessagePart[]`: `text`→text block; `tool_use`→tool_use block (`id = toolCallId`); `tool_result`→tool_result block (`tool_use_id = toolCallId`, `is_error: true` on error variant).
- A fresh adapter translates cassette-derived structured history with **no** `#pendingToolCalls` state; legacy `[tool_call:]`/pending kept only as a narrow pre-v2 string fallback. Mocked-client tests only.

**W4-D5 — Docs / status closeout** (this entry)
- Updated `docs/03_trace_schema.md` (v2 + `MessagePart` model + structured fork reconstruction), `docs/13_adapter_contract.md` (Path B implemented status + W4-E deferral), `docs/15_week_four_d_plan.md` (slice status/verdict), `README.md`, `DEMO.md`, `AGENTS.md`.
- Tightened one adapter comment to avoid overclaiming (removes adapter-memory dependency for mocked translation; live acceptance deferred to W4-E). No runtime behavior change.

### Guardrails Held
- No live provider calls; no live/key-gated tests added; `npm test -- --run` passes with 253 tests and zero real calls.
- No CLI Anthropic wiring — `FakeDeterministicModelClient` remains the default everywhere.
- Replay remains structurally offline; `hash.ts` and trace schema algorithm unchanged (version constant is 2).
- No provider-native ids/usage/message-ids/content-arrays in any payload.

### Deferred (NOT proven in W4-D)
- That a live Anthropic API **accepts a synthetic Blackbox `toolCallId` as a provider `tool_use.id`**, and any real-provider tool-use / fork-continuation run. Deferred to **W4-E** (Context7 + installed types + a live proof). W4-D proves neutral reconstruction against a mocked client only.

### Final Acceptance Criteria Status
| Criterion | Status |
|---|---|
| `npm test -- --run` passes | ✓ 253/253, zero live calls |
| `npm run cli -- record` / `replay` / `fork` / `diff` | ✓ v2 structured payloads; fake model/tools default |
| `npm run example:real-proof` without key | ✓ exits safely, no trace written |
| No CLI adapter flag wiring | ✓ proof-script only |
| Real-provider tool-use / fork acceptance | ✗ not claimed — deferred to W4-E |
| Codex closeout audit | pending (this closeout awaiting audit before tagging) |

---

## 2026-07-06 — Week Four W4-E slice E1 (real tool-use proof gate — PASSED)

### What Was Built
- **E1 plan** (`fc54d8d`) — `docs/16_week_four_e_plan.md`: narrow, opt-in, live-gated proof of whether the real Anthropic Messages API accepts Blackbox's synthetic provider-neutral `toolCallId` (`call-0`) as the request-local `tool_use.id` / `tool_result.tool_use_id`.
- **E1 gate** (`ed1628a`) — opt-in `src/examples/realToolUseProof.ts` + `example:real-tooluse-proof` (not in `npm test`, no CLI wiring); pure offline helpers `src/examples/toolUseProofHelpers.ts` (`auditNeutrality`, `collectToolBlockIds`) with 14 offline unit tests.

### SDK-boundary verification (AGENTS.md rule 5/7)
- Installed `@anthropic-ai/sdk` 0.110.0 types: `ToolUseBlockParam.id: string`, `ToolResultBlockParam.tool_use_id: string`, `is_error?: boolean` — types permit `call-0`.
- Context7 (`/websites/platform_claude_en_api`): `tool_use_id` documented as the request-local id of the tool_use a result corresponds to; no format constraint documented. Runtime acceptance of a *synthetic* id was the residual E1 proves.

### Empirical result — with-key live run (2026-07-06)
- Provider: Anthropic (real); Model: `claude-haiku-4-5-20251001`.
- Requests sent: 2; tool rounds: 1.
- **Turn-2 request carried `tool_use.id="call-0"` and `tool_result.tool_use_id="call-0"`; the API accepted it** and the run completed to a final answer.
- Saved cassette: `traces/anthropic-tooluse-parent.json` (git-ignored) — version 2, 7 steps, `call-0` in `model_output`/`tool_call`/`tool_result` payloads.
- Offline replay: `success`. Neutrality audit: clean (no `toolu_`/`msg_`/`usage`/`stop_reason`/`stop_sequence`/key).
- **Verdict: PASS.** The synthetic-`toolCallId` acceptance assumption is proven for a single real record; the §9 rollback was not needed.

### Guardrails Held
- One authorized live call, run manually by the human; no live tests in `npm test` (`npm test -- --run`: 267/267, zero live calls). No CLI Anthropic wiring. Replay stayed offline (Trace-only). `hash.ts`, `replayTrace`, and the adapter unchanged. No provider-native ids/usage/message-ids/content-arrays/`stop_reason`/key in the trace. The git-ignored cassette was not committed.

### Still Deferred (NOT yet proven)
- Real **fork continuation** with a fresh adapter from a mutated fork point (E2/E3 — record → replay → fork → mutate → continue → diff live). Not started. No tag until E3 lands and Codex accepts.

---

## 2026-07-06 — Week Four W4-E slices E2/E3 (real fork continuation — PASSED)

### What Was Built
- **E2/E3 plan** (`7cc12d6`) — `docs/17_week_four_e2e3_plan.md`: the full live loop over a real cassette (load parent → offline replay → fork at `tool_result` → mutate → continue with a fresh `AnthropicModelClient` → diff).
- **E2/E3 gate** (`d4d01f8`) — opt-in `src/examples/realForkProof.ts` + `example:real-fork-proof` (not in `npm test`, no CLI wiring); one offline mocked integration test `tests/forkAnthropicContinuation.test.ts` (7 tests). No product-runtime change — `forkRun`, `hash.ts`, `replayTrace`, and `AnthropicModelClient` unchanged.

### Empirical result — with-key live run (2026-07-06)
- Parent loaded from `traces/anthropic-tooluse-parent.json` (v2, 7 steps); offline replay `success`; neutrality clean.
- Fork geometry located dynamically: mutation target step 3 (`tool_result`), fork index 4 (`model_input`).
- Mutation: `{ results: [], available: false, message: "No hotels available for that date." }`.
- **Continuation by a fresh `AnthropicModelClient` (no pending state): the request carried `tool_use.id="call-0"` and `tool_result.tool_use_id="call-0"` plus the mutated result; the real API accepted it.**
- Child (`anthropic-tooluse-parent-001-fork`, v2, 7 steps) saved to `traces/anthropic-tooluse-fork.json` (git-ignored). `diffTraces`: first divergence at index 3 (mutated `tool_result`), shared prefix 3 steps hash-identical. Child neutrality clean; child replays offline (`success`).
- **Verdict: PASS.** The full active-debugging loop — record → replay → fork → mutate → continue → diff — is proven against the live provider. The §9 rollback was not needed.

### Guardrails Held
- One authorized live call, run manually by the human; no live tests in `npm test` (`npm test -- --run`: 274/274, zero live calls). No CLI Anthropic wiring. Replay stayed offline (Trace-only). No provider-native ids/usage/message-ids/content-arrays/`stop_reason`/key in either cassette. Both git-ignored cassettes were not committed.

### W4-E status
- E1 (single-record synthetic-id acceptance) and E2/E3 (fresh-adapter fork continuation) both proven live. Codex closeout audit completed and tagged `week-four-real-fork-proof`.

---

## 2026-07-07 — Week Four W4-F (cassette verification + trace hygiene)

### What Was Built
- **Plan** (`e708da5`, Codex-accepted) — `docs/18_week_four_f_plan.md`.
- **Neutrality → core** — new `src/trace/neutrality.ts`: `NEUTRALITY_FORBIDDEN` (now includes `sk-ant`), compatibility `auditNeutrality(serialized, apiKey?)` (unchanged substring behavior), and a new structured `auditTraceNeutrality(trace, apiKey?)` that flags key-form provider markers (`usage`/`stop_reason`/`stop_sequence`/`ANTHROPIC_API_KEY`) only as object keys and value-form markers (`toolu_`/`msg_`/`sk-ant`/`ANTHROPIC_API_KEY`) inside string values — reducing false positives from benign text like "usage". A leaked literal key surfaces as `<api-key-value>`, never echoed. `src/examples/toolUseProofHelpers.ts` now re-exports the audit (proof scripts/tests unchanged; `collectToolBlockIds` stays).
- **Verification core** — new `src/trace/verifyTrace.ts`: `verifyTrace(trace, opts?)` (pure/offline, in-memory `Trace` only) runs `schema_version → hash_chain → provider_neutrality → replayability`, short-circuits at the first FAIL (later invariants → `skip`), returns a structured `VerifyReport` (PASS/FAIL, per-invariant detail, first failing invariant, step index when localized). `verifyTraceFile(path, opts?)` wraps `loadTrace` and maps read/JSON/version failures onto a `schema_version` FAIL instead of throwing. `replayability` fails only when a trace *claims* `run_completed`/`success` but replay disagrees — a legitimate terminal-error trace passes; `skipReplay` bypasses.
- **CLI** — `npm run cli -- verify --trace <path>` (`src/cli.ts`): flag-based, prints the PASS/FAIL report, exits 0/1. No change to `record`/`replay`/`fork`/`diff`/`list`/`inspect`.
- **Tests** — `tests/verifyTrace.test.ts` (valid traces, missing/unsupported/legacy version, malformed JSON + missing file via `verifyTraceFile`, hash mismatch / broken prevHash / index gap with step index, `toolu_`/`msg_`/`usage`/`stop_reason`/`ANTHROPIC_API_KEY`/`sk-ant`/literal-key leakage, benign "usage" text not flagged, non-terminal success claim → replay FAIL, `skipReplay`); CLI verify PASS/FAIL/missing-file/bad-flag smokes in `tests/cli.test.ts`.

### Outcome
- **Pass.** `npm test -- --run`: **304/304** at the W4-F commit (307/307 after the follow-up secret-key audit hardening), zero live calls. `record`/`replay`/`fork`/`diff` unchanged and green. `verify` PASS→exit 0, FAIL/missing→exit 1. `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard (no live call; re-export resolves). `git ls-files traces` empty — no cassette committed. `package.json` gained no dependency.

### Guardrails Held
- No behavior change to `hash.ts`, `validateTrace`, `replayTrace`, `loadTrace`. `verifyTrace` takes only an in-memory `Trace` (cannot make a live call by construction); `verifyTraceFile` only reads the filesystem. No new provider adapter, no CLI Anthropic wiring, no live tests. No key value ever printed.

---

## 2026-07-07 — Week Four W4-G (fork/verify workflow polish)

### What Was Built
- **Plan** (`a2f0e0d`) + Codex-accepted **patch** (`5a1ca0e`) — `docs/19_week_four_g_plan.md`.
- **Composed self-check core** — new `src/workflow/selfCheck.ts`: `runSelfCheck(opts?)` runs the full offline loop **record → verify(parent) → fork → verify(child) → diff** by *composing* the existing `runAgentLoop`, `verifyTrace`, `forkRun`, and `diffTraces` over `FakeDeterministicModelClient` + `defaultToolExecutor()`. Returns a structured `SelfCheckReport` (per-stage pass/fail, first failing stage, in-memory parent/child traces). Cannot make a real model/tool/network call by construction. Persistence is opt-in and controlled **solely by `opts.outDir`** (writes `check-parent.json` + `check-child.json`, then verify/diff run over the same in-memory traces so the verdict is identical with or without persistence); there is no `--keep` flag. No change to hash/replay/load/fork/diff/verify semantics.
- **CLI** — `npm run cli -- check` (and `check --out-dir <dir>`) in `src/cli.ts`: allow-lists only `--out-dir`, prints `[blackbox] --- check ---`, a Mode line, the stage checklist, `Result: PASS/FAIL`, the first failing stage when relevant, and (only with `--out-dir`) the persisted parent/child paths. Exit 0 on PASS / 1 on FAIL (scriptable, like `verify`). Formatting is inline to `check` — the optional shared `src/cli/format.ts` helper was **skipped** to keep zero churn on existing commands (permitted by the plan).
- **Fork overwrite guardrail** — `runFork` now rejects (exit 1, `Refusing to overwrite the parent trace …`) when the resolved absolute `--out` equals the resolved absolute `--trace`, closing the data-loss footgun (explicit collision or a `--trace` lacking `.json` whose derived default output collides). The check runs before `forkRun`, so the parent file is untouched. Normal fork behavior is otherwise unchanged.
- **Tests** — new `tests/selfCheck.test.ts` (default in-memory PASS with the five stages in order; default writes no files; determinism; parent/child each verify; diff stage reports first divergence at index 3 over a hash-identical prefix; `--out-dir` writes exactly the two cassettes; persisted parent/child load+validate+verify with child `parentId`; persistence doesn't change the verdict). `tests/cli.test.ts` extended with `check` PASS/stages, in-memory-no-files, `--out-dir` persistence + path assertions, `check --bogus` exit-1, and the `fork --trace X --out X` overwrite guard (exit 1, parent bytes unchanged). No `--keep` tests.

### Outcome
- **Pass.** `npm test -- --run`: **321/321** (307 pre-W4-G baseline + 14 new), zero live calls. `record`/`replay`/`fork`/`diff`/`verify`/`list`/`inspect` unchanged and green. `check` PASS→exit 0; `check --out-dir traces/selfcheck-smoke` writes the two cassettes under the git-ignored `traces/`. `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard (no live call). `git ls-files traces` empty — no cassette committed. `package.json` gained no dependency.

### Guardrails Held
- Composition only — no new record/replay/fork/diff/verify logic and no change to their semantics (`hash.ts` untouched). `runSelfCheck` and `check` instantiate only the fake model + fixture tools, so no live call is possible. Default `check` writes nothing; `--out-dir` writes only the two named cassettes into git-ignored `traces/`. No UI/backend/dashboard, no Anthropic CLI wiring, no new provider adapter, no LangChain/LlamaIndex/MCP, no new dependency, no observability surface. No key value ever printed.

## 2026-07-07 — Week Five W5-A (trace fixture corpus + regression harness)

### What Was Built
- **Plan** (`540e902`, Codex-accepted) — `docs/20_week_five_a_plan.md`.
- **Committed fake/offline v2 corpus** — new `fixtures/traces/` with five cassettes: `success-final-answer.v2.json`, `success-tool-use.v2.json`, `error-unknown-tool.v2.json`, `fork-parent.v2.json`, `fork-child.v2.json`. All generated only from `FakeDeterministicModelClient` + `defaultToolExecutor()` (no Anthropic/live/provider data), timestamp-normalized to a fixed base so they are byte-reproducible, and provider-neutral by construction. `fork-child` is forked from the normalized `fork-parent` with a tool-result mutation at step 3; it shares a hash-identical prefix (steps 0–2) and first diverges at index 3.
- **Deterministic generator** — new `scripts/generateFixtures.ts` (`npm run fixtures:generate`). Composes the existing fake/offline functions plus a local `normalizeTrace(trace, base)` helper that rebuilds each trace through a standard `TraceRecorder` with a fixed timestamp so the existing hash chain recomputes deterministically (fixture tooling only — no runtime semantic change). **Check mode by default** (regenerate in memory, compare to committed files, exit 1 on drift, write nothing); writes only with `--write`. Cannot make a real model/tool/network call by construction. Exports `buildCorpus`, `FIXTURES_DIR`, `FIXTURE_MANIFEST`, `FORK_FIRST_DIVERGENCE_INDEX`, and `serializeFixture` for the harness.
- **`.gitignore` anchor** — changed `traces/` → `/traces/` so the root generated-output directory stays ignored while `fixtures/traces/` is committable (the unanchored pattern also matched `fixtures/traces/`). Verified with `git check-ignore`.
- **Regression harness** — new `tests/fixtures.test.ts` (offline) loads the committed corpus and asserts: manifest completeness; each fixture is v2 and `validateTrace`-clean; **frozen final-step hashes** (plus the full frozen hash chain of the smallest fixture); provider neutrality (structured audit + a raw-text scan for every `NEUTRALITY_FORBIDDEN` marker); success fixtures replay as `success` with the expected result and `verifyTrace` PASS; the error fixture replays as `error`/`unknown_tool` and still `verifyTrace` PASSES (terminal error not falsely rejected); the fork pair shares a hash-identical prefix with a **frozen** `firstDivergenceIndex` (3); the in-memory generator build matches the committed bytes (generator ↔ corpus cannot drift); and `git check-ignore`/`ls-files` confirm `fixtures/traces/` is tracked while root `traces/` stays ignored.
- **Docs** — `README.md` gains a "Week-Five Regression Hardening" line + a "Trace fixture corpus" section (fake/offline only; deliberate `--write` regeneration with the update-the-frozen-hashes caveat); `package.json` gains the `fixtures:generate` script (no new dependency).

### Outcome
- **Pass.** `npm test -- --run`: **360/360** (321 pre-W5-A baseline + 39 new), zero live calls. `record`/`replay`/`fork`/`diff`/`verify`/`check`/`list`/`inspect` unchanged and green. `npm run cli -- check` PASS. `npm run fixtures:generate` (check mode) reports the corpus in sync. `git check-ignore -v traces/example-trace.json` → ignored via `/traces/`; `fixtures/traces/…` not ignored. `git ls-files traces` empty; `git ls-files fixtures/traces` lists the five committed fixtures. `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard (no live call). `package.json` gained no dependency.

### Guardrails Held
- Consume/freeze only — no change to `hash.ts`, `TraceTypes.ts`, `TraceRecorder`, `verifyTrace`, `neutrality`, `CassetteReplay` (`loadTrace`/`validateTrace`/`replayTrace`), `forkRun`, `diffTraces`, `selfCheck`, or `cli.ts`. `normalizeTrace` is fixture tooling built from existing primitives. The corpus and generator are fake/offline only — no Anthropic/live/provider trace, nothing copied from `traces/`, no committed corrupt fixtures (negative cases are derived in-memory at test time). No UI/backend/dashboard, no Anthropic CLI wiring, no live tests, no new provider adapter, no new dependency, no observability surface.

## 2026-07-07 — Week Five W5-B (public demo narrative + repo readiness)

### What Was Built
- **Plan** (`9f267df` + Codex-accepted patch `78dd343`) — `docs/21_week_five_b_plan.md`.
- **Docs-only repo-readiness pass.** No runtime, source, test, fixture, or config change. Files touched: `README.md`, `DEMO.md`, `AGENTS.md`, `CLAUDE.md`, `docs/08_build_log.md`, and the plan doc `docs/21_week_five_b_plan.md`.
- **`README.md`** — re-authored as the repo front door: leads with what Blackbox is, states the core loop (`record → replay → fork → mutate → continue → diff → verify → check`) with one-line verb meanings, adds a "What it proves" section, and adds consolidated **"What Blackbox is" / "What Blackbox is not"**, **"Proof status"** (fake/offline default loop; opt-in Anthropic proof scripts; committed fixture corpus; no UI/backend/dashboard/observability), and **"For reviewers"** (four-command skeptic path) sections. Corrected the stale Status headline (previously led with "W4-D complete") to the current post-W5-A state (`week-five-trace-fixture-corpus`, 360/360). The per-milestone `✓` history is retained and re-framed under a "Build history" heading.
- **`DEMO.md`** — fixed the stale current test count (`321` → `360`) in Prerequisites; added a step 9 **Fixtures** section (`npm run fixtures:generate` check mode) so the walkthrough ends on `… → verify → check → fixtures`; added `fixtures:generate` to the end-to-end command block. Commands unchanged and still accurate; no overclaim.
- **`AGENTS.md`** — narrow current-state pointer refresh only: "Current State" now reads **W5-B docs/repo-readiness (W5-A closed and tagged `week-five-trace-fixture-corpus`)**; removed the stale "W5-A implemented — awaiting Codex audit before tag / Not yet tagged" language. Guardrails, build-scope rules, agent-role table, invariants, and all historical milestone entries preserved verbatim.
- **`CLAUDE.md`** — narrow current-state/count/next-step refresh only: "Post-W4-G. Ready for W5-A planning" → **Post-W5-A, W5-B docs/repo-readiness in progress**; current test count `321/321` → **360/360**; added `week-five-trace-fixture-corpus` to the closed-tag set; re-pointed "Sequencing" and "Next Safest Task" to the W5-B docs-readiness flow. Guardrails, technical rules, and response format preserved.

### Outcome
- **Pass (docs-only; test total unchanged).** `npm test -- --run`: **360/360**, zero live calls. `npm run cli -- check` PASS. `npm run fixtures:generate` (check mode) reports the corpus in sync. `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard (no live call). `git ls-files traces` empty; `git ls-files fixtures/traces` lists the five committed fixtures. `git diff --name-only` shows only the six allowed docs. Historical test counts inside prior milestone entries preserved (e.g. W4-G 321, W4-F 304/307) — only current-state counts read 360.

### Guardrails Held
- Documentation only — no change to any file under `src/`, `tests/`, `scripts/`, or `fixtures/`, and no change to `package.json`, `package-lock.json`, `.gitignore`, or build config. No runtime/CLI/provider behavior change; no live call run; no new dependency. Anthropic proofs remain described as opt-in, human-run, never-in-`npm test`, never-CLI-wired. No UI/backend/dashboard/observability positioning introduced; no production-readiness or shipped-SDK/package claim.

## 2026-07-07 — Week Six W6-A (diff/inspect ergonomics)

### What Was Built
- **Plan** (`ecf0d43` + Codex-accepted patch `5f3a094`) — `docs/22_week_six_a_plan.md`. Codex verdict: *Ready for W6-A implementation, no critical issues.*
- **Shared presentation helper** — new `src/trace/stepLabels.ts`: a pure, disk-free, hash-free module (no model/tool/network by construction) exporting `stepTypeLabel(type)` (single source of truth for human step-type labels — `tool_result → "tool result"`, etc.), `describeStep(step)` (the one-line summary lifted **verbatim** from the former `CassetteReplay.summarizeStep`, same branches/wording/`never` guard), and `describeDivergenceField(parent, child)` (renders the value that actually changed at a divergence — extracting the salient `result`/`toolInput`/`text` field — with a wide 240-char budget so the difference is visible rather than truncated mid-key).
- **Replay unchanged (verbatim lift).** `CassetteReplay.replayTrace` now calls `describeStep` instead of a local copy; the local `summarizeStep` was removed. `events[].summary` and `events[].type` (raw enum) are byte-identical; `runReplay` output is unchanged and its assertions passed unedited. `stepTypeLabel` is **not** applied at the replay render site. `replayTrace`'s Trace-only signature and offline guarantee are intact.
- **`formatFirstDivergence` improved once, benefiting both callers.** In `src/fork/diffTraces.ts`, the per-side lines now show the humanized `stepTypeLabel` + `describeStep` instead of a 60-char JSON dump, followed by a `changed value (<field>):` block from `describeDivergenceField`. The `TraceDiff` interface, the `diffTraces()` computation (`sharedPrefixLength` / `firstDivergenceIndex` / strict-prefix flags), and the raw-type `Summary:` humanSummary line are unchanged, so the existing `diffTraces.test.ts` string assertions pass unedited. The one function is printed by both `runDiff` (standalone `diff`) and `runFork` (inline `--- trace diff ---`), so **both** surfaces gain the legible readout. `inspect`/`replay` render sites were left untouched (no `stepTypeLabel` on their type columns), so their output — and their tests — are unchanged.
- **Tests** — new `tests/stepLabels.test.ts` (unit + exhaustive `stepTypeLabel`, per-kind `describeStep`, `describeDivergenceField`, a replay-unchanged parity check over the committed corpus asserting `replayTrace` summaries equal `describeStep` and types stay raw, and a corpus-based diff-legibility check proving the frozen fork pair diverges at index 3 with the mutation visible). `tests/cli.test.ts` extended with a fork inline-diff mutation-visibility case and a standalone-`diff` mutation-visibility case over the frozen corpus fork pair.
- **Docs** — `DEMO.md` step 5 (Fork) inline diff block and step 6 (Diff) block re-quoted to the new legible output with an updated proof point; the Replay and Inspect blocks are unchanged. `docs/22_week_six_a_plan.md` status moved to implemented/in closeout.

### Outcome
- **Pass.** `npm test -- --run`: **381/381** (360 pre-W6-A baseline + 21 new), zero live calls, no API key required. `record`/`replay`/`verify`/`check`/`list`/`inspect` output unchanged and green; `diff`/`fork` show the new legible divergence block. `npm run cli -- check` PASS. `npm run fixtures:generate` (check mode) reports the corpus in sync (no fixture byte or frozen-hash change). `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard (no live call). `git ls-files traces` empty; `git ls-files fixtures/traces` lists the five committed fixtures unchanged. `package.json`/`package-lock.json` untouched.

### Guardrails Held
- Presentation/ergonomics only — no change to `hash.ts`, `TraceStepHashInput`, `CURRENT_TRACE_VERSION`, `Trace`/`TraceStep`/`TraceStepType`, `validateTrace`, `replayTrace`'s computed status/result, `forkRun`, or the `diffTraces()` computation. Replay output byte-identical; first divergence remains index 3 for the corpus fork pair. No schema change, no canonical-hash change, no fixture rewrite, no frozen-hash update. No new CLI flag/command/exit code (no `--format`, no `compact`/`detail`); allow-lists unchanged. No UI/backend/dashboard/observability, no Anthropic CLI wiring, no live call, no new provider adapter, no new dependency, no `package.json`/`package-lock.json` change.

## 2026-07-07 — Week Six W6-B (verify/replay failure explanation)

### What Was Built
- **Plan** (`f31089a`) — `docs/23_week_six_b_plan.md`. Codex verdict: *Ready for W6-B implementation, no critical issues.*
- **Pure presentation helper** — new `src/trace/verifyExplain.ts`: a pure, disk-free, hash-free module (no invariant logic, no trace mutation, no hashing, no replay, no file I/O, no model/tool/provider call by construction) exporting `suggestedAction(name)` (single source of truth for a plain-language next action per `VerifyInvariantName`, exhaustive with a `never` guard) and `formatVerifyFailure(report)` (renders the labelled `Failure` block from `report.firstFailure.{name, detail, stepIndex}` + `suggestedAction`, word-wrapping the action). It performs **no** parsing of `detail` — the expected-vs-actual hash and offending provider markers are surfaced by presenting the pre-existing `detail` verbatim, so a masked secret (`<api-key-value>`) stays masked. Returns `[]` for a PASS report or a report with no `firstFailure`.
- **`runVerify` failure footer only.** In `src/cli.ts`, the single `First failing invariant: …` line was replaced with the labelled block from `formatVerifyFailure`. The header, `Path`/`Result`, the per-invariant table (`verifyLine`), the PASS path (no footer), and `process.exit(1)` on FAIL are unchanged. No `runReplay`/`runCheck`/allow-list change; no new flag/command/exit code. `verifyTrace`, `verifyTraceFile`, the four invariant checks, their ordering/short-circuit, and the `VerifyReport`/`VerifyInvariant` types are untouched.
- **Tests** — new `tests/verifyExplain.test.ts` (unit + exhaustive `suggestedAction`; `formatVerifyFailure` structure incl. `[]` for PASS/missing-`firstFailure`; all four invariant explanations — schema_version, hash_chain with step index + expected/actual detail, provider_neutrality with offending marker, replayability; and secret-masking asserting `<api-key-value>` renders and the raw secret does not). `tests/cli.test.ts` verify cases updated to assert the new labelled block (`Failure` / `invariant: hash_chain` / `action:` / `re-record`) and that the PASS path prints no failure block.
- **Docs** — `DEMO.md` verify "On failure" paragraph re-quoted to the new labelled block with an example; the PASS block is unchanged. `docs/23_week_six_b_plan.md` status moved to implemented/in closeout.

### Outcome
- **Pass.** `npm test -- --run`: **394/394** (381 pre-W6-B baseline + 13 new), zero live calls, no API key required. `record`/`replay`/`fork`/`diff`/`check`/`list`/`inspect` and the `verify` PASS path output unchanged; only the `verify` FAIL footer changed. `npm run cli -- check` PASS. `npm run fixtures:generate` (check mode) reports the corpus in sync (no fixture byte or frozen-hash change). `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard (no live call). `git ls-files traces` empty; `git ls-files fixtures/traces` lists the five committed fixtures unchanged. `package.json`/`package-lock.json` untouched. `git diff --check` clean.

### Guardrails Held
- Presentation only — no change to trace schema (`CURRENT_TRACE_VERSION`, `Trace`/`TraceStep`/`TraceStepType`), canonical hashing (`hash.ts`, `TraceStepHashInput`), `validateTrace`, `replayTrace` (Trace-only/offline guarantee intact), `forkRun`, the `diffTraces()` computation, or any provider/adapter code. No `VerifyReport` shape change; no invariant-ordering change. No fixture rewrite, no frozen-hash update. No new CLI flag/command/exit code; allow-lists unchanged; PASS output byte-identical; exit codes unchanged (0 PASS / 1 FAIL). No UI/backend/dashboard/observability, no Anthropic CLI wiring, no live call, no new provider adapter, no new dependency, no `package.json`/`package-lock.json` change.

## 2026-07-07 — Week Six W6-C (release freeze + README/DEMO verification)

### What Was Built
- **Plan** (`f0979ee` + Codex-accepted patches `45faf5d`, `8646aa0`) — `docs/24_week_six_c_plan.md`. Codex verdict after two patches: *Ready for W6-C implementation, no critical issues.*
- **Docs-only release-freeze pass.** No runtime, source, test, fixture, or config change. Files touched: `README.md`, `DEMO.md`, `AGENTS.md`, `CLAUDE.md`, `docs/08_build_log.md`, and the plan status header `docs/24_week_six_c_plan.md`.
- **Phase A — command verification (read-only).** Verified every command shown in `README.md` and `DEMO.md` against its source of truth: all `npm run *` commands map to real `package.json` scripts (`test`, `cli`, `fixtures:generate`, `example:real-proof`, `example:real-tooluse-proof`, `example:real-fork-proof`); all eight `npm run cli -- <sub>` subcommands map to real dispatch cases in `src/cli.ts` (`record`, `replay`, `fork`, `diff`, `verify`, `check`, `list`, `inspect`) with the documented flags/defaults/exit codes. **No command mismatch found** — so the milestone stayed docs-only (no §3.2 source-fix escalation).
- **Phase B — docs reconciled to reality.**
  - **`README.md`** — Status headline advanced from "Post-W5-A. Ready for W5-B" to the **W6-C release-freeze** state; the single "Latest tag" line replaced with the **durable** §3.5 wording (**latest release-freeze tag** `week-six-release-freeze`; **latest technical-capability tag before release-freeze** `week-six-verify-replay-explanations`) so it stays true after W6-C is tagged; current test count `360/360 → 394/394` (Status + "For reviewers" block); **Build history** extended with **W5-B** (`week-five-public-demo-readiness`), **W6-A** (`week-six-diff-inspect-ergonomics`), **W6-B** (`week-six-verify-replay-explanations`), and a **W6-C** (`week-six-release-freeze`) note. No command/flag/path/expected-output block changed.
  - **`DEMO.md`** — opening core-loop string extended to `record → replay → fork → mutate → continue → diff → verify → check`; Prerequisites count `# 360 tests → # 394 tests`. No step body, command, flag, path, or expected-output block changed (Phase A confirmed them accurate; W6-A/W6-B already refreshed the diff/verify blocks).
  - **`AGENTS.md`** — "Current State" section retitled to **W6-C release-freeze / docs verification (W6-B closed and tagged)**; W6-C named the current milestone; W5-A/W5-B/W6-A/W6-B reframed as closed-and-tagged; current baseline **394/394**; stale current `360/360` removed. Build Scope Guardrails, invariants, the Documentation Rule, the Agent Roles table, Commit Hygiene, the Test Rule, and every historical milestone entry (and their historical counts) preserved verbatim.
  - **`CLAUDE.md`** — Current-State headline advanced to **Post-W6-B; W6-C in progress**; test count `360/360 → 394/394`; closed-tag list extended with `week-five-public-demo-readiness`, `week-six-diff-inspect-ergonomics`, `week-six-verify-replay-explanations` (marked current tagged HEAD) plus an "in progress: W6-C" line; "Sequencing" and "Next Safest Task" re-pointed from the W5-B flow to the W6-C release-freeze flow. Hard Guardrails, Technical Rules, Core Loop, and Response Format preserved verbatim.
  - **`docs/24_week_six_c_plan.md`** — status header moved to IMPLEMENTED / in closeout; plan body unchanged.

### Outcome
- **Pass (docs-only; test total unchanged).** §6-A local pre-push checklist: `npm test -- --run` → **394/394**, zero live calls, no API key. `npm run cli -- check` → PASS. `npm run fixtures:generate` (check mode) → corpus in sync (5 fixtures match; no fixture byte or frozen-hash change). `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` → exits 1 at the key guard (no live call, no trace written). `git ls-files traces` empty; `git ls-files fixtures/traces` lists the five committed fixtures unchanged. `git diff --name-only HEAD -- src tests scripts fixtures package.json package-lock.json .gitignore` empty. `git diff --check` clean. `git diff --name-only` shows only the allowed docs (`README.md`, `DEMO.md`, `AGENTS.md`, `CLAUDE.md`, `docs/08_build_log.md`, `docs/24_week_six_c_plan.md`). Historical counts inside prior milestone entries preserved (W4-G 321, W5-A 360, W6-A 381, W6-B 394) — only current-state headlines read 394. §6-B post-push/tag checklist is applied after local Codex acceptance and push.

### Guardrails Held
- Documentation only — no change to any file under `src/`, `tests/`, `scripts/`, or `fixtures/`, and no change to `package.json`, `package-lock.json`, `.gitignore`, or build config. No runtime/CLI/provider behaviour change; no live call run; no new dependency. No new CLI flag/command/exit code; the CLI surface is verified, not extended. Anthropic proofs remain described as opt-in, human-run, never-in-`npm test`, never-CLI-wired. No UI/backend/dashboard/observability positioning introduced; no production-readiness or shipped-SDK/package claim. README tag wording is durable (does not call W6-B "the latest tag" unqualified), so it stays true after the `week-six-release-freeze` tag lands.

## 2026-07-07 — Week Seven W7-A (reactive deterministic fake model)

### What Was Built
- **Plan** (`c738273` + Codex-accepted patch `1b5d8dc`) — `docs/25_week_seven_a_plan.md`. Demo-credibility slice on the **continuation** step of the offline fork demo: make the child's answer *derive* from the mutated `tool_result` instead of returning a hardcoded string. Scoped explicitly to add no schema/hash/replay/fork-reconstruction/provider/fixture/CLI-surface change.
- **New reactive continuation model** — new `src/agent/reactiveDemoModel.ts` exporting `ReactiveDemoModelClient`: one small `ModelClient` whose `complete(input)` is a **pure, deterministic** function of `ModelInput` — no clock, randomness, I/O, network, or provider import; it never mutates its input and always returns `final_answer` (never `tool_call`), so the demo child stays at 7 steps. It scans `input.messages` for the most recent `tool_result` `MessagePart` and applies a fixed five-rule table: (1) error variant → answer naming the tool and embedding the error; (2) `available === false` or empty `results` → "no availability" answer **embedding the payload's `message`**; (3) non-empty `results` → availability answer embedding the result count + first title; (4) no `tool_result` in the transcript (every prompt-mode fork) → deterministic answer derived from the last user message text; (5) unrecognized-but-JSON-safe shape → deterministic fallback embedding the tool name + a canonical rendering, never throws. Output text is provider-neutral (child traces pass the neutrality audit). It is **not** a framework: one class, one rule table, no configuration surface. `FakeDeterministicModelClient` is **unchanged** and remains the default for record/scripted paths, the fixtures generator, and scripted tests.
- **Two injection-site swaps only.** `src/cli.ts` `runFork` — both the tool-result mode's `DEMO_FORK_ANSWER` continuation and the prompt mode's `"Prompt-mode fork complete."` continuation now use `new ReactiveDemoModelClient()`; both dead constants/literals deleted. `src/workflow/selfCheck.ts` fork stage — the injected model becomes `new ReactiveDemoModelClient()`; the local `DEMO_FORK_ANSWER` deleted. No flag, allow-list, output section, guardrail, exit code, or composition semantics changed. `forkRun`'s reconstruction (`initialMessages` only under tool-result mutations) is untouched, so prompt-mode continuations honestly hit rule 4.
- **Tests** — new `tests/reactiveDemoModel.test.ts` (all five rules, determinism, input non-mutation, always-`final_answer`); `tests/fork.test.ts` extended with a reactive-continuation block (two payloads → two different answers each embedding its own message; same payload → same answer; child validates/verifies/replays-to-the-derived-answer/neutrality; 7 steps, hash-identical prefix, first divergence at index 3; availability payload → rule-3 answer; prompt-mode fork → rule-4 prompt-derived answer); `tests/cli.test.ts` extended (default fork `Result:` embeds "No hotels available for that date."; a custom `--payload-json` marker appears in the child answer and differs from the default); `tests/selfCheck.test.ts` extended with the required derivation test (`runSelfCheck().childTrace` replays offline to a result embedding the demo mutation's `message`). `tests/fixtures.test.ts`, the existing `selfCheck`/`cli` check assertions, and all frozen-hash constants pass **unedited**.
- **Docs** — `DEMO.md` step 5 `Result:` line re-quoted to the new derived answer + a new "answer is derived, not scripted" proof point; the `check` proof point, the "What Is Real vs. Mocked" model rows, and the Current Limitations bullet reworded to name **both** fake clients (scripted for record, reactive for fork/`check` continuation) while preserving fake/offline/zero-live-calls; `DEMO.md` fixtures proof point (generated from the scripted fake) left **verbatim** (generator untouched). `README.md` proof-status row reworded the same way. `AGENTS.md` / `CLAUDE.md` fake-client invariant reworded to "fake/offline deterministic model clients" naming both clients, preserving the guardrail's force (default fake/offline, no key). `docs/25_week_seven_a_plan.md` status header moved to IMPLEMENTED / in closeout.

### Outcome
- **Pass.** `npm test -- --run`: **417/417** (394 pre-W7-A baseline + 23 new), zero live calls, no API key required. `npm run cli -- check` PASS with **byte-identical** stdout (child stays 7 steps, mutation at step 3; report never quotes the answer). Default `cli fork` now prints a derived `Result:` line embedding the mutated payload's message; a different `--payload-json` yields a different answer. `npm run fixtures:generate` (check mode) reports the corpus in sync (5 fixtures match; no fixture byte or frozen-hash change). `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits 1 at the key guard (no live call, no trace written). `git ls-files traces` empty; `git ls-files fixtures/traces` lists the five committed fixtures unchanged. `git diff --name-only HEAD -- scripts/generateFixtures.ts fixtures package.json package-lock.json .gitignore` empty; `git diff --name-only HEAD -- src/trace src/replay src/fork/forkRun.ts src/fork/diffTraces.ts` empty; `git diff --check` clean. `grep -rn "No hotels available for Alice" src/cli.ts src/workflow` empty; `"Prompt-mode fork complete."` gone from `src/cli.ts`. Retained-by-design occurrences remain only in `src/examples/fork.ts`, `scripts/generateFixtures.ts`, and `tests/fixtures.test.ts`.

### Guardrails Held
- Demo-continuation behavior only — no change to `src/trace/hash.ts`, `TraceStepHashInput`, `CURRENT_TRACE_VERSION`, `Trace`/`TraceStep`/`TraceStepType`, `validateTrace`, `replayTrace` (Trace-only/offline signature intact), `forkRun` (reconstruction untouched — prompt mode honestly hits rule 4), the `diffTraces()` computation, `verifyTrace`/`verifyExplain`, `neutrality.ts`, `stepLabels.ts`, `agentLoop.ts`, `fixtureTools.ts`, any provider/adapter or proof-script code, `src/examples/fork.ts`, `scripts/generateFixtures.ts`, or anything under `fixtures/`. `FakeDeterministicModelClient` itself is unchanged. No fixture rewrite, no frozen-hash update. No new CLI flag/command/exit code; allow-lists (`FORK_ALLOWED`) unchanged; `check` output byte-identical; exit codes unchanged. No new dependency; `package.json`/`package-lock.json`/`.gitignore` byte-identical. No UI/backend/dashboard/observability, no Anthropic CLI wiring, no live call anywhere in the diff, no new provider adapter. The reactive model is one class with a fixed rule table — no configuration/plugin/DSL surface.

### Closeout docs patch (Codex "needs patch" → resolved; docs-only)
- Codex audit accepted the W7-A runtime (correct `ReactiveDemoModelClient`; only the two continuation injection sites changed; `FakeDeterministicModelClient`/`forkRun`/trace/replay/hash/diff/verify/fixtures/generator/package/CLI-surface unchanged; 417/417; `check` PASS; corpus in sync; no-key proof exits safely) but flagged three stale docs. Fixed docs-only, no runtime/source/test/fixture/package change:
  - **`README.md`** — Status advanced from "Week Six release-frozen (W6-C)" to **W7-A reactive fake model implemented/in closeout** with a current-milestone line; test count `394/394 → 417/417` (Status block + "For reviewers" `npm test` comment `# 394 tests → # 417 tests`); added the **Week-Seven Reactive Fake Model** (`week-seven-reactive-fake-model`) build-history section stating the offline fork/`check` continuation now derives the child answer from the mutated `tool_result` via `ReactiveDemoModelClient`, preserving no-overclaim wording (fake/offline, deterministic, zero live calls, no real model in the default CLI).
  - **`DEMO.md`** — Prerequisites `npm test` count `# 394 tests → # 417 tests`. No command body or expected-output block changed.
  - **`docs/11_cli_spec.md`** — replaced the stale prompt-mode note (which claimed a hardcoded `FakeDeterministicModelClient` response `"Prompt-mode fork complete."`) with the W7-A behavior: prompt-mode uses `ReactiveDemoModelClient`; with no tool-result mutations `forkRun` passes no reconstructed tool-result history, so the model applies its prompt-derived fallback and the answer is derived from the mutated prompt text (deterministic, fake/offline) — explicitly not the parent's tool-result history and not a hardcoded scripted string.
- **Verification (unchanged from the implementation entry):** `npm test -- --run` 417/417; `npm run cli -- check` PASS; `npm run fixtures:generate` corpus in sync; `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard; `git ls-files traces` empty; `git ls-files fixtures/traces` 5 unchanged; `git diff --name-only HEAD -- src tests scripts fixtures package.json package-lock.json .gitignore` empty; `git diff --check` clean. Landed as `docs: patch reactive fake model closeout docs`.
