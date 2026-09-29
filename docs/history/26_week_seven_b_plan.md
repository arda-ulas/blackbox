# W7-B Plan — Behavioral Outcome Diff

**Status:** IMPLEMENTED / in closeout (awaiting Codex closeout audit before push/tag). Two new pure modules
(`src/trace/traceOutcome.ts`, `src/fork/diffOutcome.ts`) plus a `formatDiffReport` wrapper are added; `runDiff` /
`runFork` switch to the wrapper and `replayTrace` now delegates terminal parsing to the shared `terminalOutcome`.
`diff` and `fork` print a behavioral `Outcome:` verdict. Tests: **442/442** offline (417 baseline + 25 new), zero
live calls. `diffTraces()` computation, the `TraceDiff` shape, `formatFirstDivergence`, schema, canonical hashing,
`forkRun`, provider code, the fixture corpus/generator, `package.json` / `package-lock.json`, and the CLI surface are
unchanged; `check` stdout and `replayTrace` returned fields / CLI `replay` output are byte-identical. The plan body
below is unchanged from the accepted version.
**Predecessor:** W7-A complete, pushed, tagged `week-seven-reactive-fake-model` (HEAD `4868ca4`). The full core loop
is implemented, hardened, composed under one self-check, proven live (opt-in), frozen against a committed regression
corpus, release-frozen with truthful docs, and — as of W7-A — the offline fork/`check` continuation *derives* the
child's answer from the mutated `tool_result` via `ReactiveDemoModelClient`:
`record → replay → fork → mutate → continue → diff → verify → check`. Tests: **417/417** offline, zero live calls.
**Mode:** analysis/presentation slice on the **diff** step. **No change to canonical hashing, trace schema, replay
semantics, the `diffTraces()` computation, fixture bytes, provider adapters, or the CLI surface (no new flag,
command, or exit code).** No live calls, no Anthropic CLI wiring, no new provider adapter, no new dependency, no
UI/backend/dashboard/observability surface.

---

## 1. Problem statement

Today the diff answer is **structural, not behavioral**. When `npm run cli -- diff` (or the inline diff inside
`fork`) compares a parent and a forked child, it reports the first step index whose canonical hash diverges and
renders the value that changed there:

- `diffTraces(parent, child)` (`src/fork/diffTraces.ts`) computes `hasDivergence`, `firstDivergenceIndex`, and
  `sharedPrefixLength` over the hash chain, and `formatFirstDivergence` prints `First divergence at index 3`, a
  `Summary:` line, and (W6-A) the `changed value (result):` block.
- That is mechanically correct but it stops one question short of the debugging payoff. It says *where* the traces
  diverge, never *whether the divergence changed what the run actually did*.

The consequence: a reviewer cannot tell, from the diff alone, the difference between

- a **cosmetic** divergence (step 3's hash changed, but the child still reached the identical final answer via the
  identical tool path — the mutation had **no behavioral effect**), and
- a **consequential** divergence (the mutation flipped the run's outcome — the agent booked in the parent, declined
  in the child).

Both print the same `First divergence at index 3`. The single most persuasive moment of an *active* debugger —
*"mutate a past tool result, continue, and the run's **behavior** changes"* — is present in the data but **absent
from the output**. W7-A made the child's answer genuinely derive from the mutation; W7-B makes the diff **say so**.

This is a legibility/analysis gap, not a correctness bug: fork geometry, hash re-chaining, first-divergence
detection, and the changed-value readout are all real and tested. What is missing is a **behavioral verdict** over
the two runs' terminal outcomes.

---

## 2. Why W7-B is the right next milestone

- **It upgrades the core "so what" of every diff.** Structural divergence alone cannot separate a meaningful change
  from a cosmetic one. This is the smallest change that makes the debugger *reason about behavior* rather than
  bytes.
- **It is boring by default.** Two pure functions over `Trace`, no new dependency, no new CLI surface, no schema or
  hash touch. Fully offline and deterministic — the house invariant holds by construction.
- **It is DRY-positive.** `replayTrace` already extracts terminal status/answer from the last `metadata` step
  inline. W7-B lifts that into one shared `terminalOutcome()` helper that both `replayTrace` and the new outcome
  diff consume, so there is a single source of truth for "how did this run end."
- **It is the foundation for the two larger slices that come after it.** A fork-sweep matrix needs a per-row
  outcome verdict; a minimal-mutation root-cause search needs an outcome oracle to bisect against. Build the oracle
  first, cheaply.
- **Everything larger is out of scope or unscoped.** A new `sweep` command, a behavioral-assertion mini-DSL, and a
  delta-debugging search are each their own scoped decision. W7-B is the smallest slice that raises the debugger's
  behavioral legibility, and it makes each of those later slices strictly easier.

---

## 3. Exact current gap (evidence inventory)

| Site | Role | W7-B treatment |
|---|---|---|
| `src/fork/diffTraces.ts` `diffTraces()` | Structural hash-chain divergence computation | **Unchanged** (computation frozen) |
| `src/fork/diffTraces.ts` `formatFirstDivergence()` | Renders the structural divergence block from a `TraceDiff` | **Unchanged** — it receives only a `TraceDiff` (no full traces, no terminal outcomes), so it *cannot* compute the behavioral verdict and stays structural (§4.3) |
| `src/fork/diffTraces.ts` `formatDiffReport()` *(new)* | Wrapper: structural block + behavioral `Outcome:` block from the two full traces | **Added** — composes `diffTraces` → `formatFirstDivergence` → `diffOutcome` → `formatOutcomeDiff` (§4.3) |
| `src/replay/CassetteReplay.ts` `replayTrace()` | Inline parse of the last `metadata` step for status/result | **Refactor** to consume shared `terminalOutcome()` — returned fields byte-identical (§4.4) |
| `src/cli.ts` `runDiff` / `runFork` | Call `formatFirstDivergence(diff)` directly | **Switch** the call to `formatDiffReport(parentTrace, childTrace)` — a formatter-call change only; no command, flag, or exit-code change (§4.3) |
| `src/workflow/selfCheck.ts` / `check` | Composed self-check report | **Unchanged** — `check` stdout stays byte-identical (§4.5) |

Load-bearing fact for scope: the behavioral verdict is a **pure function of the two `Trace` objects**. It needs no
model, tool, network, clock, or disk. It reads only recorded steps. That is what keeps the slice offline,
deterministic, and free of any schema/hash/replay-semantics change.

---

## 4. Proposed design

### 4.1 One new single-trace module: `src/trace/traceOutcome.ts`

Two pure functions, no IO, no clock, no input mutation:

- `terminalOutcome(trace: Trace): TerminalOutcome` where
  `TerminalOutcome = { status: "success" | "error" | "incomplete"; finalAnswer?: string; failureReason?: string }`.
  It reads the **last `metadata` step** using exactly the logic `replayTrace` uses today: `run_completed` +
  `status: "success"` → `success` with `finalAnswer = meta.result`; `run_failed` → `error` with
  `failureReason = meta.reason`; anything else (including no terminal `metadata`) → `incomplete`. This becomes the
  single source of truth for terminal-status parsing.
- `toolCallSequence(trace: Trace): string[]` — the ordered list of `toolName` values from every **`tool_call`**
  step. **Decision (locked): the tool sequence is defined by `tool_call` steps** (the agent's executed requests,
  one per call in `agentLoop`), **not** `tool_result` steps. The two differ only when a run aborts between a call
  and its result; using `tool_call` captures "what the agent tried to do," which is the behavioral path. This
  choice is documented in the module header so it is not silently re-litigated.

### 4.2 One new two-trace module: `src/fork/diffOutcome.ts`

- `diffOutcome(parent: Trace, child: Trace): OutcomeDiff` where
  `OutcomeDiff = { parentStatus; childStatus; statusChanged; finalAnswerChanged; toolSequenceChanged; parentTools;
  childTools; behaviorallyEquivalent; verdict }`. Pure; does not mutate its inputs; runs **independently of**
  `diffTraces` (it does not require a divergence to exist).
- **Classification by strict precedence** (final wording at implementation; the *branches* are binding):
  1. **status differs** → `outcome flipped: parent <ps> → child <cs>` (`behaviorallyEquivalent = false`).
  2. same status, **final answer differs** → `same status (<s>), but the final answer changed`
     (`behaviorallyEquivalent = false`). For `error` status the comparison is over `failureReason`; a differing
     reason reports `same status (error), failure reason changed`.
  3. same status + same answer/reason, **tool sequence differs** → `same answer, different tool path`
     (`behaviorallyEquivalent = false`).
  4. all three equal → `no behavioral change: the divergence did not alter the outcome`
     (`behaviorallyEquivalent = true`). **This is the headline case** — it is the debugger telling you a mutation
     had no downstream effect.
- `formatOutcomeDiff(diff: OutcomeDiff): string` — returns the one-line `Outcome:` verdict, followed by the two
  tool sequences only when they differ. Provider-neutral text (no provider markers).

### 4.3 Wire the verdict via a new wrapper formatter: `formatDiffReport` (`src/fork/diffTraces.ts`)

**Wiring constraint (per Codex audit):** `formatFirstDivergence(diff)` receives only a `TraceDiff`, and `TraceDiff`
carries no full traces and no terminal outcomes — so `formatFirstDivergence` **cannot** compute the behavioral
verdict by itself. `diffOutcome(parentTrace, childTrace)` needs the two full `Trace` objects. The chosen design
resolves this without touching the structural layer:

- **`diffTraces()` stays structural and unchanged.** `hasDivergence` / `firstDivergenceIndex` /
  `sharedPrefixLength` and the `Summary:` humanSummary are untouched.
- **The `TraceDiff` shape is unchanged.** No outcome fields are added to it.
- **`formatFirstDivergence(diff)` stays structural and unchanged.** It keeps its `TraceDiff`-only signature; its
  existing `diffTraces.test.ts` assertions pass unedited.
- **New wrapper:** `formatDiffReport(parentTrace: Trace, childTrace: Trace): string`, which
  1. calls `diffTraces(parentTrace, childTrace)`,
  2. calls `formatFirstDivergence(traceDiff)`,
  3. calls `diffOutcome(parentTrace, childTrace)`, and
  4. appends `formatOutcomeDiff(outcome)`.

`runDiff` and `runFork` in `src/cli.ts` **switch from calling `formatFirstDivergence(diff)` directly to calling
`formatDiffReport(parentTrace, childTrace)`**. Both call sites already hold the two full traces, so this is **only
a formatter-call change** — no command, flag, allow-list, exit-code, schema, hash, replay-semantic, `forkRun`,
provider, package, or fixture change. One wrapper serves both surfaces (DRY): the standalone `diff` command and the
inline `--- trace diff ---` block in `fork` both gain the `Outcome:` block. `record`, `replay`, `verify`, `list`,
`inspect`, and `check` are untouched (`check` stdout remains byte-identical, §4.5).

### 4.4 Replay DRY refactor (in scope, byte-identical) (`src/replay/CassetteReplay.ts`)

**Decision (locked): the replay refactor is in scope.** `replayTrace` currently parses the last `metadata` step
inline to derive `status` / `result` / `failureReason` for its `ReplaySummary`. That is the same parse
`terminalOutcome` performs. `replayTrace` is refactored to call `terminalOutcome()` and map its result onto
`ReplaySummary` so the two do not carry separate terminal-status parsing logic. **Replay parity means: the
`ReplaySummary` return fields stay byte-identical, and the CLI `replay` command's stdout stays byte-identical.
(`replayTrace` itself writes no stdout — it returns a summary that the CLI's `runReplay` renders.)** The refactor
is internal only. A corpus parity test guards this: over every committed fixture, `replayTrace(t)`'s returned
fields are unchanged, and its `status`/`result` equal `terminalOutcome(t).status`/`finalAnswer`. If any drift
appears, the refactor is wrong (not the test) — stop and re-examine. `replayTrace`'s Trace-only signature and
offline guarantee are intact.

### 4.5 `check` and `verify`: unchanged, byte-identical

No `check` stage detail quotes an outcome verdict, and W7-B does **not** add one to the self-check report. `npm run
cli -- check` stdout stays **byte-identical**; existing `selfCheck.test.ts` / `cli.test.ts` check assertions pass
unedited. An outcome-aware `check` detail is an explicitly deferred, separately-scoped decision (§9). `verify` is
untouched.

### 4.6 What is deliberately untouched

`hash.ts`, `TraceStepHashInput`, `CURRENT_TRACE_VERSION`, `Trace`/`TraceStep`/`TraceStepType`, `TraceRecorder`,
`validateTrace`, `replayTrace`'s **signature/returned fields**, `forkRun`, the `diffTraces()` **computation**, the
`TraceDiff` **shape**, `formatFirstDivergence` (stays structural, `TraceDiff`-only),
`verifyTrace`/`verifyExplain`, `neutrality.ts`, `stepLabels.ts`, `agentLoop.ts`, `fixtureTools.ts`,
`modelClient.ts`, `reactiveDemoModel.ts`, `anthropicModelClient.ts`, all proof scripts,
`scripts/generateFixtures.ts`, everything under `fixtures/`, `package.json`/`package-lock.json`, `.gitignore`.

---

## 5. Acceptance criteria

An implementation of W7-B is accepted only if **all** of the following hold:

1. **The verdict is derived, provably.** `diffOutcome` is a pure function of the two `Trace` objects — no model,
   tool, network, clock, or disk; identical inputs → identical `OutcomeDiff`; neither input trace is mutated.
2. **All four precedence branches are correct and tested.** status flip; same-status-answer-changed (incl. the
   `error`/`failureReason` sub-case); same-answer-different-tool-path; and the headline `no behavioral change`
   case, each test-asserted, with `behaviorallyEquivalent` set correctly.
3. **Tool sequence source is `tool_call` steps**, ordered, documented in `traceOutcome.ts`; `tool_result` steps are
   **not** used for the sequence. Test-asserted.
4. **Both diff surfaces show the verdict via the wrapper.** `runDiff` and `runFork` switch from calling
   `formatFirstDivergence(diff)` directly to calling the new `formatDiffReport(parentTrace, childTrace)` — a
   formatter-call change only (no command, flag, allow-list, or exit-code change) — and `npm run cli -- diff` and
   the inline diff in `npm run cli -- fork` each print an `Outcome:` line; existing divergence / `Summary:` /
   `changed value (result):` assertions pass unedited.
5. **Replay is byte-identical after the DRY refactor.** `replayTrace`'s returned `ReplaySummary` fields are
   unchanged and the CLI `replay` command's stdout is unchanged (`replayTrace` itself writes no stdout — it returns
   a summary the CLI renders); existing replay tests pass unedited; a corpus parity test asserts `terminalOutcome`
   agrees with `replayTrace`.
6. **`check` output byte-identical.** `npm run cli -- check` stdout is unchanged and its existing tests pass
   unedited. Exit codes everywhere unchanged.
7. **Structural diff layer unchanged.** `diffTraces()` (`hasDivergence` / `firstDivergenceIndex` /
   `sharedPrefixLength`), the `TraceDiff` shape, and `formatFirstDivergence` (structural, `TraceDiff`-only) are all
   untouched; the `Outcome:` block is produced only by the new `formatDiffReport` wrapper.
8. **Fixture corpus untouched.** Zero byte changes under `fixtures/`; no frozen-hash constant in
   `tests/fixtures.test.ts` edited; `npm run fixtures:generate` (check mode) reports the corpus in sync.
9. **No new CLI surface.** No new flag, command, or exit code; all allow-lists unchanged.
10. **No new dependency.** `package.json` / `package-lock.json` byte-identical.
11. **Offline + green.** `npm test -- --run` ≥ 417 + new tests, zero live calls, no API key required. `git ls-files
    traces` empty.
12. **Docs match reality.** DEMO.md's diff + fork sections quote the *actual* new `Outcome:` line and gain a proof
    point stating the behavioral delta is computed offline from the two traces (still fake/offline, still
    deterministic, exact-string comparison — no semantic judge). Build-log W7-B entry accurate; plan status header
    moved to implemented/in-closeout at landing.

---

## 6. Test plan

All offline, deterministic, zero live calls, no new fixtures on disk (in-memory traces only, per house pattern).

1. **`terminalOutcome` unit (new `tests/traceOutcome.test.ts`).** success (status + `finalAnswer`); error (status +
   `failureReason`); incomplete (no terminal `metadata` — returns `incomplete`, does not throw). **Parity:** over
   every committed fixture, `terminalOutcome(t).status`/`finalAnswer` equals what `replayTrace(t)` reports.
2. **`toolCallSequence` unit (same file).** ordered names for a multi-tool trace; empty array for a
   final-answer-only trace; ignores non-`tool_call` steps (asserting the `tool_call`-not-`tool_result` decision).
3. **`diffOutcome` unit (new `tests/diffOutcome.test.ts`), one test per precedence branch.**
   - status flip (success → error / success → incomplete) → case 1, `behaviorallyEquivalent === false`.
   - same success, answer changed → case 2.
   - same error, `failureReason` changed → case 2 (error sub-case).
   - same status + answer, tool path changed → case 3.
   - fully equal → case 4, `behaviorallyEquivalent === true`, verdict names "no behavioral change".
   - no-divergence pair (identical traces) → case 4.
   - determinism: identical inputs twice → identical `OutcomeDiff`; input traces not mutated.
4. **`formatDiffReport` composition unit (in `tests/diffOutcome.test.ts` or `tests/diffTraces.test.ts`).** Over an
   in-memory parent/child pair: `formatDiffReport(parent, child)` contains the full
   `formatFirstDivergence(diffTraces(parent, child))` output verbatim as a prefix, followed by the `Outcome:`
   block; `formatFirstDivergence` itself is unchanged and its existing tests pass unedited.
5. **Integration (extend `tests/fork.test.ts` or a focused new block).** Fork the demo parent with the default
   no-availability mutation using `ReactiveDemoModelClient`; assert `diffOutcome(parent, child)` classifies case 2
   (same `success` status, final answer changed), naming both facts. (The reactive model always returns
   `final_answer`, so the demo exercises the answer-changed branch, not a status flip — assert that explicitly.)
6. **CLI end-to-end (extend `tests/cli.test.ts`).** `diff` and `fork` (now rendering via `formatDiffReport`) over
   the **frozen corpus fork pair** (`fixtures/traces/fork-parent.v2.json` / `fork-child.v2.json`) print an
   `Outcome:` line with the expected verdict; existing fork/diff assertions (divergence, `Summary:`, `changed
   value (result):`) pass unedited.
7. **Replay byte-identical (extend `tests/replay.test.ts`).** Existing replay assertions pass unedited; add a corpus
   parity assertion that `replayTrace`'s returned `ReplaySummary` fields are unchanged after the refactor and agree
   with `terminalOutcome` (CLI `replay` stdout is covered by the existing unedited CLI replay assertions).
8. **Corpus tripwires.** `tests/fixtures.test.ts` unmodified and green; `npm run fixtures:generate` (check mode) in
   sync — proving the corpus was not dragged along.

Target: 417 baseline + roughly 15–20 new tests, all green, zero live calls.

---

## 7. Fixture policy (explicit)

**No fixture corpus rewrite. The generator is out of scope.**

- W7-B reads the committed fixtures (parity + CLI e2e assertions) but changes **no** fixture byte and **no** frozen
  hash. `terminalOutcome`/`diffOutcome` are analysis-only; they never regenerate or re-hash a cassette.
- Binding rule: if implementation discovers any `fixtures/` byte change, any frozen-hash edit, or fixtures
  check-mode drift, **stop** — do not silently regenerate. Either rescope to remove the coupling or write a
  separate, Codex-audited regeneration plan per `docs/20_week_five_a_plan.md` §7.

---

## 8. Docs impact

- **`DEMO.md`** — targeted, additive updates (everything else byte-identical):
  1. **Diff section (step 6):** the expected-output block gains the new `Outcome:` line; a "Key proof points"
     bullet is added stating the behavioral delta (status / final answer / tool path) is **computed offline from
     the two traces** by a pure function — change the mutation, the verdict can change — still zero live calls,
     exact-string comparison (no semantic judge).
  2. **Fork section (step 5):** the inline `--- trace diff ---` block gains the same `Outcome:` line, since both
     surfaces render via the shared `formatDiffReport` wrapper.
  The `record`, `replay`, `list`, `inspect`, `verify`, `check`, and fixtures sections are otherwise unchanged.
- **`README.md`** — at closeout: Status advanced to W7-B; test count updated to the new true suite total; a
  **Week-Seven Behavioral Outcome Diff** (`week-seven-behavioral-outcome-diff`) build-history entry noting that
  `diff`/`fork` now report how the run's terminal behavior differs (status / final answer / tool path), computed
  offline. Preserve no-overclaim wording (fake/offline, deterministic, exact-string, zero live calls).
- **`docs/08_build_log.md`** — append the W7-B entry (What Was Built / Outcome / Guardrails Held) at closeout.
- **`AGENTS.md` / `CLAUDE.md`** — current-state pointer refresh at closeout (W7-B current/closed, new test total),
  consistent with precedent. No guardrail or invariant wording change is required by W7-B.
- **`docs/26_week_seven_b_plan.md`** — status header to IMPLEMENTED/in-closeout at landing; body unchanged.
- **`docs/03_trace_schema.md`** — no change (schema untouched; hard requirement).

---

## 9. Non-goals (explicit)

- **No semantic / LLM-judged answer comparison.** Final-answer equality is exact-string, to preserve offline
  determinism. A judge would require a model call — out of scope, now and for this slice.
- **No `check` stdout change.** Byte-identical preserved; an outcome-aware `check` detail is a later, explicitly
  scoped decision.
- **No new CLI command or flag.** The fork **sweep** matrix (fork one step with N mutations → comparison table) is
  the *next* slice, not this one. No allow-list or exit-code change.
- **No behavioral-assertion mini-DSL.** Asserting "agent called booking" / "final answer contains X" is a separate
  scoped decision.
- **No minimal-mutation root-cause search.** Delta-debugging to find the single mutation that flips an outcome is a
  separate, larger, scoped decision (it builds *on* this outcome oracle).
- **No `diffTraces()` computation, `TraceDiff` shape, or `formatFirstDivergence` change.** `hasDivergence` /
  `firstDivergenceIndex` / `sharedPrefixLength` untouched; `formatFirstDivergence` stays structural
  (`TraceDiff`-only). Only new pure modules, the `formatDiffReport` wrapper, and the two formatter-call switches in
  `src/cli.ts`.
- **No schema/hash/replay-semantics/`forkRun`/provider change.** `replayTrace`'s returned fields and the CLI
  `replay` stdout stay byte-identical (`replayTrace` writes no stdout itself); the only edits to existing runtime
  are the `formatDiffReport` wrapper, the two `runDiff`/`runFork` formatter-call switches, and the internal,
  byte-identical replay refactor.
- **No fixture rewrite** and no `scripts/generateFixtures.ts` change (§7).
- **No new CLI flags/commands/exit codes; no new dependency; no `package.json`/`.gitignore` change.**
- **No UI, backend, dashboard, observability, eval platform, prompt management, or multi-agent work.**
- **No next-milestone implementation** (sweep, assertions, root-cause are separate decisions).

---

## 10. Rollback plan

- **Isolated blast radius.** Two new modules (`src/trace/traceOutcome.ts`, `src/fork/diffOutcome.ts`), one new
  wrapper formatter (`formatDiffReport` in `src/fork/diffTraces.ts` — existing functions unchanged), two
  formatter-call switches (`src/cli.ts` `runDiff`/`runFork`), one internal byte-identical refactor
  (`src/replay/CassetteReplay.ts`), new tests, and the DEMO/build-log/plan-header doc edits. No data model,
  hashing, schema, fixture, or provider file is touched.
- **Single-commit revert.** The slice lands as one commit; `git revert <sha>` restores the prior diff/replay output
  verbatim. Because no cassette, hash, schema, or fixture changed, revert is total — no regeneration needed.
- **Tripwires.** `tests/fixtures.test.ts` (frozen hashes) and `npm run fixtures:generate` (check mode) fail loudly
  if the corpus is accidentally dragged along; unedited `selfCheck.test.ts`/`check` and replay assertions fail
  loudly if `check` or replay output drifted; the unedited existing `diffTraces`/`formatFirstDivergence` assertions
  fail loudly if the structural formatter was modified instead of wrapped.
- **No external state before local acceptance.** The implementation commit is not pushed or tagged before the Codex
  closeout audit; pre-acceptance rollback is purely local. Push/tag follow only after acceptance, per house
  workflow.

---

## 11. First implementation prompt (Sonnet)

> Implement W7-B (behavioral outcome diff) exactly as scoped in `docs/26_week_seven_b_plan.md`. Offline,
> deterministic, zero live calls. Do not touch `src/trace/hash.ts`, `TraceStepHashInput`, `CURRENT_TRACE_VERSION`,
> `Trace`/`TraceStep`/`TraceStepType`, `validateTrace`, `forkRun`, the `diffTraces()` computation
> (`hasDivergence`/`firstDivergenceIndex`/`sharedPrefixLength`), `verifyTrace`/`verifyExplain`, `neutrality.ts`,
> `stepLabels.ts`, `agentLoop.ts`, `fixtureTools.ts`, `modelClient.ts`, `reactiveDemoModel.ts`, any provider/proof-
> script code, `scripts/generateFixtures.ts`, anything under `fixtures/`, `package.json`, `package-lock.json`, or
> `.gitignore`.
>
> 1. Add `src/trace/traceOutcome.ts`: pure `terminalOutcome(trace): { status: "success" | "error" | "incomplete";
>    finalAnswer?: string; failureReason?: string }` (read from the last `metadata` step, exactly the logic
>    `replayTrace` uses today) and `toolCallSequence(trace): string[]` (ordered `toolName` from every `tool_call`
>    step). No IO, no clock, no input mutation. Document in the header that the tool sequence is defined by
>    `tool_call` steps (executed requests), not `tool_result` steps.
> 2. Add `src/fork/diffOutcome.ts`: pure `diffOutcome(parent, child): OutcomeDiff` with fields `{ parentStatus,
>    childStatus, statusChanged, finalAnswerChanged, toolSequenceChanged, parentTools, childTools,
>    behaviorallyEquivalent, verdict }`, classified by strict precedence — status differs → outcome flipped; else
>    final answer differs → same status, answer changed (for `error` status compare `failureReason`); else tool
>    sequence differs → same answer, different tool path; else no behavioral change. Add `formatOutcomeDiff(diff):
>    string` returning the one-line `Outcome:` verdict plus the two tool sequences when they differ. Provider-neutral
>    text; does not mutate inputs; runs independently of `diffTraces`.
> 3. In `src/fork/diffTraces.ts`, add a new wrapper `formatDiffReport(parentTrace: Trace, childTrace: Trace):
>    string` that (a) calls `diffTraces(parentTrace, childTrace)`, (b) calls `formatFirstDivergence(traceDiff)`,
>    (c) calls `diffOutcome(parentTrace, childTrace)`, and (d) appends `formatOutcomeDiff(outcome)`. Do **not**
>    modify `diffTraces()`, the `TraceDiff` shape, or `formatFirstDivergence` — it receives only a `TraceDiff` (no
>    full traces, no terminal outcomes), so it cannot compute the verdict and stays structural. In `src/cli.ts`,
>    switch `runDiff` and `runFork` from calling `formatFirstDivergence(diff)` directly to calling
>    `formatDiffReport(parentTrace, childTrace)` — a formatter-call change only; no command, flag, allow-list,
>    exit-code, schema, hash, replay-semantic, `forkRun`, provider, package, or fixture change. This lights up both
>    `cli diff` and `cli fork`, and `check` stdout must remain byte-identical.
> 4. Refactor `src/replay/CassetteReplay.ts` `replayTrace` to consume `terminalOutcome()` instead of its inline
>    last-`metadata` parse. Replay parity means: the returned `ReplaySummary` fields stay **byte-identical**, and
>    the CLI `replay` command's stdout stays byte-identical (`replayTrace` itself writes no stdout — it returns a
>    summary the CLI renders); guard with a corpus parity test. If any check/replay assertion would need editing,
>    stop and report instead.
> 5. Add offline tests per plan §6: `traceOutcome` unit + corpus parity vs `replayTrace`; `toolCallSequence` unit
>    (asserting the `tool_call`-not-`tool_result` source); `diffOutcome` unit (one per precedence branch, including
>    the "no behavioral change" case and determinism / no-input-mutation); a `formatDiffReport` composition unit
>    (its output contains the full `formatFirstDivergence(diffTraces(p, c))` output verbatim as a prefix, followed
>    by the `Outcome:` block); integration over the reactive demo fork (case 2 verdict, naming status stayed
>    success and the answer changed); CLI e2e (`diff` + `fork` print the expected `Outcome:` line over the frozen
>    corpus fork pair); replay parity (returned fields unchanged; CLI replay stdout covered by existing unedited
>    assertions). Keep `tests/fixtures.test.ts`, `tests/selfCheck.test.ts`, and all existing fork/diff/check/replay
>    assertions passing **unedited**; do not edit any frozen hash constant.
> 6. Update the docs per plan §8: `DEMO.md` step 6 (Diff) and step 5 (Fork) gain the new `Outcome:` line + a
>    derivation proof point (behavioral delta computed offline from the two traces, exact-string, no live call);
>    append the W7-B build-log entry; set this plan's status header to IMPLEMENTED/in-closeout. `check` stdout must
>    remain byte-identical.
>
> Acceptance gate: `npm test -- --run` green (417 + new, zero live calls, no key); `npm run cli -- check` PASS with
> byte-identical output; `npm run cli -- diff` and `fork` show the `Outcome:` line; `npm run fixtures:generate`
> check mode in sync; zero byte changes under `fixtures/`; `git ls-files traces` empty; `package.json`/
> `package-lock.json` byte-identical; no new CLI flag. Then report: files changed / what is real / what is mocked /
> tests pass / next safest task. Do not push or tag.

---

## 12. Codex audit prompt

> Audit the W7-B plan in `docs/26_week_seven_b_plan.md` (and, once implemented, the diff) as a repo-aware reviewer
> before it is accepted for implementation / before tag. Confirm specifically:
>
> 1. **The verdict is derived and pure.** `diffOutcome` / `terminalOutcome` / `toolCallSequence` use no clock,
>    randomness, IO, network, or provider import; identical input → identical output; input traces are not mutated;
>    the classification follows the four-branch precedence exactly.
> 2. **Tool sequence source is `tool_call` steps**, ordered, documented; `tool_result` is not used. Test-asserted.
> 3. **Wrapper wiring is correct.** `formatDiffReport(parentTrace, childTrace)` composes `diffTraces` →
>    `formatFirstDivergence` → `diffOutcome` → `formatOutcomeDiff` in that order; `runDiff` and `runFork` switched
>    from direct `formatFirstDivergence(diff)` calls to `formatDiffReport(parentTrace, childTrace)` (a
>    formatter-call change only — no command/flag/exit-code change); `diff` and `fork` print an `Outcome:` line;
>    the existing `diffTraces` `Summary:` / `changed value` / divergence assertions pass unedited.
> 4. **Structural diff layer unchanged.** `diffTraces()` (`hasDivergence` / `firstDivergenceIndex` /
>    `sharedPrefixLength`), the `TraceDiff` shape, and `formatFirstDivergence` (structural, `TraceDiff`-only) are
>    all untouched — the behavioral block is produced only by the new wrapper.
> 5. **Replay byte-identical after the DRY refactor.** `replayTrace`'s returned `ReplaySummary` fields unchanged
>    and the CLI `replay` command's stdout unchanged (`replayTrace` itself writes no stdout — it returns a summary
>    the CLI renders); replay tests pass unedited; the corpus parity test exists and passes (`terminalOutcome`
>    agrees with `replayTrace`) — flag its absence as a blocker.
> 6. **`check` byte-identical.** `npm run cli -- check` stdout unchanged; `selfCheck.test.ts` and the cli check
>    assertions pass unedited; exit codes unchanged everywhere.
> 7. **Fixtures frozen.** Zero byte changes under `fixtures/`; no frozen-hash edit in `tests/fixtures.test.ts`;
>    `npm run fixtures:generate` check mode in sync; `scripts/generateFixtures.ts` untouched.
> 8. **No surface growth.** No new CLI flag/command/exit code; allow-lists unchanged; no new dependency;
>    `package.json`/`package-lock.json`/`.gitignore` byte-identical; no UI/backend/dashboard/observability; no
>    Anthropic CLI wiring; no live call anywhere in the diff; proof scripts untouched.
> 9. **Not a framework.** Two pure modules plus one wrapper formatter, two formatter-call switches, and one
>    byte-identical refactor — no configuration/plugin/DSL surface, no `sweep`/assertion/root-cause scope creep.
>    Flag any generalization as scope creep.
> 10. **Honesty of the claim.** After this change, is it fair to say `diff` reports *behavioral* difference (not
>     semantic understanding)? Confirm the exact-string / offline / deterministic framing is preserved in DEMO.md
>     and the build-log entry, with no overclaim of semantic judgment.
>
> Report any scope creep (fixture regeneration, `diffTraces()` computation or `TraceDiff` shape edits,
> `formatFirstDivergence` modifications, new flags, generator changes, replay parity drift, a semantic judge) as a
> blocker.
