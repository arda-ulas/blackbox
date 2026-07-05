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
