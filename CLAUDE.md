# Blackbox — Claude Code Project Memory

## Project

Blackbox is a time-travel debugger for AI agents.

It records multi-step model/tool runs, replays them offline from cassette, forks from any step, mutates a prompt or tool result, and diffs the resulting execution histories.

## Current State

**Post-W7-B (behavioral outcome diff, tagged). W8-A (terminal experience polish) implemented / in closeout.** The
week-one CLI proof is long complete, the local loop has been hardened through Week Four, W5-A froze it against a
committed regression corpus, W5-B made the public surface reviewer-ready, W6-A/W6-B made divergence and
verify-failure output legible, W6-C release-froze the repo with truthful docs, W7-A made the offline fork/`check`
continuation derive the child's answer from the mutated `tool_result`, and W7-B added a behavioral `Outcome:` verdict
to `diff`/`fork`. W8-A is a presentation-only slice across the whole CLI: a new pure, dependency-free module
`src/render/termStyle.ts` (`header` / `section` / `kv` / `verdict` / `palette` / `errorPrefix` / `colorEnabled` /
`GLYPH`) supplies one shared terminal grammar, and `src/cli.ts` restyles all eight command surfaces through it
(banners become `◼ blackbox · <command>`, ad-hoc `--- x ---` sub-rules become dimmed section labels, the duplicated
per-command `label()` closures collapse into one aligned `kv`, and PASS/FAIL is emphasized with color and `✓`/`✗`).
Color is gated by `colorEnabled({ isTTY, env })` — on only when `isTTY && !("NO_COLOR" in env) && !("CI" in env)` —
computed **once per output stream** (independent stdout and stderr decisions, so a redirected stderr stays
escape-free even when stdout is a color TTY), so non-TTY / piped / CI output on both streams is escape-free; glyphs
are decorative, text carries the meaning (the header's `·` is punctuation, not a glyph). `check` stdout was re-baselined once, deliberately (before/after in `docs/27_week_eight_a_plan.md` §4.1 and
the build log); its exit code and the `runSelfCheck` return shape are unchanged and its output is byte-identical
run-to-run. No schema / canonical-hash / replay-semantics / `replayTrace`-return / `forkRun` /
`runSelfCheck`-logic / `diffTraces()`-computation / `TraceDiff`-`OutcomeDiff`-`VerifyReport`-shape / provider /
fixture / generator / `package.json` / `package-lock.json` / `.gitignore` change; no new command, flag, or exit code;
no stdout↔stderr movement. The four pure formatters (`formatFirstDivergence`, `formatOutcomeDiff`, `verifyExplain`,
`stepLabels`) are byte-identical.

- **Core loop:** `record → replay → fork → mutate → continue → diff → verify → check`
- **Tests:** 489/489 passing, fully offline, zero live calls.
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
  - `week-seven-behavioral-outcome-diff` (W7-B, current tagged HEAD)
- **In progress:** W8-A terminal experience polish; intended tag `week-eight-terminal-polish`.

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
- **Sequencing:** W8-A (terminal experience polish) is the current milestone; its plan is scoped and Codex-accepted and the slice is implemented / in closeout. Any milestone beyond W8-A is planned and Codex-audited before implementation.

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

Close out W8-A (terminal experience polish): the slice is implemented and green (489/489 offline, `check` output
byte-identical run-to-run, per-stream color gates so non-TTY stdout/stderr are both escape-free, fixtures in sync,
frozen paths untouched; Codex per-stream-stderr closeout patch applied) → Codex re-audit → push → tag
`week-eight-terminal-polish`. No new milestone or product-surface work until it is explicitly scoped and
Codex-audited.

## Response Format

When making changes, always summarize:

1. Files changed
2. What is real (live code paths)
3. What is mocked (fixtures, fakes, stubs)
4. Whether tests pass
5. Next safest task
