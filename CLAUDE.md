# Blackbox — Claude Code Project Memory

## Project

Blackbox is a time-travel debugger for AI agents.

It records multi-step model/tool runs, replays them offline from cassette, forks from a supported non-terminal step, mutates a prompt or tool result, and diffs the resulting execution histories.

## Current State

**0.2.1 adds worked examples to 0.2.0, the first release you can point at your own agent.** The engine milestones
before it are closed and tagged (`week-one-cli-proof` … `week-fourteen-package-readiness`), with their plans in
`docs/history/`.

- **Core loop:** `record → replay → fork → mutate → continue → diff → verify → check`, plus `assert` for CI and
  `import` for Claude Code sessions / chat JSON.
- **Your own agent:** `blackbox()` session (`src/session/`) plugged into the official Anthropic / OpenAI Node SDK
  through its `fetch` option; wrapped tools via `bb.tools({...})`; CLI launcher `blackbox record|replay|fork ... -- <command>`.
- **Tests:** 717 passing, fully offline, zero live calls, no API key.
- **Packaging:** `@ardaulas/blackbox` 0.2.1, compiled to `dist/`, no runtime dependencies, Node 22+. `npm publish`
  is run by the owner (credentials never handled by an agent).
- **Docs:** VitePress site from `docs/` (history excluded), deployed to GitHub Pages by `.github/workflows/docs.yml`.

## Hard Guardrails

These hold on every release unless a plan explicitly scoped and audited changes them:

- **No UI / backend / dashboard.** No web UI, hosted backend, remote storage, auth, sharing, or observability platform.
- **Blackbox never makes a provider call of its own.** It never constructs a provider client. Live calls happen only in
  the user's agent, through the user's client, under `blackbox record` or `blackbox fork --live`.
- **No live tests in `npm test` or CI.** Live proofs (`npm run proof:anthropic|openai`) are run by hand.
- **Replay never calls the model, provider, or tools.** `replayTrace(trace)` takes only a `Trace`; session replay
  answers from the cassette and never runs wrapped tools. The analysis seam's imports are checked by
  `tests/importBoundary.test.ts`.
- **`traces/` is git-ignored; no user traces are committed** (the committed fixtures live in `fixtures/`).
- **API keys / raw provider objects never enter traces, logs, or disk** (see `AGENTS.md` invariants).
- **No AI attribution** in commits (no `Co-Authored-By` trailers), PR descriptions, or product copy.

## Agent Workflow

- **Claude Code (Sonnet/Opus):** patches docs, plans, or small implementation slices — only when prompted, and only within the current scope.
- **Codex:** repo-aware audit before any push or tag, and before risky transitions.
- **Sequencing:** plan → Codex audit of the plan → implement in commit-sized slices with tests → Codex audit of the diff → release. The npm publish itself is the owner's step.

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

After 0.2.0 ships, the roadmap in `CHANGELOG.md` ("Planned") is the order of work: streaming support first, then the
OpenAI Responses API, then a GitHub Action that runs `blackbox assert`. Each starts as a scoped plan that Codex
audits before implementation. Do not add a dashboard, hosted service, or framework integration without such a plan.

## Response Format

When making changes, always summarize:

1. Files changed
2. What is real (live code paths)
3. What is mocked (fixtures, fakes, stubs)
4. Whether tests pass
5. Next safest task
