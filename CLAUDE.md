# Blackbox — Claude Code Project Memory

## Project

Blackbox is a time-travel debugger for AI agents.

It records multi-step model/tool runs, replays them offline from cassette, forks from any step, mutates a prompt or tool result, and diffs the resulting execution histories.

## Current State

**W10-A (foreign transcript adapter proof) is complete and tagged (`week-ten-foreign-transcript-adapter`). W11-A
(fork foreign cassette proof) is implemented / in closeout; intended tag `week-eleven-foreign-fork-proof`.** The
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
W9-B was a documentation-only public-readiness refresh on top of the tagged W9-A: it rewrote the README Status in
durable public language, surfaced the `assert` capability in "What Blackbox is," appended the W8-B/W9-A build-history
entries, and refreshed these current-state pointers. No source / test / fixture / `package.json` / `package-lock.json`
/ `.gitignore` / `DEMO.md` / `docs/11_cli_spec.md` / `assets/brand/` change; no runtime behavior change.

W10-A is an additive adapter-boundary proof (`docs/31_week_ten_a_plan.md`): a new pure, dependency-free module
`src/ingest/foreignTranscript.ts` (`adaptForeignTranscript` / `ForeignTranscriptError`) converts a synthetic,
chat-style external transcript into a normal Blackbox v2 `Trace` by composing the untouched `TraceRecorder` +
`toolCallIdForIndex` (no clock/I/O/network/model/tool; timestamps sourced from the transcript). It emits the exact
`agentLoop` grammar (11 steps for the two-tool proof), remaps foreign tool-call ids to deterministic `call-N`, strips
all provider noise (foreign ids, `usage`, `finish_reason`, model name — none cross into the trace), and rejects
malformed input deterministically. Two committed `fixtures/external/` files (a synthetic source transcript with noise
sentinels + a read-only golden converted cassette) plus `tests/foreignTranscript.test.ts` prove it; the existing
`verify` / `replay` / `assert` surfaces consume the converted cassette **unchanged**. This is an adapter-boundary
proof, **not** a framework/SDK/LangChain/MCP/OpenAI integration and not live ingestion. No schema / hash / `verifyTrace`
/ `replayTrace` / `assertCassette` / `terminalOutcome` / `toolCallSequence` / `forkRun` / `diffTraces` / `cli.ts` /
generator / `fixtures/traces/` / `package.json` change; no new command, flag, or dependency; every other command's
output including `check` is byte-identical. W10-A landed at 559/559 offline (522 + 37 new), zero live calls, and is
closed and tagged.

W11-A (fork foreign cassette proof, `docs/32_week_eleven_a_plan.md`) is a **tests + docs only** slice — zero source
changes, zero fixture changes: one new test file `tests/foreignFork.test.ts` proves the committed foreign-origin
cassette participates in the ACTIVE debugging loop (`fork → mutate → continue → diff`) under the unchanged `forkRun` /
`ReactiveDemoModelClient` / `diffTraces` / `diffOutcome` / CLI surfaces. Primary geometry: mutate the `get_weather`
`tool_result` at step 3, fork at 4 — child shares hash-identical steps 0–2 with the committed parent bytes, diverges
first at 3, verifies 4/4, replays to success, and its answer **derives** from the injected payload (two mutations →
two answers). A test-local `ToolExecutor` lifts the foreign tool definitions from the parent's own step-0 payload
(`execute()` throws, asserted never called); the CLI continuation is documented demo-harness behavior (it records
`defaultToolExecutor()`'s fixture tool definitions — the CLI does not preserve foreign defs). Secondary geometry
(mutate 7, fork 8) and CLI `fork`/`verify`/`diff`/`assert` integration (temp-dir, always explicit `--out`) included.
Nothing frozen beyond the parent's committed bytes + divergence geometry (no child fixture, no continuation-hash or
timestamp freezing). README gains the four fork reviewer commands. No new command, flag, dependency, or schema/hash
change.

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
  - `week-ten-foreign-transcript-adapter` (W10-A, current tagged HEAD)
- **In progress:** W11-A (fork foreign cassette proof, tests + docs only); intended tag `week-eleven-foreign-fork-proof`.

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
- **Sequencing:** W10-A (foreign transcript adapter proof, `docs/31_week_ten_a_plan.md`) is closed and tagged (`week-ten-foreign-transcript-adapter`); W11-A (fork foreign cassette proof, `docs/32_week_eleven_a_plan.md`, tests + docs only) is implemented / in closeout. Any milestone beyond W11-A is planned and Codex-audited before implementation.

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

Close out W11-A (fork foreign cassette proof, `docs/32_week_eleven_a_plan.md`): the tests + docs slice is implemented
and green (583/583 offline, `check` output byte-identical run-to-run, foreign parent forks/mutates/continues/diffs
under unchanged semantics, prefix hash-identical to the committed parent bytes, derived child answer, zero source and
fixture changes, `fixtures/external/` still exactly two files, no child fixture committed, no new dependency) → Codex
closeout audit → commit → push → tag `week-eleven-foreign-fork-proof`. Do not begin W11-B or any further
product-surface work until it is explicitly scoped in a plan and Codex-audited.

## Response Format

When making changes, always summarize:

1. Files changed
2. What is real (live code paths)
3. What is mocked (fixtures, fakes, stubs)
4. Whether tests pass
5. Next safest task
