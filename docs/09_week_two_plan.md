# Week Two Plan

## Goal

Harden the week-one CLI proof into a robust local debugger that supports tool-result mutation alongside prompt mutation, has a versioned cassette schema, and ships richer demo traces that exercise more of the core loop.

Everything stays CLI/local. No UI, no backend, no hosted anything.

---

## Non-Goals

- Web UI, dashboard, or graph view of any kind
- LangChain, MCP, or any agent framework integration
- Real model API calls (keep `FakeDeterministicModelClient`)
- Real external tool calls (keep deterministic fixture tools)
- Auth, sharing, hosted backend
- OTEL export or production observability SDK
- Multi-agent orchestration

---

## Proposed Phases

### Phase W2-A: Cassette schema versioning

Add a `version` field to `Trace`. `loadTrace` is the deserialization gate and rejects cassettes whose version is absent or unsupported. `validateTrace` is unchanged — it focuses on hash-chain and canonical integrity only.

**Implemented as:** `loadTrace` rejects missing or unsupported versions; `validateTrace` does not check version.

Files touched:
- `src/trace/TraceTypes.ts` — add `CURRENT_TRACE_VERSION = 1` and `version: number` to `Trace`
- `src/trace/TraceRecorder.ts` — write `version` in `getTrace()`
- `src/replay/CassetteReplay.ts` — version gate in `loadTrace` only
- `tests/replay.test.ts` — version round-trip, missing-version rejection, unsupported-version rejection

### Phase W2-B: Tool-result mutation

Extend `forkRun` to accept an optional `toolResultMutations` map: `{ [stepIndex]: JsonValue }`. When replaying the prefix up to `forkIndex`, if a `tool_result` step index is in the map, inject the replacement value instead of carrying the original payload forward. The agent loop then continues from that point with the mutated tool result visible in its message history.

Files to touch:
- `src/fork/forkRun.ts` — extend `ForkOptions`, add mutation-aware prefix replay
- `tests/fork.test.ts` — add tool-result mutation tests

This is the highest-value addition: prompt mutation only covers "what if I asked differently?" Tool-result mutation covers "what if the tool had returned something different?" — the more interesting debugging question.

### Phase W2-C: Clarify and test fork continuation semantics

Define explicit rules for forking at non-`model_input` steps (e.g., forking at a `tool_result`) and document the chosen behavior. Add at least two tests that fork at a step type other than `model_input`.

Files to touch:
- `docs/03_trace_schema.md` — document fork-point semantics by step type
- `src/fork/forkRun.ts` — guard or handle non-`model_input` fork points
- `tests/fork.test.ts` — add non-`model_input` fork tests

### Phase W2-D: Richer demo traces

Replace the single `example:record` trace with at least two named demo runs:
1. A success path with multiple tool rounds (the existing run is fine, keep it)
2. An error path: a run that hits max steps or encounters an unknown tool
3. A branching demo: `example:fork` that produces a tool-result mutation, not just a prompt mutation

Update `example:fork` to exercise tool-result mutation if Phase W2-B is done.

Files to touch:
- `src/examples/record.ts` (possibly split into multiple scripts or add a second demo)
- `src/examples/fork.ts` — update to use tool-result mutation
- `tests/examples.test.ts` — cover the error-path demo

---

## Acceptance Criteria

- `npm test` still passes (no regressions)
- `loadTrace` rejects a cassette with no `version` field or an unknown version (`validateTrace` checks hash-chain integrity only)
- `forkRun` accepts a `toolResultMutations` option and produces a child trace where the injected value is visible in subsequent model inputs
- At least one test forks at a `tool_result` step
- All three example scripts still run cleanly end-to-end
- `example:fork` demonstrates tool-result mutation in its terminal output

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Tool-result mutation complicates the `loadPrefix` flow significantly | Medium | Keep mutation-aware replay separate from the verbatim-copy path; don't change `loadPrefix` |
| Schema versioning is a breaking change for existing cassette files | High | Pin `CURRENT_VERSION = 1`; existing files without `version` are rejected with a clear error message |
| Forking at non-`model_input` steps has unclear semantics | Medium | Document the chosen behavior first (Phase W2-C docs step), then implement and test |
| Richer demo traces make `FakeDeterministicModelClient` scripts harder to read | Low | Keep scripted responses in named constants with comments |

---

## Recommended Order of Implementation

1. **W2-A first** (schema versioning) — small, contained, no new concepts; breaks nothing if done carefully; produces the version guard needed by everything else
2. **W2-B second** (tool-result mutation) — the highest-value new feature; build on a clean schema
3. **W2-C third** (fork semantics) — clarification work; can overlap with W2-B testing
4. **W2-D last** (demo traces) — depends on W2-B being done so the fork demo is meaningful

Do not start W2-B before W2-A is committed and tests pass.

---

## When to Bring in Codex

- After W2-A is committed: run a Codex audit on the schema versioning contract before building W2-B on top of it
- After W2-B is committed: run a Codex audit on tool-result mutation semantics (are there edge cases the tests miss?)
- Before tagging `week-two-cli-proof`: run a full Codex acceptance audit

---

## What Not to Build Yet

- Any UI (web, Electron, TUI)
- A real `ModelClient` that calls an external API
- Real fixture tools that make network requests
- OTEL/telemetry export
- Cassette sharing or remote storage
- Multi-agent or branching graph visualization
- Semantic diff (diff by intent, not by hash)
- Chaos fork (random mutation injection)
