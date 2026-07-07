# Blackbox — Claude Code Project Memory

## Project

Blackbox is a time-travel debugger for AI agents.

It records multi-step model/tool runs, replays them offline from cassette, forks from any step, mutates a prompt or tool result, and diffs the resulting execution histories.

## Current State

**Post-W6-B. W6-C (release-freeze / docs verification) in progress.** The week-one CLI proof is long complete, the
local loop has been hardened through Week Four, W5-A froze it against a committed regression corpus, W5-B made the
public surface reviewer-ready, and W6-A/W6-B made divergence and verify-failure output legible. W6-C is
documentation / repo-readiness verification only — no source, test, fixture, config, runtime, CLI, or provider
changes.

- **Core loop:** `record → replay → fork → mutate → continue → diff → verify → check`
- **Tests:** 394/394 passing, fully offline, zero live calls.
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
  - `week-six-verify-replay-explanations` (W6-B, current tagged HEAD)
- **In progress:** W6-C release freeze; intended tag `week-six-release-freeze`.

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
- **Sequencing:** W6-C (release-freeze / docs verification) is the current milestone; its plan is scoped and Codex-accepted. Any milestone beyond W6-C is planned and Codex-audited before implementation.

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

Complete W6-C release freeze (verify README/DEMO commands against `package.json`/`src/cli.ts`; reconcile
README/DEMO/AGENTS/CLAUDE/build-log to the true repo state; run the §6-A local checklist) → Codex closeout audit →
push → tag `week-six-release-freeze` (§6-B). No new milestone or product-surface work until it is explicitly scoped
and Codex-audited.

## Response Format

When making changes, always summarize:

1. Files changed
2. What is real (live code paths)
3. What is mocked (fixtures, fakes, stubs)
4. Whether tests pass
5. Next safest task
