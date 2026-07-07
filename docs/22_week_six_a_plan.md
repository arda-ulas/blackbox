# W6-A Plan — Diff/Inspect Ergonomics

**Status:** PLANNED (awaiting Codex audit before implementation). This document is the plan only; no source, test,
fixture, config, or doc file other than this one is touched by the planning step.
**Predecessor:** W5-B complete, pushed, tagged `week-five-public-demo-readiness`. Full core loop implemented,
hardened, composed under one self-check, proven live (opt-in), frozen against a committed regression corpus, and
documented as a public-facing repo: `record → replay → fork → mutate → continue → diff → verify → check`. Tests:
360/360 offline, zero live calls.
**Mode:** terminal-output ergonomics only. **No change to canonical hashing, trace schema, replay semantics, fork
geometry, or provider adapters.** No live calls, no CLI Anthropic wiring, no new provider adapter, no
product-surface expansion, no new dependency.

> This is the accepted-plan document for W6-A. Implementation, if approved, will land in a single slice under the
> §9 first-implementation prompt. Until then this file stands alone.

---

## 1. Problem statement

The core loop is proven and the repo now reads cleanly to a first-time visitor. The remaining friction is not in
*what* Blackbox does but in *how legibly it explains itself in the terminal* at the two moments a debugger is most
used: looking at a single history (`inspect`) and looking at the first point two histories diverge (`diff`).

Three concrete legibility gaps exist today, all in output formatting only:

1. **`diff` truncates the divergent payload as raw JSON, mid-key.** `formatFirstDivergence`
   (`src/fork/diffTraces.ts`) renders each divergent step through `payloadSummary()`, which does
   `JSON.stringify(payload)` and hard-cuts at 60 characters:

   ```
     parent  tool_result     <hash>  {"toolCallId":"call-0","toolName":"search","result":{"res...
     child   tool_result     <hash>  {"toolName":"search","result":{"results":[],"available":f...
   ```

   The single most important question a diff should answer — *what actually changed at the divergence* — is the
   hardest thing to read. Both lines are truncated before the values differ, so the reader often cannot see the
   difference that the diff exists to surface.

2. **`diff` and `inspect`/`replay` describe the same steps differently.** `inspect` and `replay` render steps
   through `summarizeStep()` (`src/replay/CassetteReplay.ts`) — a humanized one-liner (`Tool result: search → ok`,
   `Model → tool_call: search`). `diff` does *not* use it; it prints raw `JSON.stringify`. So the same
   `tool_result` step reads one way in `inspect` and a completely different way in `diff`. A user moving between
   the two commands re-learns the format each time.

3. **Raw step-type enum strings leak into every surface.** `model_input`, `model_output`, `tool_call`,
   `tool_result`, `metadata` are the internal `TraceStepType` identifiers, printed verbatim in the `inspect`
   timeline, the `replay` events list, and the `diff` divergence lines. They are serviceable but terse; there is
   no single place that maps a step type to a human label, so any future wording change means editing several
   call sites.

None of these are correctness bugs — the hashes, the divergence index, and the shared-prefix length are all
correct today. They are readability bugs in the artifact a human stares at while debugging.

---

## 2. Why W6-A is the next smallest milestone

- **It changes no semantics.** Hashing, the trace schema, `validateTrace`, `replayTrace`, `forkRun`, and
  `diffTraces`' *computation* (`sharedPrefixLength`, `firstDivergenceIndex`, the strict-prefix flags) stay
  byte-for-byte identical. Only the string rendering of already-computed facts changes. This is the lowest-risk
  category of change available.
- **It improves the one artifact active debugging is about.** Blackbox's thesis is *active debugging* — you fork,
  mutate, and read the divergence. The divergence readout is the product's payoff screen, and it is currently the
  least legible output in the CLI. Fixing it has the highest legibility-per-line-changed of any candidate.
- **It is fully testable offline against assets we already froze.** The W5-A corpus (`fixtures/traces/`) already
  contains a `fork-parent` / `fork-child` pair with a frozen first-divergence index of `3`. New output can be
  asserted against those committed cassettes with zero new fixtures and zero live calls.
- **It needs no new surface, dependency, or provider.** It is a pure refactor-and-render change inside existing
  modules and the existing CLI — squarely inside the guardrails.
- **Everything larger is out of scope or not yet scoped.** A second provider adapter, any UI, or a schema change
  are all explicitly excluded or would require their own audited plan. Ergonomics is the smallest useful step that
  moves the product forward without touching any of them.

---

## 3. Design: one shared humanizer, reused everywhere

The root cause of gaps (1)–(3) is that step rendering is duplicated and diverging. The fix is to introduce **one**
small, pure, presentation-only helper module and have `diff`, `inspect`, and `replay` all render through it.

### 3.1 New module: `src/trace/stepLabels.ts` (presentation only)

A pure, dependency-free module that converts already-recorded step facts into human strings. It never hashes,
never mutates, never touches disk, and is import-only from render sites.

Proposed surface (final names decided in implementation, but this is the intent):

- `stepTypeLabel(type: TraceStepType): string` — the single source of truth mapping the internal enum to a human
  label. Initial mapping keeps today's words so existing snapshots barely move, but centralizes them:
  - `model_input → "model input"`
  - `model_output → "model output"`
  - `tool_call → "tool call"`
  - `tool_result → "tool result"`
  - `metadata → "metadata"`
- `describeStep(step: TraceStep): string` — the humanized one-liner. This is `summarizeStep`'s logic lifted out of
  `CassetteReplay.ts` verbatim (same wording, same branches) so `replay`/`inspect` output is unchanged and `diff`
  can now call the identical function.
- `describeDivergenceField(parent: TraceStep | null, child: TraceStep | null): string[]` — the only genuinely new
  rendering: for the divergent pair, produce aligned, human lines that make the change visible instead of a
  mid-key truncation. For a `tool_result` divergence it names the tool and shows the two results side by side,
  each truncated on a wider, word-aware budget and clearly labeled `parent:` / `child:`.

`CassetteReplay.summarizeStep` becomes a thin re-export of `describeStep` (or is replaced by a call to it) so there
is exactly one implementation. No behavior change to replay.

### 3.2 `diff` renders through the shared helper

`formatFirstDivergence` in `src/fork/diffTraces.ts` keeps its exact computed inputs (`TraceDiff` is unchanged) but
its string body is rewritten to:

- label the divergent step type with `stepTypeLabel`,
- print `describeStep(...)` for each side (the same humanized line `inspect` shows),
- then, below it, the new `describeDivergenceField(...)` block so the actual differing values are readable.

The `TraceDiff` interface, `diffTraces()` computation, and the shared-prefix / strict-prefix logic are untouched.

### 3.3 Optional output modes — only if justified

A `--format` flag (`compact` | `detail`) is **held in reserve, not committed**. The default output is the improved
human view described above. `detail` would additionally print the full untruncated payload JSON for the divergent
steps; `compact` would collapse to a single summary line. Per the candidate scope, these are added **only if** the
default humanized output cannot carry both "readable at a glance" and "shows the full changed value" in one view.
If the default view proves sufficient, the flag ships in neither `diff` nor `inspect` and the allow-lists are left
as they are. The implementation slice must justify the flag in the build log if it is added; absence is the
default outcome.

---

## 4. Exact acceptance criteria

An implementation of W6-A is accepted only if **all** of the following hold:

1. **Hashing unchanged.** `src/trace/hash.ts` and `TraceStepHashInput` are untouched. Every frozen hash in
   `tests/fixtures.test.ts` (`FROZEN_FINAL_HASH`, `FROZEN_FINAL_ANSWER_CHAIN`) still matches with no edit to those
   constants. `npm run fixtures:generate` (check mode) reports the corpus in sync with no `--write`.
2. **Schema unchanged.** `CURRENT_TRACE_VERSION` stays `2`; `Trace`, `TraceStep`, and `TraceStepType` are
   unchanged. No cassette on disk changes.
3. **Divergence computation unchanged.** `diffTraces()` still returns the same `sharedPrefixLength`,
   `firstDivergenceIndex`, `parentStep`, `childStep`, and strict-prefix flags for the corpus fork pair
   (`firstDivergenceIndex === 3`). Only `formatFirstDivergence`'s string output changes.
4. **Replay/inspect wording preserved.** `replayTrace`'s `events[].summary` strings are identical to today's for
   every corpus fixture (the humanizer is lifted, not rewritten). Existing `replay.test.ts` / `cli.test.ts`
   assertions on those summaries pass unedited, or are updated only where the change is a deliberate, documented
   label improvement.
5. **Diff is more legible, provably.** For the corpus fork pair, the `diff` output names the divergent step in
   human words and shows both the parent and child `result` values at the divergence in a way that is **not**
   truncated before the values differ. A new test asserts the child's `"available":false` / "No hotels" mutation
   is visible in the rendered diff string.
6. **Single humanizer.** There is exactly one implementation of the step-summary logic; `CassetteReplay` no longer
   holds a second copy. A grep for the summary branch strings finds them in one module.
7. **Offline + green.** `npm test -- --run` passes (≥ 360, with any new ergonomics tests added), zero live calls,
   no API key required. `npm run cli -- check` PASS. `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof`
   still exits at the key guard.
8. **No new dependency / surface.** `package.json` / `package-lock.json` gain no dependency. No UI, backend,
   dashboard, observability, or Anthropic CLI wiring is introduced. `git ls-files traces` stays empty.
9. **Docs match reality.** `DEMO.md`'s `diff` (and, if its timeline wording changes, `inspect`) expected-output
   blocks are updated to the new output, and only if the output actually changed.

---

## 5. Proposed CLI / output changes

**Commands, flags, and exit codes are unchanged** (unless the reserved `--format` flag in §3.3 is justified and
added, in which case it is additive and defaults to today's behavior-equivalent human view).

Illustrative `diff` output *shape* after W6-A (final wording set in implementation):

```
[blackbox] --- diff ---
Parent:  traces/example-trace.json
Child:   traces/example-trace-fork.json

--- trace diff ---
Parent:         example-run-001
Child:          example-run-001-fork
Shared prefix:  3 step(s)  (hash-identical)

Summary:        first divergence at step 3 — tool result (search)
  parent  tool result   <hash>  Tool result: search → ok
  child   tool result   <hash>  Tool result: search → ok
  changed field: result
    parent: { results: [ …3 hotels… ], available: true }
    child:  { results: [], available: false, message: "No hotels available for that date." }
```

The exact glyphs, column widths, and truncation budget are an implementation detail; the *requirement* is that the
changed value is readable on both sides and the step is named in human words. `inspect`'s timeline may adopt
`stepTypeLabel` for consistency (`tool result` instead of `tool_result`); this is optional and, if done, DEMO's
inspect block is updated to match.

---

## 6. Test plan

All offline, fake/deterministic, zero live calls. Prefer asserting against the **committed corpus** so the tests
are frozen against real artifacts, not runtime-regenerated ones.

1. **`stepLabels` unit tests (new).** `stepTypeLabel` returns the expected human label for all five
   `TraceStepType` values and is exhaustive (a `never` guard, mirroring `summarizeStep`'s existing exhaustiveness).
   `describeStep` reproduces today's summaries for one step of each type.
2. **Humanizer parity (regression).** Assert that for every fixture in `fixtures/traces/`, the `replayTrace`
   event summaries equal a frozen expected array (or equal `describeStep` applied step-by-step), proving the lift
   changed no wording. Existing `replay.test.ts` / `cli.test.ts` summary assertions remain green.
3. **Diff legibility (new, corpus-based).** Load `fork-parent.v2.json` and `fork-child.v2.json`, run
   `diffTraces` + `formatFirstDivergence`, and assert the rendered string: (a) reports shared prefix `3`,
   (b) reports first divergence at index `3`, (c) names the step as a tool result, and (d) contains the child
   mutation marker (`available":false` or `No hotels`) — i.e. the change is actually visible, not truncated away.
4. **Divergence computation unchanged (regression).** Keep/extend `diffTraces.test.ts` assertions that
   `firstDivergenceIndex`, `sharedPrefixLength`, and the strict-prefix flags are unchanged for identical traces,
   strict-prefix pairs, and the corpus fork pair.
5. **Frozen-hash guard (regression).** `tests/fixtures.test.ts` passes unmodified — no frozen hash constant is
   edited. This is the tripwire proving hashing/schema were not touched.
6. **CLI end-to-end (extend `tests/cli.test.ts`).** `diff --parent … --child …` over the corpus (or over
   record→fork output) prints the new legible block and exits 0; `inspect` still prints a timeline and exits 0. If
   `--format` is added, add compact/detail cases; if not, add nothing.
7. **Full-loop smoke.** `npm run cli -- check` PASS; `npm run fixtures:generate` check mode in sync.

Target: baseline 360 plus the new ergonomics tests, all green, zero live calls.

---

## 7. Docs impact

- **`DEMO.md`** — update the step 6 **Diff** expected-output block to the new legible format; if `inspect`'s
  step-type wording changes, update the step 3 **Inspect** timeline block too. Update only blocks whose real
  output changed; commands, flags, and file paths are unchanged.
- **`README.md`** — no change expected. The core-loop verb list and proof tables are unaffected. Touch only if a
  README example literally quotes diff output (it does not today).
- **`docs/08_build_log.md`** — append a `2026-… — Week Six W6-A (diff/inspect ergonomics)` entry following the
  established What Was Built / Outcome / Guardrails Held structure.
- **`docs/03_trace_schema.md`** — no change (schema is untouched; this is a hard requirement, not a doc choice).

---

## 8. Non-goals (explicit)

- **No UI, backend, dashboard, or observability/metrics surface.**
- **No provider adapter change and no Anthropic CLI wiring.** No live proof run as part of this milestone.
- **No canonical-hash change.** `hash.ts` and `TraceStepHashInput` are off-limits.
- **No trace-schema change.** `CURRENT_TRACE_VERSION`, `Trace`, `TraceStep`, `TraceStepType` are frozen. If, and
  only if, implementation discovers that legibility genuinely requires a schema field, the work **stops** and a
  separate, Codex-audited schema plan is written — W6-A does not silently expand.
- **No fixture rewrite.** The committed corpus bytes and frozen hashes do not change. New tests read existing
  fixtures; any negative/derived cases are built in-memory at test time, as W5-A did.
- **No new dependency, no production SDK, no npm publish.**
- **No change to diff/divergence *computation*** — `TraceDiff` and `diffTraces()` math are unchanged; only
  rendering moves.

---

## 9. Rollback plan

- **Isolated blast radius.** Changes are confined to a new presentation module (`src/trace/stepLabels.ts`), the
  string body of `formatFirstDivergence` (`src/fork/diffTraces.ts`), the render sites in `src/cli.ts`
  (`runDiff` / `runInspect`), a thinned `summarizeStep` in `src/replay/CassetteReplay.ts`, new tests, and the
  DEMO/build-log docs. No data-model, hashing, or on-disk file is affected.
- **Single-commit revert.** The slice lands as one commit; `git revert <sha>` restores the prior output verbatim.
  Because no cassette, hash, or schema changed, revert is total and leaves the corpus and all frozen hashes
  exactly as they are now — no regeneration needed.
- **Tripwires.** `tests/fixtures.test.ts` (frozen hashes) and `npm run fixtures:generate` (check mode) fail loudly
  if the change accidentally touches hashing or schema, catching scope creep before it lands.
- **No external state.** Nothing is pushed, tagged, deployed, or sent to any provider by this milestone, so
  rollback is purely local.

---

## 10. First implementation prompt

> Implement W6-A (diff/inspect ergonomics) exactly as scoped in `docs/22_week_six_a_plan.md`. Presentation only —
> do not touch `src/trace/hash.ts`, `TraceStepHashInput`, `CURRENT_TRACE_VERSION`, `Trace`, `TraceStep`,
> `TraceStepType`, the `diffTraces()` computation, `forkRun`, `validateTrace`, or any file under `fixtures/`.
>
> 1. Add `src/trace/stepLabels.ts`: a pure, disk-free, hash-free module exporting `stepTypeLabel(type)` (single
>    source of truth for human step-type labels, initially preserving today's wording) and `describeStep(step)`
>    (the humanized one-liner lifted verbatim from `CassetteReplay.summarizeStep`, same branches, same wording,
>    same `never` exhaustiveness guard), plus `describeDivergenceField(parent, child)` that renders the divergent
>    pair so the changed value is visible on both sides and not truncated before it differs.
> 2. Replace `CassetteReplay.summarizeStep`'s body with a call to `describeStep` (or re-export) so there is exactly
>    one implementation; `replayTrace` output wording must be unchanged.
> 3. Rewrite the string body of `formatFirstDivergence` in `src/fork/diffTraces.ts` to render via `stepTypeLabel`,
>    `describeStep`, and `describeDivergenceField`. Leave the `TraceDiff` interface and `diffTraces()` computation
>    untouched.
> 4. Update `runDiff` (and optionally `runInspect` for `stepTypeLabel` consistency) in `src/cli.ts`. Do **not**
>    add `--format` unless the default humanized view cannot show both a glanceable summary and the full changed
>    value; if you add it, it is additive, defaults to the human view, and you justify it in the build log.
> 5. Add offline tests: `stepLabels` unit + exhaustiveness; humanizer parity against the committed corpus; a
>    corpus-based diff-legibility test proving the `fork-child` mutation is visible and divergence is at index 3;
>    and a CLI end-to-end diff/inspect case. Do not edit any frozen hash constant in `tests/fixtures.test.ts`.
> 6. Update `DEMO.md`'s diff block (and inspect block only if its wording changed) and append a W6-A build-log
>    entry.
>
> Acceptance gate: `npm test -- --run` green (≥ 360, zero live calls, no key), `npm run cli -- check` PASS,
> `npm run fixtures:generate` check mode in sync, `tests/fixtures.test.ts` unmodified and passing,
> `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard, `git ls-files traces` empty,
> `package.json` unchanged. Then report: files changed / what is real / what is mocked / tests pass / next safest
> task. Do not push or tag.

---

## 11. Codex audit prompt

> Audit the W6-A plan in `docs/22_week_six_a_plan.md` (and, once implemented, the diff) as a repo-aware reviewer
> before it is accepted for implementation / before tag. Confirm specifically:
>
> 1. **No semantic drift.** `src/trace/hash.ts`, `TraceStepHashInput`, `CURRENT_TRACE_VERSION`, `Trace`,
>    `TraceStep`, `TraceStepType`, `validateTrace`, `replayTrace`'s computed status/result, `forkRun`, and
>    `diffTraces()`'s computed `sharedPrefixLength` / `firstDivergenceIndex` / strict-prefix flags are all
>    unchanged. Only string rendering moves.
> 2. **Frozen artifacts intact.** No fixture byte changes; no frozen hash constant in `tests/fixtures.test.ts` is
>    edited; `npm run fixtures:generate` check mode is in sync with no `--write`.
> 3. **Single humanizer.** There is exactly one copy of the step-summary logic after the change; `CassetteReplay`
>    holds no second implementation.
> 4. **Legibility is actually delivered.** For the corpus fork pair, the rendered `diff` shows the `fork-child`
>    mutation value (not a mid-key truncation) and names the divergent step in human words, with a test that
>    asserts it.
> 5. **Guardrails held.** No UI/backend/dashboard/observability, no Anthropic CLI wiring, no live call, no new
>    provider adapter, no new dependency, no schema change, no product-surface expansion. `git ls-files traces`
>    empty. If `--format` was added, it is additive, defaults to the human view, and is justified.
> 6. **Docs match reality.** DEMO's diff/inspect blocks reflect the new output and nothing more; the build log has
>    an accurate W6-A entry.
>
> Report any scope creep (especially any touch to hashing, schema, or divergence computation) as a blocker.
