# Blackbox — Claude Code Project Memory

## Project

Blackbox is a time-travel debugger for AI agents.

It records multi-step model/tool runs, replays them offline from cassette, forks from any step, mutates a prompt or tool result, and diffs the resulting execution histories.

## Current State

**Post-W4-G. Ready for W5-A planning.** The week-one CLI proof is long complete and the local loop has been hardened through Week Four. Do not start W5-A implementation until it is explicitly scoped and audited.

- **Core loop:** `record → replay → fork → mutate → continue → diff → verify → check`
- **Tests:** 321/321 passing, fully offline, zero live calls.
- **Closed tags (all Week Four work landed):**
  - `week-one-cli-proof`
  - `week-two-core-hardening`
  - `week-three-cli-packaging`
  - `week-four-anthropic-adapter-spike`
  - `week-four-adapter-boundary`
  - `week-four-structured-transcript-migration`
  - `week-four-real-fork-proof`
  - `week-four-cassette-verification`
  - `week-four-fork-verify-workflow` (W4-G, current HEAD)

## Hard Guardrails

These hold on every milestone unless a future milestone is explicitly scoped to change them:

- **No UI / backend / dashboard.** No web UI, React, hosted backend, remote storage, auth, sharing, or observability platform.
- **No Anthropic CLI wiring.** Live provider calls are opt-in, proof-script only — run manually by the human, never from the default CLI or tests.
- **No live tests in `npm test`.** The default suite passes with zero real provider calls and no API key present.
- **No new provider adapter unless explicitly scoped** in a planned milestone.
- **Default CLI and `npm test` are fake/offline.** `FakeDeterministicModelClient` + `defaultFixtureTools()` are the default everywhere.
- **Replay never calls the model, provider, or tools.** `replayTrace(trace)` takes only a `Trace`.
- **`traces/` is git-ignored; no traces are committed.**
- **API keys / raw provider objects never enter traces, logs, or disk** (see `AGENTS.md` invariants).

## Agent Workflow

- **Claude Code (Sonnet/Opus):** patches docs, plans, or small implementation slices — only when prompted, and only within the current scope.
- **Codex:** repo-aware audit before any push or tag, and before risky transitions.
- **Sequencing:** W5-A **planning** is the next allowed step. W5-A **implementation** happens only after the plan is scoped and Codex-audited.

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

Docs cleanup commit → Codex re-audit → W5-A plan. No W5-A implementation until scoped and audited.

## Response Format

When making changes, always summarize:

1. Files changed
2. What is real (live code paths)
3. What is mocked (fixtures, fakes, stubs)
4. Whether tests pass
5. Next safest task
