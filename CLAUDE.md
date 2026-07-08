# Blackbox — Claude Code Project Memory

## Project

Blackbox is a time-travel debugger for AI agents.

It records multi-step model/tool runs, replays them offline from cassette, forks from any step, mutates a prompt or tool result, and diffs the resulting execution histories.

## Current State

**Post-W6-C (release-frozen). W7-A (reactive deterministic fake model) implemented / in closeout.** The week-one
CLI proof is long complete, the local loop has been hardened through Week Four, W5-A froze it against a committed
regression corpus, W5-B made the public surface reviewer-ready, W6-A/W6-B made divergence and verify-failure output
legible, and W6-C release-froze the repo with truthful docs. W7-A closes the demo-credibility gap: the offline
fork/`check` continuation now derives the child's answer from the mutated `tool_result` via a pure, deterministic
`ReactiveDemoModelClient` (no schema/hash/replay/fork-reconstruction/provider/fixture/CLI-surface change; `check`
stdout byte-identical).

- **Core loop:** `record → replay → fork → mutate → continue → diff → verify → check`
- **Tests:** 417/417 passing, fully offline, zero live calls.
- **Closed tags:**
  - `week-one-cli-proof`
  - `week-two-core-hardening`
  - `week-three-cli-packaging`
  - `week-four-anthropic-adapter-spike`
  - `week-four-adapter-boundary`
  - `week-four-structured-transcript-migration`
  - `week-four-real-fork-proof`
  - `week-four-cassette-verification`
  - `week-four-fork-verify-workflow` (W4-G)
  - `week-five-trace-fixture-corpus` (W5-A)
  - `week-five-public-demo-readiness` (W5-B)
  - `week-six-diff-inspect-ergonomics` (W6-A)
  - `week-six-verify-replay-explanations` (W6-B)
  - `week-six-release-freeze` (W6-C, current tagged HEAD)
- **In progress:** W7-A reactive deterministic fake model; intended tag `week-seven-reactive-fake-model`.

## Hard Guardrails

These hold on every milestone unless a future milestone is explicitly scoped to change them:

- **No UI / backend / dashboard.** No web UI, React, hosted backend, remote storage, auth, sharing, or observability platform.
- **No Anthropic CLI wiring.** Live provider calls are opt-in, proof-script only — run manually by the human, never from the default CLI or tests.
- **No live tests in `npm test`.** The default suite passes with zero real provider calls and no API key present.
- **No new provider adapter unless explicitly scoped** in a planned milestone.
- **Default CLI and `npm test` are fake/offline.** Fake/offline deterministic model clients + `defaultFixtureTools()` are the default everywhere: `FakeDeterministicModelClient` (scripted) for record/scripted paths and `ReactiveDemoModelClient` (reactive fork/`check` continuation) — both zero live calls, no key.
- **Replay never calls the model, provider, or tools.** `replayTrace(trace)` takes only a `Trace`.
- **`traces/` is git-ignored; no traces are committed.**
- **API keys / raw provider objects never enter traces, logs, or disk** (see `AGENTS.md` invariants).

## Agent Workflow

- **Claude Code (Sonnet/Opus):** patches docs, plans, or small implementation slices — only when prompted, and only within the current scope.
- **Codex:** repo-aware audit before any push or tag, and before risky transitions.
- **Sequencing:** W7-A (reactive deterministic fake model) is the current milestone; its plan is scoped and Codex-accepted and the slice is implemented / in closeout. Any milestone beyond W7-A is planned and Codex-audited before implementation.

## Core Loop

`record → replay → fork → mutate → continue → diff → verify → check`

## Technical Rules

- Use TypeScript. Do not use agent frameworks.
- Keep modules small and testable.
- Model calls must sit behind an interface (`ModelClient`).
- Replay is cassette playback — do not call the model or execute tools during replay.
- Use canonical serialization (sorted keys, stable JSON) for all hashes.
- Every meaningful behavior must have tests.

## Next Safest Task

Close out W7-A (reactive deterministic fake model): the slice is implemented and green (417/417 offline, `check`
byte-identical, fixtures in sync, frozen paths untouched) → Codex closeout audit → push → tag
`week-seven-reactive-fake-model`. No new milestone or product-surface work until it is explicitly scoped and
Codex-audited.

## Response Format

When making changes, always summarize:

1. Files changed
2. What is real (live code paths)
3. What is mocked (fixtures, fakes, stubs)
4. Whether tests pass
5. Next safest task
