# Blackbox — Claude Code Project Memory

## Project

Blackbox is a time-travel debugger for AI agents.

It records multi-step model/tool runs, replays them offline from cassette, forks from a supported non-terminal step, mutates a prompt or tool result, and diffs the resulting execution histories.

## Current State

**W14-A (npm packaging-readiness proof) is complete and tagged (`week-fourteen-package-readiness`).** The engine
scope is finished: the full loop was built and hardened across the weekly milestones, frozen against a committed
regression corpus, made reviewer- and public-ready, extended with the `assert` CI utility and the
`adaptForeignTranscript` ingest adapter, proven to fork/diff a foreign-origin cassette under unchanged semantics, and
finally packaged as a local-tarball `blackbox` CLI. The per-week detail lives in the README "Release history" table
and `docs/08_build_log.md`; the durable state is below.

- **Core loop:** `record → replay → fork → mutate → continue → diff → verify → check` (plus the `assert` CI utility and the `adaptForeignTranscript` ingest adapter, both outside the loop)
- **Tests:** 583/583 passing, fully offline, zero live calls.
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
  - `week-six-release-freeze` (W6-C)
  - `week-seven-reactive-fake-model` (W7-A)
  - `week-seven-behavioral-outcome-diff` (W7-B)
  - `week-eight-terminal-polish` (W8-A)
  - `week-eight-readme-hero` (W8-B)
  - `week-nine-cassette-assert` (W9-A)
  - `week-nine-public-readiness` (W9-B public-readiness release tag)
  - `week-ten-foreign-transcript-adapter` (W10-A)
  - `week-eleven-foreign-fork-proof` (W11-A)
  - `week-twelve-reviewer-demo-path` (W12-A)
  - `week-thirteen-worked-case-study` (W13-A)
  - `week-fourteen-package-readiness` (W14-A)
- **Packaging:** installs and runs as a local-tarball `blackbox` CLI, verified offline; **not** npm-published
  (`"private": true` retained; publishing is a separate, explicit go/no-go).

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
- **Sequencing:** every weekly milestone through W14-A (npm packaging-readiness proof, `docs/35_week_fourteen_a_plan.md`) is closed and tagged. The engine scope is finished; the npm publish remains a separate, explicit go/no-go (`"private": true` retained until then). Any further product-surface work is planned and Codex-audited before implementation.

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

The engine is scope-complete and packaged. The default next action is **presentation / portfolio packaging** — making
the public repo, README, DEMO, and docs read cleanly for a cold reviewer — **not** more engine work. Do not add new
engine features, a dashboard/UI/backend/observability surface, or a LangChain/LangGraph/MCP integration unless it is
first scoped in a plan and Codex-audited. The npm publish stays a separate, explicit go/no-go (`"private": true`
retained until then).

## Response Format

When making changes, always summarize:

1. Files changed
2. What is real (live code paths)
3. What is mocked (fixtures, fakes, stubs)
4. Whether tests pass
5. Next safest task
