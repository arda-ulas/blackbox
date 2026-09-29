# W6-B Plan — Verify / Replay Failure Explanation

**Status:** IMPLEMENTED (in closeout — awaiting Codex closeout audit before tag). This document is preserved as the
accepted plan and historical record; the implementation landed in the slice `feat: explain verify replay failures`,
adding `src/trace/verifyExplain.ts` (new) and `tests/verifyExplain.test.ts` (new), touching `src/cli.ts`
(`runVerify` FAIL footer only), `tests/cli.test.ts`, `DEMO.md`, `docs/08_build_log.md`, and this status header.
Tests: 394/394 offline (381 baseline + 13 new), zero live calls. `verify` PASS output byte-identical; `VerifyReport`
shape, invariant ordering, exit codes, and `replayTrace`'s Trace-only/offline guarantee all unchanged; no
schema/hash/fixture/provider/package/CLI-flag change. The plan body below is unchanged.
**Predecessor:** W6-A complete, pushed, tagged `week-six-diff-inspect-ergonomics` (HEAD `d935a56`). The full core
loop is implemented, hardened, composed under one self-check, proven live (opt-in), frozen against a committed
regression corpus, and documented: `record → replay → fork → mutate → continue → diff → verify → check`. Tests:
381/381 offline, zero live calls.
**Mode:** terminal-output ergonomics only, on the *failure* path of `verify`. **No change to canonical hashing,
trace schema, replay semantics, fixture bytes, provider adapters, or the `VerifyReport` data shape.** No live calls,
no CLI Anthropic wiring, no new provider adapter, no product-surface expansion, no new dependency, no new CLI flag,
command, or exit code.

---

## 1. Problem statement

W6-A made *divergence* legible — when two histories differ, `diff`/`fork` now show the changed value in human
words. The next smallest active-debugging gap is the neighbouring one: when a cassette is *broken* — fails
`verify`, or cannot be replayed offline — the terminal tells the user **that** it failed and **where**, but is thin
on **what invariant broke, in plain terms, and what to do next.**

Today the failure surface is a single footer line appended after the invariant table (`runVerify` in
`src/cli.ts:474-479`):

```
First failing invariant: hash_chain (step 3) — step 3 hash mismatch — stored "…", recomputed "…"
```

The underlying `VerifyReport` is already rich enough to explain the failure well — it just isn't *rendered* that
way. Concretely:

1. **The failed invariant is named but not explained.** `hash_chain`, `provider_neutrality`, `schema_version`,
   `replayability` are the internal invariant identifiers. A first-time user reading `provider_neutrality FAIL`
   does not learn what neutrality *is*, why it matters, or that the fix is "the recorder leaked a raw provider
   field — never commit this cassette." There is no per-invariant, plain-language explanation and no suggested
   next action anywhere in the output.

2. **The diagnostic facts are present but buried in one run-on line.** The step index, the expected-vs-actual hash,
   and the offending provider marker all already live in the report (`VerifyInvariant.stepIndex`, and inside
   `VerifyInvariant.detail` — `checkHashChain` passes through `validateTrace`'s `stored "…", recomputed "…"`
   message; `checkNeutrality` passes through `markers: …`). They are concatenated into one line with em-dashes
   rather than labelled (`invariant:`, `at:`, `detail:`, `action:`), so the most useful facts are the least
   scannable.

3. **Failed offline replay is explained least of all.** When a trace claims success but replay disagrees, or when
   `replayTrace` throws, the `replayability` invariant fails with a terse detail (`trace claims
   run_completed/success but replay status is "incomplete"`, or `replay threw: …`) and no guidance that the
   terminal success marker is not the last step / the trace is truncated / re-record is the fix.

None of these are correctness bugs. `verify` computes the right verdict, fails at the right invariant, localizes to
the right step, and exits non-zero correctly. They are **readability bugs on the failure path** — the exact moment a
debugger most needs the terminal to be clear.

---

## 2. Why W6-B is the next smallest milestone

- **It changes no semantics and no data.** Every invariant check, its ordering, short-circuit behaviour, the
  `VerifyReport` shape (`pass`, `invariants[]`, `firstFailure`), and the exit codes stay byte-for-byte identical.
  Only the *rendering* of already-computed failure facts changes. Like W6-A, this is the lowest-risk category of
  change available.
- **It completes the pair W6-A started.** W6-A made the *success/divergence* readout legible; W6-B makes the
  *failure* readout legible. Together they cover both outcomes of the artifact a human stares at while debugging.
  The failure path is the one currently least served.
- **It is fully testable offline against assets and helpers we already have.** The existing `verifyTrace.test.ts`
  already builds every failure class in-memory (tampered payload/prevHash, index gap, unsupported/missing version,
  legacy v1, malformed JSON, missing file, each neutrality marker, non-terminal success claim). Those same
  builders give W6-B its terminal-output assertions with zero new fixtures and zero live calls.
- **It needs no new surface, flag, dependency, or provider.** It is a pure presentation change at the `verify`
  render site plus one small pure helper — squarely inside the guardrails. Exit codes and allow-lists are
  untouched.
- **Everything larger is out of scope or unscoped.** A second provider adapter, any UI, structured/JSON output
  modes, or a schema change are all excluded or would require their own audited plan. Explaining existing failures
  more clearly is the smallest useful step that moves the product forward without touching any of them.

---

## 3. Design: one pure explainer, rendered at the failure footer

The root cause of gaps (1)–(3) is that the failure footer flattens a structured report into one unlabelled line and
carries no per-invariant guidance. The fix mirrors W6-A: introduce **one** small, pure, presentation-only helper and
have the `verify` render site call it.

### 3.1 New module: `src/trace/verifyExplain.ts` (presentation only)

A pure, dependency-free, disk-free, hash-free module that turns an already-computed failure into human guidance. It
never verifies, never mutates, never touches disk, never re-derives a hash or re-scans a trace — it reads only the
`VerifyReport` facts `verifyTrace` already produced. Proposed surface (final names decided in implementation):

- `suggestedAction(name: VerifyInvariantName): string` — the single source of truth mapping each invariant to a
  plain-language "what broke / what to do" line. Exhaustive over the four invariant names with a `never` guard
  (mirroring the exhaustiveness style already used in `stepLabels.ts`). Initial wording:
  - `schema_version` → *"The cassette is missing a version, unsupported, malformed, or unreadable. Older cassettes
    are not migrated — re-record with `npm run cli -- record`."*
  - `hash_chain` → *"A step's stored hash no longer matches its contents, or the chain links are broken — the
    cassette was edited or corrupted after recording. Do not hand-edit cassettes; re-record to regenerate a valid
    chain."*
  - `provider_neutrality` → *"A provider-native field leaked into the trace (an id prefix, usage/stop metadata, or
    a key). The recorder/adapter boundary let a raw provider object through — never commit this cassette; fix the
    boundary and re-record."*
  - `replayability` → *"The trace does not replay to a consistent verdict — its success marker is not the terminal
    step, or replay could not reconstruct the run (truncated/inconsistent trace). Re-record to produce a
    replayable cassette."*
- `formatVerifyFailure(report: VerifyReport): string[]` — given a FAILing report, produce the labelled failure
  block lines (see §5). It reads `report.firstFailure.{name, detail, stepIndex}` — already populated — and appends
  `suggestedAction(name)`. It performs **no string parsing** of `detail`: the expected/actual hash and the
  offending markers are surfaced by presenting the existing `detail` verbatim under a `detail:` label, not by
  re-extracting them. This keeps the report shape untouched (goal-stated preference: presentation over data-model
  change) and avoids brittle parsing of thrown-error text.

The module is import-only from the CLI render site. It has no other callers and adds no runtime behaviour.

### 3.2 `runVerify` renders the labelled failure block through the helper

`runVerify` in `src/cli.ts` keeps its exact structure: header, `Path`/`Result`, blank line, the per-invariant table
(via the unchanged `verifyLine`), then the failure footer. Only the footer changes — from the single
`First failing invariant: …` line to the multi-line labelled block returned by `formatVerifyFailure` (§5). The
invariant table rows, the PASS path (which prints no footer), and the `process.exit(1)` on FAIL are all unchanged.

### 3.3 Replay failure is explained *through the existing verify path only*

Failed offline replay already flows through `verify`'s `replayability` invariant: `checkReplayability`
(`verifyTrace.ts:104-134`) catches a `replayTrace` throw (→ `replay threw: …`) and detects the
claims-success-but-replay-disagrees case (→ localized to the terminal step). W6-B improves this failure's
explanation **only** via the shared `suggestedAction("replayability")` + labelled footer — i.e. by rendering the
report that already exists. It does **not** add replay-failure handling to the standalone `replay` command's own
output. `runReplay` continues to `loadTrace` + `validateTrace` and let a genuinely unreadable/invalid cassette fall
to the top-level `[blackbox error] …` catch as it does today; touching that path is deferred (it does not flow
through the verify report and would be a separate, wider change).

### 3.4 No new CLI surface, no data-model change (both explicit)

W6-B adds **no** new CLI flag, command, or exit code (no `--verbose`, no `--explain`, no `--json`), and changes **no**
allow-list. It also makes **no** change to the `VerifyReport` / `VerifyInvariant` types, `verifyTrace`,
`verifyTraceFile`, `checkSchemaVersion`, `checkHashChain`, `checkNeutrality`, `checkReplayability`, or their
ordering/short-circuit behaviour. The labelled block is the *only* output change, and it appears *only* on the FAIL
path. Should implementation discover that a genuinely useful label truly requires a structured field the report does
not already carry, the work **stops** and a separate, Codex-audited data-model plan is written — W6-B does not
silently extend the report shape.

### 3.5 `check` is intentionally out of scope

The `check` command has its own stage-based failure footer (`runCheck`, `First failing stage: …`) fed by
`runSelfCheck`, whose stage detail strings differ from the `verify` invariant model. W6-B targets the `verify`
failure surface only. `check` output stays byte-identical; reusing the explainer inside `check` is deferred to a
later plan if wanted.

---

## 4. Exact acceptance criteria

An implementation of W6-B is accepted only if **all** of the following hold:

1. **Verdict logic unchanged.** `verifyTrace`, `verifyTraceFile`, and all four invariant checks are untouched in
   behaviour: same invariant order, same short-circuit-to-`skip`, same `pass` boolean, same `firstFailure`
   selection, same `stepIndex` localization for every case in `verifyTrace.test.ts`. Those existing tests pass
   **unedited**.
2. **Report shape unchanged.** `VerifyReport`, `VerifyInvariant`, `VerifyStatus`, `VerifyInvariantName`,
   `VerifyOptions` are unchanged. No field added, removed, or renamed.
3. **Exit codes unchanged.** `verify` exits `1` on FAIL and `0` on PASS exactly as today; `check` exit behaviour is
   untouched.
4. **PASS output byte-identical.** For a clean cassette, `verify`'s full output (header, table, no footer) is
   unchanged. The PASS block quoted in `DEMO.md` still matches verbatim.
5. **Failure output is more legible, provably.** On the FAIL path, `verify` prints a labelled block that names the
   failed invariant, the step (when `stepIndex` is present), the existing detail, and a plain-language suggested
   action — for each of the four invariant classes. A test asserts, per class, that the rendered failure string
   contains: the invariant name, the step index where applicable, the pre-existing detail substring (e.g.
   `recomputed` for hash_chain, the offending marker for neutrality), and a non-empty action line.
6. **Secrets still never echoed.** A leaked literal key value is still reported as `<api-key-value>` and never
   printed — the explainer only renders `detail`, which already masks it. A test asserts the raw secret does not
   appear in the rendered failure block.
7. **Single explainer, exhaustive.** There is exactly one implementation of the per-invariant action mapping, in
   `src/trace/verifyExplain.ts`, with a `never` exhaustiveness guard over the four invariant names. A unit test
   covers all four plus exhaustiveness.
8. **Replay failure explained via the verify path only.** The `replayability` FAIL (both the throw case and the
   non-terminal-success-claim case) renders the labelled block with its action. The standalone `replay` command's
   output and the `runReplay` code path are unchanged; its assertions pass unedited.
9. **No new CLI surface.** No new flag, command, or exit code; no `--verbose` / `--explain` / `--json`. The
   `src/cli.ts` allow-lists (`VERIFY_ALLOWED`, etc.) are unchanged.
10. **Offline + green.** `npm test -- --run` passes (≥ 381, with the new failure-explanation tests added), zero
    live calls, no API key required. `npm run cli -- check` PASS. `npm run fixtures:generate` check mode in sync.
    `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` still exits at the key guard.
11. **No frozen artifact touched.** No fixture byte changes; no frozen hash constant in `tests/fixtures.test.ts` is
    edited; `git ls-files traces` stays empty. `hash.ts`, `TraceStepHashInput`, `CURRENT_TRACE_VERSION`,
    `Trace`/`TraceStep`/`TraceStepType`, `validateTrace`, `replayTrace`, `forkRun`, and all provider/adapter code
    are untouched.
12. **No new dependency / surface.** `package.json` / `package-lock.json` gain no dependency. No UI, backend,
    dashboard, observability, or Anthropic CLI wiring.
13. **Docs match reality.** `DEMO.md`'s verify "On failure" description is updated to the new labelled block only
    where the real output changed; the PASS block and all commands/flags/paths are unchanged.

---

## 5. Proposed terminal / output changes

**Commands, flags, and exit codes are unchanged.** The single change is the `verify` **FAIL-path footer**, which
moves from one run-on line to a labelled, actionable block. The invariant table and the PASS path are untouched.

Illustrative FAIL output *shape* after W6-B (final wording/glyphs set in implementation) — a tampered-payload
cassette whose step-3 hash no longer matches:

```
[blackbox] --- verify ---
Path:          traces/tampered.json
Result:        FAIL

  schema_version       pass  version 2
  hash_chain           FAIL  [step 3] step 3 hash mismatch — stored "ab12…", recomputed "cd34…"
  provider_neutrality  skip  skipped (earlier invariant failed)
  replayability        skip  skipped (earlier invariant failed)

Failure
  invariant:  hash_chain
  at:         step 3
  detail:     step 3 hash mismatch — stored "ab12…", recomputed "cd34…"
  action:     A step's stored hash no longer matches its contents, or the chain links
              are broken — the cassette was edited or corrupted after recording. Do not
              hand-edit cassettes; re-record to regenerate a valid chain.
```

And a `provider_neutrality` failure:

```
Failure
  invariant:  provider_neutrality
  detail:     markers: toolu_, usage
  action:     A provider-native field leaked into the trace (an id prefix, usage/stop
              metadata, or a key). The recorder/adapter boundary let a raw provider
              object through — never commit this cassette; fix the boundary and
              re-record.
```

The exact label glyphs, indentation, and wrap width are implementation details; the *requirement* is that the
failed invariant is named, the step is shown when known, the pre-existing detail (expected/actual hash, offending
marker, or replay disagreement) is presented under its own label, and a plain-language suggested action is printed.
`inspect`, `replay`, `list`, `record`, `fork`, `diff`, and `check` outputs are unchanged.

---

## 6. Test plan

All offline, fake/deterministic, zero live calls. Reuse the in-memory failure builders already in
`verifyTrace.test.ts`; add no new fixture.

1. **`verifyExplain` unit tests (new).** `suggestedAction` returns a non-empty, distinct action for each of the
   four `VerifyInvariantName` values and is exhaustive (a `never` guard). `formatVerifyFailure` over a synthetic
   FAILing report produces lines containing the invariant name, the step (when `stepIndex` set), the `detail`
   substring, and the action.
2. **Per-invariant failure-render tests (new).** For each failure class — unsupported/missing version, tampered
   hash (step-localized), broken prevHash (step 1), neutrality marker leak, non-terminal success claim
   (replayability) — build the report via the existing helpers, render the footer, and assert the block names the
   invariant, shows the step index where applicable, carries the pre-existing detail marker (`recomputed`,
   `toolu_`, `run_completed`, etc.), and includes a non-empty action.
3. **Secret-masking regression (new).** Render the failure block for the "literal key value leaked" case with an
   `apiKey`; assert the block contains `<api-key-value>` and does **not** contain the raw secret.
4. **PASS-path unchanged (regression).** Assert a clean cassette's `verify` output has no failure block and matches
   the current PASS shape; the existing `verifyTrace.test.ts` PASS assertions remain green unedited.
5. **Verdict-logic unchanged (regression).** The full existing `verifyTrace.test.ts` suite passes **unedited** —
   any needed edit there is a signal the invariant behaviour (not just rendering) was touched and must be reworked.
6. **CLI end-to-end (extend `tests/cli.test.ts`).** Run `verify --trace <bad>` over an in-memory-built broken
   cassette written to a temp file; assert exit code `1`, the labelled block is present, and the action line
   appears. Assert `verify` over a clean cassette still exits `0` with no block. Confirm no new flag is accepted
   (an unknown flag still dies).
7. **Replay-via-verify (new).** For the non-terminal-success and `replay threw` cases, assert the `replayability`
   failure renders its action; separately assert the standalone `replay` command's output is unchanged (its
   existing assertions pass unedited).
8. **Full-loop smoke.** `npm run cli -- check` PASS; `npm run fixtures:generate` check mode in sync;
   `tests/fixtures.test.ts` unmodified and passing.

Target: baseline 381 plus the new failure-explanation tests, all green, zero live calls.

---

## 7. Docs impact

- **`DEMO.md`** — update the verify section's **"On failure"** paragraph (line ~310 today) to reflect the new
  labelled block, and optionally add a short FAIL-output example. The **PASS** block (lines ~299–308) is unchanged
  and must still match verbatim. Commands, flags, file paths, and the invariant list are unchanged.
- **`README.md`** — no change expected. The core-loop verb list and proof tables are unaffected. Touch only if a
  README example literally quotes verify failure output (it does not today).
- **`docs/08_build_log.md`** — append a `2026-… — Week Six W6-B (verify/replay failure explanation)` entry
  following the established What Was Built / Outcome / Guardrails Held structure.
- **`docs/03_trace_schema.md`** — no change (schema untouched; hard requirement).
- **`AGENTS.md` / `CLAUDE.md`** — current-state pointer refresh at closeout only (advance the "current milestone"
  and closed-tag set), consistent with prior milestones; no guardrail or invariant change.

---

## 8. Non-goals (explicit)

- **No UI, backend, dashboard, or observability/metrics surface.**
- **No provider adapter change and no Anthropic CLI wiring.** No live proof run as part of this milestone.
- **No canonical-hash change.** `hash.ts` and `TraceStepHashInput` are off-limits.
- **No trace-schema change.** `CURRENT_TRACE_VERSION`, `Trace`, `TraceStep`, `TraceStepType` are frozen.
- **No `VerifyReport` data-model change.** `VerifyReport`, `VerifyInvariant`, and the invariant checks keep their
  exact shape and behaviour. If legibility genuinely requires a new structured field, the work **stops** and a
  separate, Codex-audited plan is written (see §3.4).
- **No fixture rewrite.** The committed corpus bytes and frozen hashes do not change. New tests build broken traces
  in-memory, as `verifyTrace.test.ts` already does.
- **No new CLI flags, commands, or exit codes.** Specifically **no `--verbose`, `--explain`, or `--json`** and no
  JSON/structured output mode. Exit codes stay `0` PASS / `1` FAIL.
- **No change to PASS output.** Only the FAIL-path footer changes; the success readout is byte-identical.
- **No change to the standalone `replay` command output or `runReplay`.** Replay failure is explained only through
  the existing `verify` `replayability` invariant (see §3.3).
- **No change to `check` output.** The self-check failure footer is out of scope (see §3.5).
- **No new dependency, no production SDK, no npm publish.** No `package.json` / `package-lock.json` change is
  expected.

---

## 9. Rollback plan

- **Isolated blast radius.** Changes are confined to a new presentation module (`src/trace/verifyExplain.ts`), the
  failure-footer lines of `runVerify` in `src/cli.ts`, new tests, and the DEMO/build-log docs. No data-model,
  hashing, invariant-check, replay, fork, or on-disk file is affected.
- **Single-commit revert.** The slice lands as one commit; `git revert <sha>` restores the prior footer verbatim.
  Because no cassette, hash, schema, or report shape changed, revert is total — no regeneration needed.
- **Tripwires.** `tests/fixtures.test.ts` (frozen hashes) and `npm run fixtures:generate` (check mode) fail loudly
  if the change accidentally touches hashing or schema. The unedited `verifyTrace.test.ts` suite fails loudly if
  invariant behaviour drifted rather than only its rendering.
- **No external state.** Nothing is pushed, tagged, deployed, or sent to any provider by this milestone, so
  rollback is purely local.

---

## 10. First implementation prompt

> Implement W6-B (verify/replay failure explanation) exactly as scoped in `docs/23_week_six_b_plan.md`. Presentation
> only — do not touch `src/trace/hash.ts`, `TraceStepHashInput`, `CURRENT_TRACE_VERSION`, `Trace`/`TraceStep`/
> `TraceStepType`, `validateTrace`, `replayTrace`, `forkRun`, any provider/adapter code, any file under `fixtures/`,
> the `VerifyReport`/`VerifyInvariant` types, or the four invariant checks and their ordering/short-circuit logic.
>
> 1. Add `src/trace/verifyExplain.ts`: a pure, disk-free, hash-free module exporting `suggestedAction(name)`
>    (single source of truth for a plain-language action per `VerifyInvariantName`, exhaustive with a `never`
>    guard) and `formatVerifyFailure(report)` (returns the labelled failure-block lines from
>    `report.firstFailure.{name, detail, stepIndex}` + `suggestedAction(name)`). Do **no** parsing of `detail` —
>    present it verbatim under a `detail:` label so the pre-existing expected/actual hash and offending markers are
>    surfaced without re-derivation, and secrets already masked as `<api-key-value>` stay masked.
> 2. In `src/cli.ts`, replace only the `runVerify` FAIL-path footer (the `First failing invariant: …` line) with the
>    block from `formatVerifyFailure`. Leave the header, `Path`/`Result`, the per-invariant table (`verifyLine`),
>    the PASS path (no footer), and `process.exit(1)` unchanged. Do **not** touch `runReplay`, `runCheck`, or any
>    allow-list. **Add no new CLI flag** — no `--verbose`, `--explain`, or `--json`.
> 3. Add offline tests: `verifyExplain` unit + exhaustiveness; per-invariant failure-render tests (version, hash
>    tamper with step index, broken prevHash, neutrality marker, non-terminal success claim) asserting the block
>    names the invariant, shows the step where applicable, carries the pre-existing detail substring, and includes a
>    non-empty action; a secret-masking test asserting `<api-key-value>` shows and the raw secret does not; a
>    PASS-path-unchanged assertion; and a CLI end-to-end `verify` FAIL (exit 1, block present) + PASS (exit 0, no
>    block) case. Keep the existing `verifyTrace.test.ts` and `replay` assertions green **unedited**. Do not edit any
>    frozen hash constant in `tests/fixtures.test.ts`.
> 4. Update `DEMO.md`'s verify "On failure" description to the new labelled block (PASS block unchanged). Append a
>    W6-B build-log entry.
>
> Acceptance gate: `npm test -- --run` green (≥ 381, zero live calls, no key), `npm run cli -- check` PASS,
> `npm run fixtures:generate` check mode in sync, `tests/fixtures.test.ts` and `verifyTrace.test.ts` unmodified and
> passing, `replay` assertions unedited, no new CLI flag added, PASS output byte-identical,
> `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard, `git ls-files traces` empty,
> `package.json` unchanged. Then report: files changed / what is real / what is mocked / tests pass / next safest
> task. Do not push or tag.

---

## 11. Codex audit prompt

> Audit the W6-B plan in `docs/23_week_six_b_plan.md` (and, once implemented, the diff) as a repo-aware reviewer
> before it is accepted for implementation / before tag. Confirm specifically:
>
> 1. **No verdict drift.** `verifyTrace`, `verifyTraceFile`, `checkSchemaVersion`, `checkHashChain`,
>    `checkNeutrality`, `checkReplayability`, their ordering, short-circuit-to-`skip`, `firstFailure` selection, and
>    `stepIndex` localization are all unchanged. Only the FAIL-path rendering moves. `verifyTrace.test.ts` passes
>    unedited.
> 2. **No data-model change.** `VerifyReport`, `VerifyInvariant`, `VerifyStatus`, `VerifyInvariantName`,
>    `VerifyOptions` are unchanged — no field added/removed/renamed.
> 3. **Exit codes unchanged.** `verify` still exits 1 on FAIL / 0 on PASS; `check` untouched.
> 4. **PASS output byte-identical.** A clean cassette's `verify` output (header + table, no footer) is unchanged and
>    the DEMO PASS block still matches.
> 5. **Failure legibility delivered.** For each of the four invariant classes, the FAIL footer names the invariant,
>    shows the step when known, presents the pre-existing detail (expected/actual hash, offending marker, or replay
>    disagreement), and prints a plain-language action — each with a test. Confirm the `replayability` failure is
>    covered via the verify path and the standalone `replay` output is unchanged.
> 6. **Secrets masked.** A leaked literal key still renders as `<api-key-value>`; the raw secret never appears in the
>    block (test asserts it).
> 7. **Single explainer.** Exactly one per-invariant action mapping exists, in `verifyExplain.ts`, exhaustive with a
>    `never` guard.
> 8. **No new CLI surface.** No new flag/command/exit code (no `--verbose`/`--explain`/`--json`); allow-lists
>    unchanged.
> 9. **Guardrails held.** No UI/backend/dashboard/observability, no Anthropic CLI wiring, no live call, no new
>    provider adapter, no new dependency, no schema/hash change, no fixture rewrite, no product-surface expansion.
>    `git ls-files traces` empty; `package.json`/`package-lock.json` unchanged.
> 10. **Docs match reality.** The DEMO verify "On failure" description reflects the new block, the PASS block is
>     unchanged, and the build log has an accurate W6-B entry.
>
> Report any scope creep (especially any touch to invariant behaviour, the `VerifyReport` shape, exit codes,
> `replay` output, or a new CLI flag) as a blocker.
