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
