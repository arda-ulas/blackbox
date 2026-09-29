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

## 2026-07-08 — Week Seven W7-B (behavioral outcome diff)

### What Was Built
- **Plan** (`89223ff` + Codex-accepted patch `a6c874d`) — `docs/26_week_seven_b_plan.md`. Codex verdict after the wiring patch: *Ready for W7-B implementation, no critical issues.* Analysis/presentation slice on the **diff** step: make `diff`/`fork` report how the two runs' *terminal behavior* differs, not just where their hashes diverge.
- **New single-trace module** — `src/trace/traceOutcome.ts`: two pure, offline, deterministic reads over a `Trace`. `terminalOutcome(trace)` returns `{ status: "success" | "error" | "incomplete"; finalAnswer?; failureReason? }` from the last `metadata` step, using the exact semantics `replayTrace` used inline (single source of truth for terminal-status parsing). `toolCallSequence(trace)` returns the ordered tool names from **`tool_call`** steps — the locked decision (documented in the module header): the sequence is the agent's executed requests, not `tool_result` steps. No clock, randomness, I/O, or provider/model/tool call; never mutates input.
- **New two-trace module** — `src/fork/diffOutcome.ts`: `diffOutcome(parent, child)` classifies the behavioral delta with strict precedence — (1) status differs → outcome flipped; (2) same status, terminal result (final answer for success / failure reason for error) differs → answer/reason changed; (3) same status + same result, tool sequence differs → same outcome, different tool path; (4) all equal → no behavioral change (`behaviorallyEquivalent = true`). Exact-string comparison only (no semantic judge, which would need a model call). Pure; runs independently of `diffTraces`; does not mutate inputs. `formatOutcomeDiff(outcome)` renders the one-line `Outcome:` verdict, plus the two tool sequences only when they differ. Provider-neutral text.
- **Wrapper formatter, structural layer untouched** — `src/fork/diffTraces.ts` gains `formatDiffReport(parentTrace, childTrace)` that composes `diffTraces` → `formatFirstDivergence` → `diffOutcome` → `formatOutcomeDiff` (structural block verbatim, then a blank line, then the `Outcome:` block). Because `formatFirstDivergence` receives only a `TraceDiff` (no full traces, no terminal outcomes), it cannot compute the verdict itself — so `diffTraces()`, the `TraceDiff` shape, and `formatFirstDivergence` are all **unchanged**. `src/cli.ts` `runDiff` and `runFork` switch from calling `formatFirstDivergence(diff)` directly to `formatDiffReport(parentTrace, childTrace)` — a formatter-call change only; no command, flag, allow-list, or exit-code change. One wrapper serves both surfaces.
- **Replay DRY refactor, byte-identical** — `src/replay/CassetteReplay.ts` `replayTrace` now derives `status`/`result`/`failureReason` for its `ReplaySummary` via the shared `terminalOutcome()` instead of an inline last-`metadata` parse. Returned fields and the CLI `replay` output stay byte-identical (`replayTrace` itself writes no stdout — the CLI's `runReplay` renders the summary). Trace-only signature and offline guarantee intact.
- **Tests** — new `tests/traceOutcome.test.ts` (terminalOutcome success/error/incomplete, corpus parity vs `replayTrace`, `toolCallSequence` uses `tool_call` and ignores `tool_result`); new `tests/diffOutcome.test.ts` (all four precedence branches, no-behavioral-change, no-divergence pair, determinism/no-input-mutation, `formatOutcomeDiff` tool-sequence gating, `formatDiffReport` composition — structural output verbatim as prefix + `Outcome:` block, structural layer contains no `Outcome:` text); `tests/fork.test.ts` extended (reactive demo fork → same success status, final answer changed); `tests/cli.test.ts` extended (`fork` and frozen-corpus `diff` print the `Outcome:` line + tool sequences, structural block still present); `tests/replay.test.ts` extended (replayTrace terminal fields agree with `terminalOutcome` for success + incomplete). `tests/fixtures.test.ts`, `tests/selfCheck.test.ts`, and all existing diff/replay/check assertions pass **unedited**.
- **Docs** — `DEMO.md` step 5 (Fork) and step 6 (Diff) expected-output blocks gain the `Outcome:` line; each adds a proof point framing the behavioral verdict as computed offline from the two traces by exact-string comparison (no model call, no semantic judge). `README.md` Status advanced to W7-B (test count 417 → 442, `week-seven-reactive-fake-model` now the latest capability tag) + a **Week-Seven Behavioral Outcome Diff** build-history entry. `AGENTS.md` / `CLAUDE.md` current-state pointers advanced to W7-B (W7-A closed and tagged; baseline 442/442). `docs/26_week_seven_b_plan.md` status header moved to IMPLEMENTED / in closeout.

### Outcome
- **Pass.** `npm test -- --run`: **442/442** (417 pre-W7-B baseline + 25 new), zero live calls, no API key required. `npm run cli -- diff` and `fork` now print the `Outcome:` verdict (e.g. `same final status (success), but the final answer changed`, with `parent tools: search → calendar → booking` vs `child tools: search`). `npm run cli -- check` PASS with **byte-identical** stdout; CLI `replay` output byte-identical. `npm run fixtures:generate` (check mode) reports the corpus in sync (5 fixtures match; no fixture byte or frozen-hash change). `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits 1 at the key guard (no live call). `git ls-files traces` empty; `git ls-files fixtures/traces` lists the five committed fixtures unchanged. `git diff --name-only HEAD -- scripts/generateFixtures.ts fixtures package.json package-lock.json .gitignore` empty; `git diff --name-only HEAD -- src/trace/hash.ts src/fork/forkRun.ts` empty; `git diff --check` clean.

### Guardrails Held
- Analysis/presentation only — no change to `src/trace/hash.ts`, `TraceStepHashInput`, `CURRENT_TRACE_VERSION`, `Trace`/`TraceStep`/`TraceStepType`, `validateTrace`, `replayTrace`'s **signature/returned fields**, `forkRun`, the `diffTraces()` **computation**, the `TraceDiff` **shape**, `formatFirstDivergence` (stays structural, `TraceDiff`-only), `verifyTrace`/`verifyExplain`, `neutrality.ts`, `stepLabels.ts`, `agentLoop.ts`, `fixtureTools.ts`, `modelClient.ts`, `reactiveDemoModel.ts`, any provider/adapter or proof-script code, `scripts/generateFixtures.ts`, or anything under `fixtures/`. No fixture rewrite, no frozen-hash update. No new CLI flag/command/exit code; allow-lists unchanged; `check` and CLI `replay` output byte-identical; exit codes unchanged. No new dependency; `package.json`/`package-lock.json`/`.gitignore` byte-identical. No UI/backend/dashboard/observability, no Anthropic CLI wiring, no live call anywhere in the diff, no new provider adapter. The outcome diff is two pure functions + one wrapper + two formatter-call switches — no configuration/plugin/DSL surface, and comparison is exact-string (no semantic judge).

## 2026-07-08 — Week Eight W8-A (terminal experience polish)

### What Was Built
- **Plan** (`a03d6a0` + patches `0bfaf93`, `d730812`) — `docs/27_week_eight_a_plan.md`, Codex-accepted. Presentation-only slice across the whole CLI surface: one shared, restrained, premium terminal grammar; zero behavior change.
- **New pure module** — `src/render/termStyle.ts`: dependency-free, no I/O, no module-scope `process.env` read. Structural helpers `header(command)` (the shared `◼ blackbox · <command>` banner), `section(name)` (a dimmed subsection label replacing ad-hoc `--- x ---` sub-rules), and `kv(label, value, width?)` (one aligned key/value renderer replacing the three duplicated per-command `label()` closures). Hand-rolled ANSI helpers (`dim` / `bold` / `green` / `red` / `yellow` / `cyan`, ~15 lines, no `chalk`) plus `verdict` / `palette` / `GLYPH`. The single gate `colorEnabled({ isTTY, env })` returns `true` **only** when `isTTY === true` AND `"NO_COLOR"` is not a key in `env` AND `"CI"` is not a key in `env` (presence check via `"x" in env`, not truthiness — `NO_COLOR: ""` still disables). Pure function of injected inputs; never reads `process.env`/`process.stdout`. Glyphs limited to the five allowed (`✓ ✗ → ▸ ◼`), decorative only — text labels carry the meaning. No literal ESC byte in source (represented as `\x1b`).
- **CLI restyle** — `src/cli.ts` routes all eight command surfaces (record / replay / fork / diff / verify / check / list / inspect) through `header` / `section` / `kv` and the color helpers; the duplicated local `label()` closures are deleted. `PASS`/`FAIL`, the first-divergence line, and the `Outcome:` verdict gain subtle emphasis (color + `✓`/`✗`) with their text content unchanged — `PASS`, `FAIL`, `Outcome:`, `First divergence` remain plain substrings. Flag parsing, exit codes, `die()` control flow, and every computed value are untouched; no stdout↔stderr movement.
- **Formatters byte-identical** — the four pure formatters (`formatFirstDivergence`, `formatOutcomeDiff`, `verifyExplain`, `stepLabels`) were **not** edited; the polish is delivered at the command frame, so every frozen behavioral-diff spacing assertion stays green.
- **Tests** — new `tests/termStyle.test.ts` (the `colorEnabled` 8-row truth table over `isTTY × NO_COLOR-present × CI-present` including the `NO_COLOR: ""` empty-present case, `kv` alignment, forced-color via injected `enabled: true` asserting SGR pairs, forced-plain no-escape; no `process.env` mutation). New `tests/cliNoAnsi.test.ts` — the structural no-ANSI guard asserting zero `/\x1b\[/` escapes on non-TTY **stdout** for every command success path and on non-TTY **stderr** for error/`die()` paths, under plain non-TTY, `NO_COLOR`-present, and `CI`-present, plus a `check`-run-twice byte-identity guard. `tests/cli.test.ts` assertions hand-migrated to the new grammar, keeping the semantic anchors. `tests/fixtures.test.ts` passes **unmodified**.
- **`check` stdout re-baseline (the one deliberate deviation)** — adopting the shared grammar reshapes `check`'s output once, on purpose. `runSelfCheck` logic and return shape are untouched; exit code stays `0` PASS / `1` FAIL; the new output is deterministic and byte-identical run-to-run. Before/after captured below and in `docs/27_week_eight_a_plan.md` §4.1.

  BEFORE (pre-W8-A `npm run cli -- check`, non-TTY):

  ```
  [blackbox] --- check ---
  Mode:           in-memory (no files written; pass --out-dir to persist)

    record         pass  success trace, 15 step(s)
    verify_parent  pass  4/4 invariants
    fork           pass  child valid, 7 step(s), tool_result mutation at step 3
    verify_child   pass  4/4 invariants
    diff           pass  first divergence at index 3, shared prefix 3 step(s)

  Result:         PASS
  ```

  AFTER (post-W8-A `npm run cli -- check`, non-TTY — glyphs shown, zero ANSI escapes; byte-identical run-to-run):

  ```
  ◼ blackbox · check
  Mode:           in-memory (no files written; pass --out-dir to persist)

    ✓  record          pass  success trace, 15 step(s)
    ✓  verify_parent   pass  4/4 invariants
    ✓  fork            pass  child valid, 7 step(s), tool_result mutation at step 3
    ✓  verify_child    pass  4/4 invariants
    ✓  diff            pass  first divergence at index 3, shared prefix 3 step(s)

  Result:         ✓ PASS
  ```

- **Docs** — every `DEMO.md` expected-output block regenerated from real non-TTY runs to the new grammar; `README.md` Status advanced to W8-A (test count 442 → 481, current milestone `week-eight-terminal-polish`, `week-seven-behavioral-outcome-diff` the latest capability tag) + a **Week-Eight Terminal Experience Polish** build-history entry; `AGENTS.md` / `CLAUDE.md` current-state pointers advanced to W8-A (W7-B closed and tagged; baseline 481/481); `docs/27_week_eight_a_plan.md` status header at IMPLEMENTED / in closeout with the before/after capture filled.

### Outcome
- **Pass.** `npm test -- --run`: **481/481** (442 pre-W8-A baseline + 39 new), zero live calls, no API key required. `npm run cli -- check` PASS (exit 0), stdout **byte-identical run-to-run** (captured twice, `diff` clean). All eight commands' non-TTY stdout and error-path stderr are **escape-free** (verified for `record`/`list`/`inspect`/`replay`/`fork`/`verify`/`check`/`diff` and the `die()`/missing-flag/unknown-command paths). `npm run fixtures:generate` (check mode) reports the corpus in sync (5 fixtures match; no fixture byte or frozen-hash change). `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard (no live call). `git ls-files traces` empty; `git ls-files fixtures/traces` lists the five committed fixtures unchanged. `git diff --name-only HEAD -- scripts/generateFixtures.ts fixtures package.json package-lock.json .gitignore` empty; `git diff --name-only HEAD -- src/trace/hash.ts src/fork/forkRun.ts src/replay/CassetteReplay.ts` empty; `git diff --check` clean.

### Guardrails Held
- Presentation only — no change to `src/trace/hash.ts`, the trace schema/`CURRENT_TRACE_VERSION`, `replayTrace` semantics or returned fields, `forkRun`, `runSelfCheck` **logic or return shape** (`src/workflow/selfCheck.ts` unmodified), the `diffTraces()` computation, or the `TraceDiff` / `OutcomeDiff` / `VerifyReport` shapes. The four pure formatters (`formatFirstDivergence`, `formatOutcomeDiff`, `verifyExplain`, `stepLabels`) are byte-identical. No provider/adapter or proof-script change; no fixture rewrite; `scripts/generateFixtures.ts`, everything under `fixtures/`, `package.json`, `package-lock.json`, and `.gitignore` byte-identical; **no new dependency** (ANSI is hand-rolled). No new CLI command or flag (deliberately no `--color`/`--no-color`; `NO_COLOR` env is the only opt-out); no exit-code change; no stdout↔stderr stream movement; no machine-readable/JSON mode. No animation, spinner, mascot, emoji, box-drawing, or timeline/branch-graph rendering; glyphs limited to the five allowed (`✓ ✗ → ▸ ◼`, wordmark header-only), decorative with text carrying the meaning. No literal ESC byte in source or tests; no `process.env` mutation in tests. `check` stdout changed exactly once, deliberately, with before/after captured. The one changed source file is `src/cli.ts` (call-site restyle) plus the new `src/render/termStyle.ts`.

### Closeout patch — per-stream color gates (Codex "needs patch" → resolved; presentation-only)
- **Blocker.** Codex closeout audit returned *needs patch*: `src/cli.ts` derived **one** global color decision from `process.stdout.isTTY` and reused that palette for stderr errors, so when stdout is a TTY but stderr is redirected, the `[blackbox error]` prefix would emit ANSI bytes onto the redirected stderr.
- **Fix (no behavior change).** The color gate is now computed **once per output stream** at the CLI boundary: `stdoutColorOn = colorEnabled({ isTTY: Boolean(process.stdout.isTTY), env: process.env })` governs every `console.log` render (the stdout palette `c` + `header`/`section`/`kv`/`verdict`), and an independent `stderrColorOn = colorEnabled({ isTTY: Boolean(process.stderr.isTTY), env: process.env })` governs a new stderr palette `cErr` used **only** by `console.error` / `die()` / the top-level error handler. So a redirected stderr stays escape-free even when stdout is an interactive color TTY (and vice versa). `NO_COLOR`/`CI` presence semantics are preserved on both streams.
- **New rendering seam.** `src/render/termStyle.ts` gains one pure helper `errorPrefix(palette): string` (renders `[blackbox error]` bold-red when its palette has color on) — the single seam for the three stderr error sites, built from `cErr`. The glyph-policy comment/docstrings now clarify the header's middle dot `·` is **punctuation** (a separator), not one of the five decorative glyphs (`✓ ✗ → ▸ ◼`); no emoji/mascot/box-drawing/timeline reaffirmed.
- **Tests (+8, 481 → 489).** `tests/termStyle.test.ts` adds an `errorPrefix` + per-stream block that proves the split conceptually equal to the blocker — stdout TTY color-on + stderr non-TTY → the error prefix is escape-free, **and would have carried ANSI under the old global gate** (regression guard) — plus the inverse split and a `·`-is-punctuation assertion. `tests/cliNoAnsi.test.ts` adds CI-present stderr-specific cases (unknown-subcommand and `die()` paths) while keeping the non-TTY stdout/stderr guards. No `process.env` mutation; no literal ESC byte.
- **Manual reproduction.** With `process.stdout.isTTY` forced true and `process.stderr.isTTY` false (`NO_COLOR`/`CI` unset), the redirected stderr for `cli badcmd` contains **zero `1b 5b` bytes** (`od -An -tx1` shows it begins with `5b` = `[`); the inverse (stderr forced TTY) shows the prefix correctly colored, confirming the stderr gate governs it.
- **Verification (unchanged frozen surface).** `npm test -- --run` **489/489**; `npm run cli -- check` PASS (exit 0), stdout byte-identical run-to-run (matches the committed AFTER capture); `npm run fixtures:generate` corpus in sync; `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard; `git diff --check` clean; `git diff --name-only HEAD` on `scripts/generateFixtures.ts fixtures package.json package-lock.json .gitignore`, on `src/trace/hash.ts src/fork/forkRun.ts src/replay/CassetteReplay.ts src/workflow/selfCheck.ts`, and on `src/fork/diffTraces.ts src/fork/diffOutcome.ts src/trace/verifyExplain.ts src/trace/stepLabels.ts` all empty. The only source files touched by the patch are `src/cli.ts` (two decisions + `cErr` + `errorPrefix` at the three stderr sites) and `src/render/termStyle.ts` (the `errorPrefix` helper + comments). Amended into the W8-A implementation commit.

### 2026-07-08 — W8-B: README hero polish (docs/assets-only)
- Phase: Presentation/docs — README hero asset. Plan: `docs/28_week_eight_b_plan.md`. Intended tag `week-eight-readme-hero`.
- Files: **added** `docs/28_week_eight_b_plan.md`, `assets/brand/blackbox-readme-hero.svg`; **edited** `README.md` (embed hero + advance Status wording so W8-A reads pushed/tagged and W8-B is the current in-closeout slice), `docs/08_build_log.md` (this entry), `CLAUDE.md` / `AGENTS.md` (current-state pointers only).
- Outcome: **Pass.**
- What it is: a hand-authored, static SVG (`viewBox="0 0 1600 800"`, single full-bleed `#0d1117` rect with `rx="12"`, system monospace stack, `<title>`/`<desc>`) that renders the real `npm run cli -- check` output as **actual SVG text** — no raster, no AI-generated text, no external font/image/script/style, no base64. One `<text>` per visible line with `xml:space="preserve"`; `<tspan>` only for color splits. Palette is exactly four inks + background: base `#c9d1d9`, dim `#6e7681`, cyan `#56d4dd` (only the banner word `check`), green `#3fb950` (only `✓` and `PASS`); `blackbox` is base color at `font-weight="700"` (bolder, not a fifth hue). Glyphs limited to `◼ ✓ →`-family + `·` punctuation.
- Provenance (Codex correction): the CLI-derived lines (marked `data-source="cli-check"`, including the two blank lines as empty `<text>` elements) were transcribed from a live `npx tsx src/cli.ts check` and are verified **byte-for-byte** against live stdout; the two footer lines (marked `data-source="footer"` — `Local, offline, deterministic.` and the ASCII `record -> replay -> … -> check`) are verified **separately** against a fixed expected pair, not against CLI output.
- Verification: `git diff --name-only` shows only the six allowlisted files. The Node SVG-vs-CLI check reports `SVG CLI text matches live check output; footer verified.` `check` stdout byte-identical run-to-run (empty `diff`). `npm test -- --run` **489/489**, zero live calls. `npm run fixtures:generate` corpus in sync (5 fixtures match). `git ls-files traces` empty. `git diff --check` clean. `git diff --name-only HEAD -- src tests fixtures scripts package.json package-lock.json .gitignore DEMO.md` empty. Self-contained audit: the only `http` match is the mandatory root SVG namespace `xmlns="http://www.w3.org/2000/svg"` (a namespace identifier, never dereferenced — required for the image to render on GitHub); no `href`, `@font-face`, `<script>`, `<image>`, or `base64`.
- Guardrails held: docs/assets only — **no** `src/`, `tests/`, `fixtures/`, `scripts/`, `package.json`, `package-lock.json`, `.gitignore`, or `DEMO.md` change; no CLI behavior/command/flag/exit-code change; no new dependency; no mascot/cassette/logo system, sparkle, dashboard, browser chrome, or contact sheet; no divider added (deliberately deferred).

### 2026-07-08 — W9-A: cassette CI harness (`assert`)
- Phase: Product surface — one new CLI command. Plan: `docs/29_week_nine_a_plan.md`. Intended tag `week-nine-cassette-assert`.
- Files: **added** `docs/29_week_nine_a_plan.md`, `src/workflow/assertCassette.ts`, `tests/assertCassette.test.ts`, `tests/cliAssert.test.ts`; **edited** `src/cli.ts` (add-only: `runAssert` + flag constants + one usage line + one dispatch case + `assert` in the unknown-subcommand valid list), `tests/cliNoAnsi.test.ts` (assert pass/fail/bad-flag + CI-present cases), `README.md`, `DEMO.md`, `docs/08_build_log.md` (this entry), `CLAUDE.md` / `AGENTS.md` (current-state pointers).
- Outcome: **Pass.**
- What it is: `npm run cli -- assert --trace <path> [expectation flags]` turns a committed cassette into a deterministic offline PASS/FAIL CI regression test. It composes the existing `verifyTrace` invariants with exact-match expectations over the replayed terminal outcome (`terminalOutcome`) and tool-call sequence (`toolCallSequence`). Flags: `--trace` (required, unlike `verify`), `--expect-status <success|error|incomplete>` (enum-validated), `--expect-final-answer`, `--expect-failure-reason`, `--expect-tools` (comma-split, trimmed, ordered; `""` ⇒ `[]`). Exit 0 only when verification and every supplied expectation pass; exit 1 on invariant failure, expectation failure, load/JSON/version failure, missing `--trace`, bad enum, unknown flag, or missing flag value.
- Design: pure module `src/workflow/assertCassette.ts` (`assertCassette` / `assertCassetteFile` + `AssertExpectations` / `AssertCheck` / `AssertReport`). `verify ⊂ assert`: invariants gate expectations — on invariant failure the supplied expectation checks become `skip` (never a silent pass), and the outcome/tool reads are not consulted. `assertCassetteFile` mirrors `verifyTraceFile`'s honest-fail contract (load failure ⇒ FAIL report, no throw) by delegating the load-failure verdict to `verifyTraceFile`. Expectations come from CLI flags only — never the cassette, never a sidecar file. Exact string / exact ordered comparison only (no fuzzy/semantic matching, per W7-B). Rendering reuses the W8-A helpers (`header` / `kv` / `verdict` / `section`) and the `verify` invariant-row shape for the expectations table; on verify failure it reuses `formatVerifyFailure`, on expectation failure a local `check:`/`expected:`/`actual:`/`action:` block. No `termStyle` change, no new glyph or color.
- Verification: `npm test -- --run` **522/522** (489 baseline + 33 new), zero live calls, no API key. `npx tsx src/cli.ts check` PASS (exit 0), stdout **byte-identical run-to-run**. `npm run fixtures:generate` corpus in sync (5 fixtures match). `assert` exit codes confirmed 0 on the three documented fixture pass paths and 1 on wrong expectation / missing `--trace` / bad enum / unknown flag / missing file. `git ls-files traces` empty; `git diff --name-only HEAD -- fixtures scripts package.json package-lock.json .gitignore assets/brand docs/11_cli_spec.md` empty; `git diff --check` clean.
- Guardrails held: no schema / `hash.ts` / canonical-hash / `verifyTrace` / `verifyTraceFile` / `terminalOutcome` / `toolCallSequence` / `replayTrace` / `forkRun` / `runSelfCheck` / `diffTraces` / `diffOutcome` / `termStyle` / frozen-formatter change; no fixture rewrite; no `package.json` / `scripts/` / `.gitignore` / `assets/brand/` change; `docs/11_cli_spec.md` (historical W3-A spec) left untouched by design; no new dependency; every other command's output including `check` byte-identical; no dashboard/backend/observability expansion. CLI is now **nine commands** (record, replay, fork, diff, verify, assert, check, list, inspect).

### 2026-07-08 — W9-B: public-readiness refresh (docs-only)
- Phase: Documentation — public-readiness refresh after W9-A closed. Plan: `docs/30_week_nine_b_plan.md`. Tag policy: may be tagged `week-nine-public-readiness` after closeout (no commit or tag created by this slice).
- Files: **added** `docs/30_week_nine_b_plan.md`; **edited** `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/08_build_log.md` (this entry).
- What it is: a docs-only pass so the repo reads correctly to a stranger/reviewer now that W9-A is complete and tagged (`week-nine-cassette-assert`). Completed edits: (1) `README.md` — Status rewritten in concise, durable public language (local deterministic time-travel debugger; schema v2; 522/522 offline tests; cassette assertions complete; most recent technical milestone: cassette assertions, `week-nine-cassette-assert`) — no W-code soup, no "latest tag" pointer, no "in closeout" / "intended tag" wording; one new capability bullet under "What Blackbox is" (a committed cassette → deterministic offline CI regression test using exact expectations, fully offline); build history extended with **W8-B** (`week-eight-readme-hero`) and **W9-A** (`week-nine-cassette-assert`) in the established format. The hero, the core-loop string, and `assert`'s position **outside** the core loop are unchanged. (2) `CLAUDE.md` / `AGENTS.md` — current-state pointers refreshed: W9-A complete and tagged; W9-B docs-only public-readiness refresh; next task re-pointed to Codex closeout audit → commit → push → tag `week-nine-public-readiness`. Product guardrails, invariants, and historical entries preserved verbatim.
- Durable wording: no "W9-B in closeout" / "W9-B implemented / in closeout" / "intended tag" public-state pointer introduced; `week-nine-cassette-assert` is described as the most recent technical milestone, not called "the latest tag" in README Status (so the wording stays true after `week-nine-public-readiness` lands). W9-B is deliberately **not** added to the README build history (no uncreated commit/tag claimed).
- Outcome: **Pass (docs-only; test total unchanged).** `npm test -- --run` still **522/522**, zero live calls, no API key. `npx tsx src/cli.ts check` PASS, stdout/stderr byte-identical run-to-run. `npm run fixtures:generate` (check mode) corpus in sync (5 fixtures match). `git ls-files traces` empty. `git diff --check` clean. `git diff --name-only HEAD -- DEMO.md src tests fixtures scripts package.json package-lock.json .gitignore assets/brand docs/11_cli_spec.md` empty. `git diff --name-only` shows only the allowed docs (`README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/30_week_nine_b_plan.md`, `docs/08_build_log.md`). `CURRENT_TRACE_VERSION` unchanged (schema v2). Historical test counts inside prior milestone entries preserved.
- Guardrails held: documentation only — no change to any file under `src/`, `tests/`, `scripts/`, `fixtures/`, or `assets/brand/`, and no change to `package.json`, `package-lock.json`, `.gitignore`, `DEMO.md`, or `docs/11_cli_spec.md`. No runtime/CLI/provider behavior change; no live call; no new dependency; no new command/flag/exit code. No UI/backend/dashboard/observability positioning introduced; no production-readiness or shipped-SDK/package claim. `assert` remains outside the core loop.
- Post-tag state-pointer patch (`CLAUDE.md` / `AGENTS.md` only): W9-B was intentionally committed and tagged (`week-nine-public-readiness`) before the Codex closeout audit finished; the audit passed scope/content/runtime and found only stale state wording (`CLAUDE.md` still said W9-B in progress with a commit → push → tag next task; `AGENTS.md` still said it "may be tagged after closeout"). Patched both to read W9-B **complete and tagged**, removed the stale in-progress / closeout-tagging next step, and set the next safest task to "pause and plan the next milestone; no W10 implementation without plan + Codex audit." No runtime or README/DEMO front-door behavior changed; test total unchanged at **522/522**.

### 2026-07-08 — W10-A: foreign transcript adapter proof
- Phase: Adapter-boundary proof — ingest an externally-shaped agent run into the core trace model. Plan: `docs/31_week_ten_a_plan.md`. Intended tag `week-ten-foreign-transcript-adapter`.
- Files: **added** `src/ingest/foreignTranscript.ts`, `fixtures/external/chat-tool-use.foreign.json`, `fixtures/external/chat-tool-use.converted.v2.json`, `tests/foreignTranscript.test.ts`, `docs/31_week_ten_a_plan.md`; **edited** `README.md` (new "Adapt a foreign transcript" section), `docs/08_build_log.md` (this entry), `CLAUDE.md` / `AGENTS.md` (current-state pointers).
- Outcome: **Pass.**
- What it is: a pure, synchronous, dependency-free adapter `adaptForeignTranscript(input, { traceId })` that converts a synthetic, chat-style external transcript into a normal Blackbox v2 `Trace` by **composing** the untouched `TraceRecorder` + `toolCallIdForIndex` (id/index/prevHash/hash/schema inherited, not re-implemented). No filesystem/network/clock (`Date.now`)/environment/model/tool access; `createdAt` and every step timestamp come only from source timestamps. Strict sequential state machine — initial user message → loop of `assistant (exactly one tool call)` → matching `tool result` → terminal `assistant final text` — emitting the exact `agentLoop` grammar; for a two-tool run the 11-step sequence `model_input, model_output, tool_call, tool_result, model_input, model_output, tool_call, tool_result, model_input, model_output, metadata`. Foreign tool declarations are allowlist-mapped (`function.name`→name, `function.description`→description, `function.parameters`→inputSchema); foreign tool-call ids are remapped to deterministic `call-0`/`call-1`; payloads are built field-by-field (foreign objects are deep-validated/cloned via a local JSON-safe walker, never spread). Deterministic `ForeignTranscriptError` for missing/malformed/decreasing timestamps, unsupported role, missing initial user message, parallel tool calls, mixed final-text+tool-call, invalid-JSON arguments, duplicate foreign call id, unknown `tool_call_id`, dangling tool call, and missing final message.
- Provenance / neutrality: the synthetic source `fixtures/external/chat-tool-use.foreign.json` deliberately carries provider-like noise sentinels (`usage`, `finish_reason`, `model`, `msg_*` ids, foreign call ids `call_a1B2c3`/`call_d4E5f6`, `conversation_id`, `system_fingerprint`, `_provider_meta`); the committed golden `fixtures/external/chat-tool-use.converted.v2.json` (trace id `external-chat-tool-use`, frozen final-step hash `e3837b69…`) contains **none** of them (verified by grep + `auditTraceNeutrality` + a `NEUTRALITY_FORBIDDEN` scan in the test). The golden was generated deliberately during implementation and committed as a normal fixture; the test only READS it and compares byte-for-byte to the in-memory conversion.
- Verification: `npm test -- --run` **559/559** (522 baseline + 37 new), zero live calls, no API key. Optional `npx tsc --noEmit` remains red on pre-existing project-wide diagnostics outside W10-A; no diagnostic references `src/ingest/foreignTranscript.ts`. W10-A does not claim the full bare typecheck passes and does not change TypeScript configuration or dependencies. `npx tsx src/cli.ts check` PASS (exit 0), stdout byte-identical run-to-run. `npm run fixtures:generate` corpus in sync (5 `fixtures/traces/` fixtures unchanged). `verify`/`replay`/`assert` against the converted cassette exit 0; wrong `--expect-tools` exits 1. `CURRENT_TRACE_VERSION` still 2. `git ls-files traces` empty. `git diff --name-only HEAD -- DEMO.md src/trace src/replay src/fork src/agent src/workflow src/render src/cli.ts fixtures/traces scripts tests/fixtures.test.ts package.json package-lock.json .gitignore assets/brand docs/11_cli_spec.md` empty. `git diff --check` clean.
- Guardrails held: additive adapter boundary only — no schema / `hash.ts` / canonical-hash / `validateTrace` / `replayTrace` / `verifyTrace` / `assertCassette` / `terminalOutcome` / `toolCallSequence` / `forkRun` / `diffTraces` / `termStyle` / `cli.ts` / generator / `fixtures/traces/` change; no new CLI command or flag; no new dependency, npm script, or `package.json`/`package-lock.json`/`.gitignore` change; no `DEMO.md`, `docs/11_cli_spec.md`, or `assets/brand/` change; no live call, SDK, LangChain, MCP, or OpenAI integration claim; no dashboard/observability/backend/UI. `assert` remains outside the core loop; the README hero is unchanged.

### 2026-07-08 — W11-A: fork foreign cassette proof (tests + docs only)
- Phase: Active-loop proof over the W10-A foreign-origin cassette. Plan: `docs/32_week_eleven_a_plan.md`. Intended tag `week-eleven-foreign-fork-proof`.
- Files: **added** `tests/foreignFork.test.ts`, `docs/32_week_eleven_a_plan.md`; **edited** `README.md` (fork/verify/diff/assert reviewer commands appended to the "Adapt a foreign transcript" section), `docs/08_build_log.md` (this entry), `CLAUDE.md` / `AGENTS.md` (current-state pointers). **Zero source changes, zero fixture changes.**
- Outcome: **Pass.**
- What it proves: the committed foreign-origin cassette `fixtures/external/chat-tool-use.converted.v2.json` participates in the ACTIVE debugging loop — `fork → mutate → continue → diff` — under the exact same, unchanged Blackbox semantics as a native trace. Primary geometry: mutate the `get_weather` `tool_result` at step 3 (payload `{"city":"Paris","temperature_c":-2,"condition":"Heavy snow"}`), fork at index 4, continue with the **unchanged** `ReactiveDemoModelClient`. Assertions: `prefixLength` 4; child steps 0–2 verbatim hash-identical to the **committed parent bytes**; child step 3 keeps `tool_result`/`call-0`/`get_weather`/parent timestamp while carrying the injected result, a new hash, and `prevHash` = parent step 2's hash; `parentId`/`forkedFromStepId` lineage; parent isolation (deep-copy equality after fork); the continuation `model_input` reconstructs the mutated structured history and — via a test-local `ToolExecutor` lifting `definitions()` from the parent's own step-0 payload, `execute()` throwing and asserted **never called** — records the **foreign** tool definitions; child validates, verifies 4/4, replays to success, passes neutrality; the answer **derives** from the mutation (embeds `get_weather` / `Heavy snow` / `-2`; two mutations → two answers; same mutation → same answer); the stale-`model_input` guard holds (mutate 3, fork 8 → rejected). Behavioral diff: `diffTraces` → shared prefix 3, first divergence 3; `diffOutcome` → both success, `finalAnswerChanged`, `toolSequenceChanged`, parent tools `[get_weather, send_email]` vs child `[get_weather]`. Secondary geometry: mutate `send_email`'s result at step 7, fork at 8 → divergence at 7 over a 7-step identical prefix, reconstruction across both foreign tool rounds, answer changed, tool sequence intact. CLI integration (temp-dir, always explicit `--out`): `fork`/`verify`/`diff`/`assert` on the foreign parent all green (assert exit 0 with `--expect-tools get_weather`, exit 1 with the parent's full sequence); the CLI continuation is **documented demo-harness behavior** — it injects `defaultToolExecutor()`, so the child's continuation `model_input` records the fixture tool definitions (`search`/`calendar`/`booking`), asserted as such; no claim that the CLI preserves foreign tool definitions. `fixtures/external/` asserted to still contain exactly the two committed W10-A files.
- Deliberately not frozen: full child bytes, continuation hashes, child timestamps (continuation steps are stamped at run time); no committed child fixture — the reviewer creates the child live into git-ignored `traces/`.
- Verification: `npm test -- --run` **583/583** (559 baseline + 24 new), zero live calls, no API key. `npx tsx src/cli.ts check` PASS, stdout/stderr byte-identical run-to-run. `npm run fixtures:generate` corpus in sync (5 fixtures). The four README reviewer commands run green (`fork` exit 0 with derived answer; `verify` PASS; `diff` → `index 3` + `Outcome:` final-answer-changed + both tool paths; `assert` PASS). `CURRENT_TRACE_VERSION` still 2. `git ls-files traces` empty; `git ls-files fixtures/external` exactly two; `git diff --name-only HEAD -- src fixtures scripts DEMO.md docs/11_cli_spec.md package.json package-lock.json .gitignore assets/brand` empty; no existing test file edited; `git diff --check` clean.
- Guardrails held: tests + docs only — no change to any file under `src/`, `fixtures/`, or `scripts/`; no new source module, model client, executor in `src/`, CLI command, flag, dependency, or schema/hash/canonicalization change; `ReactiveDemoModelClient`'s rule table untouched; no fixture rewrite; no committed child cassette; no `DEMO.md` / `docs/11_cli_spec.md` / `assets/brand/` change; no live call, framework/SDK/live-ingestion/foreign-tool-execution claim; no dashboard/observability/backend/UI. `assert` and `adaptForeignTranscript` remain outside the core loop; the README hero is unchanged.

### 2026-07-09 — W12-A: reviewer demo path (docs-only reconciliation + curated path)
- Phase: Public-docs reconciliation after W10-A / W11-A + a curated 3–5 minute reviewer path. Plan: `docs/33_week_twelve_a_plan.md`. Tag policy: may be tagged `week-twelve-reviewer-demo-path` after closeout (no commit or tag created by this slice).
- Files: **added** `docs/33_week_twelve_a_plan.md`; **edited** `README.md`, `DEMO.md`, `docs/08_build_log.md` (this entry), `CLAUDE.md` / `AGENTS.md` (current-state pointers). **Zero source / test / fixture / script / package changes.**
- Outcome: **Pass (docs-only; test total unchanged at 583/583).**
- What it is: a docs-only pass making the repo read correctly to a stranger now that W10-A (`week-ten-foreign-transcript-adapter`) and W11-A (`week-eleven-foreign-fork-proof`) are both complete and tagged. Completed edits: (1) `README.md` — "For reviewers" replaced with a curated 3–5 minute path (one-time `npm install`, noted as the only npm-registry/network step, then seven fully offline proof commands: `npm test`, native `check`, committed-cassette `assert`, foreign `verify`, foreign `fork` with explicit `--out traces/chat-tool-use-fork.json`, `diff`, forked-child `assert`) with per-line annotations and one plain real-vs-fake statement (local deterministic fake model, fixture tools, generated git-ignored child, foreign tools never executed, no live provider/network call); Status reconciled to durable wording (583/583, schema v2, most recent technical milestone = foreign-origin cassette active-debugging proof, `week-eleven-foreign-fork-proof`; no "in closeout"/"intended tag"/"latest tag"/W-code soup); one new "What Blackbox is" bullet for foreign-transcript ingest; Build history extended with concise **W10-A** (`week-ten-foreign-transcript-adapter`) and **W11-A** (`week-eleven-foreign-fork-proof`) entries — W12-A itself deliberately **not** added to Build history (no uncreated tag claimed). Hero, core-loop string, and the assert/ingest-outside-the-loop framing unchanged. (2) `DEMO.md` — Prerequisites count `522 → 583`; one concise "Foreign cassette (adapt → fork → diff)" section listing the foreign verify/fork/diff/assert commands and pointing at the README curated path; real-vs-mocked table rows added (adapter synthetic/non-official; foreign-origin fork/diff real under unchanged semantics; CLI continuation = `ReactiveDemoModelClient` + default fixture executor, foreign tools never executed). No existing step body, command, or expected-output block edited; historical 522/559 counts inside milestone-history text preserved. (3) `CLAUDE.md` / `AGENTS.md` — current-state pointers advanced (W11-A complete and tagged; W12-A docs-only reviewer-path slice in closeout; next task Codex closeout audit → commit → push → tag `week-twelve-reviewer-demo-path`).
- Durable wording: no "W12-A in closeout" / "intended tag" public-state pointer introduced into README/DEMO; `week-eleven-foreign-fork-proof` is named as the most recent technical milestone, not "the latest tag"; W12-A is not added to README build history until its tag exists.
- Verification: `npm test -- --run` still **583/583**, zero live calls, no API key. `npx tsx src/cli.ts check` PASS, stdout/stderr byte-identical run-to-run. `npm run fixtures:generate` corpus in sync (5 fixtures). All seven README reviewer commands executed green (`assert` corpus exit 0; foreign `verify` PASS 4/4; foreign `fork` exit 0 with derived answer written to git-ignored `traces/chat-tool-use-fork.json`; `diff` → first divergence at index 3 + `Outcome:` verdict; child `assert` exit 0). `CURRENT_TRACE_VERSION` still 2. `git ls-files traces` empty. `git diff --name-only HEAD -- src tests fixtures scripts package.json package-lock.json .gitignore assets/brand docs/11_cli_spec.md` empty. `git status --short --untracked-files=all` shows exactly the six allowlisted docs; `git diff --name-only` shows the five tracked edits. Historical counts inside prior milestone entries preserved.
- Guardrails held: documentation only — no change to any file under `src/`, `tests/`, `fixtures/`, or `scripts/`, and no change to `package.json`, `package-lock.json`, `.gitignore`, `assets/brand/`, or `docs/11_cli_spec.md`. No new test, npm script, `scripts/` runner, CLI command, flag, or dependency; no source/runtime/CLI behavior change; no schema/hash/canonicalization change. No framework/SDK/live-ingestion/foreign-tool-execution claim; no dashboard/observability/backend/UI. `assert` and `adaptForeignTranscript` remain outside the core loop; the README hero is unchanged.

### 2026-07-09 — W13-A: worked debugging case study (docs-only)
- Phase: Public-docs — one concrete, worked debugging case study closing the audit-flagged "cold reviewer cannot see one specific bug" gap. Plan: `docs/34_week_thirteen_a_plan.md`. Tag policy: may be tagged `week-thirteen-worked-case-study` after closeout (no commit or tag created by this slice).
- Files: **added** `docs/34_week_thirteen_a_plan.md`; **edited** `README.md`, `docs/08_build_log.md` (this entry), `CLAUDE.md` / `AGENTS.md` (current-state pointers). **DEMO.md left untouched.** **Zero source / test / fixture / script / package changes.**
- Outcome: **Pass (docs-only; test total unchanged at 583/583).**
- What it is: one new README section, "Worked example: debugging one bad answer", telling a single bug story over the **native corpus** cassette `fixtures/traces/success-tool-use.v2.json` (deliberately disjoint from the W12-A foreign reviewer path). Story: the recorded run booked a room off a wrong/misleading `search` result at step 3; `replay` shows the bad answer (`Result: Hotel booked for Alice on 2024-03-15 at 14:00.`); `fork --mode tool-result --fork-index 4 --mutation-step 3 --payload-json '{"results":[],"available":false,"message":"No hotels available for that date."}' --out traces/case-study-fix.json` injects the corrected no-availability result; the deterministic `ReactiveDemoModelClient` continuation *derives* a decline instead of a booking; `diff` pins `First divergence at index 3` with the changed `result` value and the behavioral `Outcome:` verdict (same status, final answer changed, tool path `search → calendar → booking` → `search`); `assert --expect-status success --expect-final-answer '<exact derived string>' --expect-tools search` pins the corrected child as a regression gate. All excerpts captured byte-for-byte from real non-TTY runs. Plus a one-sentence "What Blackbox is not" tighten to functional positioning ("Not an agent framework or orchestrator … Blackbox does not run your agent for you … It sits beside frameworks, not in place of them") — no LangGraph/LangChain/MCP support claim.
- Codex correction (planned in): the final `assert` **must** carry `--expect-final-answer` with the exact string derived by the deterministic continuation (`Based on the search result, no options are available: "No hotels available for that date.". I could not complete the booking.`), captured from a real run — status/tools alone would pass without pinning the corrected *answer*, which is the point of the fix. `verify ⊂ assert`, so the assertion also re-proves the child's four invariants.
- Real-vs-fake stated in the section: real record/replay/fork/diff/assert machinery over a committed cassette; deterministic fake model; fixture tool stubs; no live provider/network call; `traces/case-study-fix.json` generated/local/git-ignored; a framing device over a committed cassette, **not** automatic bug-finding.
- Durable wording: the W12-A "For reviewers" block is byte-unchanged; W13-A is **not** added to README Build history before its tag exists; no "in closeout"/"intended tag"/"latest tag" wording in README; current counts read **583**.
- Verification: `npm test -- --run` still **583/583**, zero live calls, no API key. `npx tsx src/cli.ts check` PASS, stdout/stderr byte-identical run-to-run. `npm run fixtures:generate` corpus in sync (5 fixtures). The four case-study commands executed green (`replay` shows the booking answer; `fork` writes the derived decline to git-ignored `traces/case-study-fix.json`; `diff` → first divergence at index 3 + `Outcome:` verdict; `assert` PASS with the exact final-answer expectation). The seven W12-A reviewer commands re-run green (regression). `CURRENT_TRACE_VERSION` still 2. `git ls-files traces` empty. `git diff --name-only HEAD -- src tests fixtures scripts package.json package-lock.json .gitignore assets/brand docs/11_cli_spec.md` empty. `git status --short --untracked-files=all` shows exactly the allowlisted docs (`README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/08_build_log.md` tracked + `docs/34_week_thirteen_a_plan.md` untracked). `git diff --check` clean.
- Guardrails held: documentation only — no change to any file under `src/`, `tests/`, `fixtures/`, or `scripts/`, and no change to `package.json`, `package-lock.json`, `.gitignore`, `assets/brand/`, `docs/11_cli_spec.md`, or `DEMO.md`. No new test, npm script, `scripts/` runner, CLI command, flag, or dependency; no source/runtime/CLI behavior change; no schema/hash/canonicalization change; no fixture rewrite. No framework/SDK/live-ingestion/automatic-bug-finding claim; no LangChain/LangGraph/MCP integration; no dashboard/observability/backend/UI; no package publishing. `assert` and `adaptForeignTranscript` remain outside the core loop; the README hero and the W12-A reviewer block are unchanged.

### 2026-07-09 — W14-A: npm packaging-readiness proof (prepare only, no publish)
- Phase: Packaging readiness — make Blackbox a locally installable CLI without changing runtime semantics and without publishing. Plan: `docs/35_week_fourteen_a_plan.md`. Tag policy: may be tagged `week-fourteen-package-readiness` after closeout (no commit or tag created by this slice). Publish policy: **npm publish remains gated behind a separate, explicit go/no-go**; `"private": true` is retained as the structural guard (`npm pack` works; `npm publish` is refused by npm).
- Files: **added** `bin/blackbox.js`, `LICENSE`, `docs/35_week_fourteen_a_plan.md`; **edited** `package.json`, `package-lock.json`, `README.md`, `docs/08_build_log.md` (this entry), `CLAUDE.md` / `AGENTS.md` (current-state pointers). **Zero `src/` / `tests/` / `fixtures/` / `scripts/` changes.**
- Outcome: **Pass (packaging-readiness only; no source/runtime behavior change).**
- What it is: `package.json` gains package metadata (`name: @ardaulas/blackbox`, `version: 0.1.0`, `description`, `license: MIT`, `repository`, `keywords`, `engines.node: >=18`), a `bin` entry (`blackbox` → `bin/blackbox.js`), and a `files` whitelist (`bin`, `src`, `fixtures`, `README.md`, `LICENSE`); `tsx` is reclassified from `devDependencies` to `dependencies` (already in the lockfile — a reclassification, not a new package) and the lockfile is regenerated; `"private": true` is kept. **`package.json` scripts are byte-identical**, so `npm test` / `npm run cli` behave exactly as before. `bin/blackbox.js` is a thin Node shim (shebang, no CLI logic, prints nothing itself) that runs `src/cli.ts` through the packaged `tsx` — it resolves `src/cli.ts` relative to itself and tsx's bin via `require.resolve("tsx/package.json")`, `spawnSync`s `node` with `stdio: "inherit"`, forwards argv verbatim, and propagates the child exit code exactly (`process.exit(result.status ?? 1)`). No build step, no `dist/`, no tsconfig change, no bundler dependency; `src/` is untouched. `LICENSE` is MIT (© Arda Ulas Ozdemir). README gains one "Run it as a packaged CLI" section describing the **local-tarball** flow (`npm pack` → install the `.tgz` in a temp dir → `npx blackbox check`), explicitly **not published to npm** (no `npm install @ardaulas/blackbox` / registry-`npx` claim); the "What Blackbox is not" package bullet is refined to "Not yet npm-published — packaging is prepared and verified from a local tarball; publishing is a separate, explicit step."
- Verification: `npm test -- --run` **583/583**, zero live calls, no API key. `npm run fixtures:generate` corpus in sync (5 fixtures). `npx tsx src/cli.ts check` PASS, stdout/stderr byte-identical run-to-run. `npm pack --dry-run` lists exactly the whitelist (`bin/`, `src/`, `fixtures/`, `README.md`, `LICENSE`, `package.json` — no `tests/`, `docs/`, `scripts/`, `assets/brand/`, `traces/`). From a fresh `mktemp -d` project, installing `ardaulas-blackbox-0.1.0.tgz` yields a working `blackbox`: bare `blackbox` prints usage (exit 0); packaged `blackbox check` is **byte-identical** to repo `npx tsx src/cli.ts check` (exit 0); `record → replay → fork (prompt mode) → diff → verify → assert` all run fully offline (exit 0); a deliberately failing `assert --expect-status error` exits **1**; an unknown command exits **1**. The tarball and temp dir were removed after the proof (no artifact committed). `package.json` scripts confirmed byte-identical (`JSON.stringify(before.scripts) === JSON.stringify(after.scripts)`); `private: true` retained. `git ls-files traces` empty. `git diff --name-only HEAD -- src tests fixtures scripts .gitignore assets/brand docs/11_cli_spec.md DEMO.md` empty. `git diff --check` clean. `CURRENT_TRACE_VERSION` still 2.
- Guardrails held: packaging metadata + one bin shim + one license + narrow docs only — no change to any file under `src/`, `tests/`, `fixtures/`, or `scripts/`; no `package.json` script change; no schema / hash / replay / fork / diff / verify / assert behavior change; no new test, CLI command, or CLI flag; no `dist/`, build step, tsconfig change, or bundler dependency; no `.gitignore` / `assets/brand/` / `docs/11_cli_spec.md` / `DEMO.md` change; no dashboard/UI, hosted backend, real model integration, or LangChain/LangGraph/MCP integration; no SDK/framework claim; **no npm publish** (`private: true` retained; publish is a separate go/no-go); W14-A not added to README Build history pre-tag; current counts read 583; the README hero, the W12-A reviewer block, and the W13-A case study are unchanged.
