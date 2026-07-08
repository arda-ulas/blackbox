# Blackbox — Claude Code Project Memory

## Project

Blackbox is a time-travel debugger for AI agents.

It records multi-step model/tool runs, replays them offline from cassette, forks from any step, mutates a prompt or tool result, and diffs the resulting execution histories.

## Current State

**W8-B (README hero polish) pushed and tagged (`week-eight-readme-hero`). W9-A (cassette CI harness) implemented /
in closeout.** The
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
`stepLabels`) are byte-identical. W8-B was a docs/assets-only follow-on (a hand-authored, static SVG README hero at
`assets/brand/blackbox-readme-hero.svg`, rendering the real `check` output as actual SVG text). W9-A adds one new
CLI command, `assert`, a cassette CI harness: `npm run cli -- assert --trace <path> [expectation flags]` turns a
committed cassette into a deterministic offline PASS/FAIL regression test by composing the existing `verifyTrace`
invariants with exact-match expectations over the replayed `terminalOutcome` / `toolCallSequence`. New pure module
`src/workflow/assertCassette.ts` (`assertCassette` / `assertCassetteFile`); `src/cli.ts` gains `runAssert` +
dispatch (add-only). `verify ⊂ assert` (invariants gate expectations → `skip` on invariant failure); expectations
come from CLI flags only (no cassette-embedded, no sidecar); exact match only. No schema / hash / `verifyTrace` /
`terminalOutcome` / `replayTrace` / `forkRun` / `runSelfCheck` / `diffTraces` / `termStyle` / fixture / generator /
`package.json` change; every other command's output including `check` is byte-identical. CLI is now nine commands.

- **Core loop:** `record → replay → fork → mutate → continue → diff → verify → check` (plus the `assert` CI utility)
- **Tests:** 522/522 passing, fully offline, zero live calls.
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
  - `week-eight-readme-hero` (W8-B, current tagged HEAD)
- **In progress:** W9-A cassette CI harness (`assert` command); intended tag `week-nine-cassette-assert`.

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
- **Sequencing:** W8-B (README hero polish) is closed and tagged (`week-eight-readme-hero`); W9-A (cassette CI harness, the `assert` command) is the current slice, its plan (`docs/29_week_nine_a_plan.md`) scoped and Codex-accepted and the slice implemented / in closeout. Any milestone beyond W9-A is planned and Codex-audited before implementation.

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

Close out W9-A (cassette CI harness, the `assert` command): the slice is implemented and green (522/522 offline,
`check` output byte-identical run-to-run, `assert` exit codes 0/1 confirmed against committed fixtures, frozen paths
and every other command's output untouched, no fixture rewrite, no traces committed, no new dependency) → Codex
audit → push → tag `week-nine-cassette-assert`. No new milestone or product-surface work until it is explicitly
scoped and Codex-audited.

## Response Format

When making changes, always summarize:

1. Files changed
2. What is real (live code paths)
3. What is mocked (fixtures, fakes, stubs)
4. Whether tests pass
5. Next safest task
