# W4-G Plan — Fork/Verify Workflow Polish

**Status:** PLANNED (not implemented). Plan-only document.
**Predecessor:** W4-F complete, pushed, tagged `week-four-cassette-verification` (`793384b` feat,
`a8580e4` secret-key audit hardening). Full core loop proven:
`record → replay → fork → mutate → continue → diff → verify`. Tests: 307/307 offline, zero live calls.
**Mode:** local TypeScript CLI/core only. No live calls, no CLI Anthropic wiring, no new provider adapter,
no product-surface expansion.

> This is the accepted-plan document for W4-G. Nothing here is implemented yet. Implementation happens in a
> later slice under the first-implementation prompt in §9.

---

## 1. Problem statement

The core loop is proven and each stage has a clean command, but the **workflow around those commands** has
three rough edges that make it harder to run and easier to misuse than it should be:

1. **No single command runs the whole loop.** To exercise `record → verify → fork → verify → diff` a user must
   run five separate `npm run cli --` invocations, thread output paths between them by hand, and eyeball five
   independent reports to decide "is the loop sound on my machine right now?" There is no one composed,
   fully-offline command that runs the canonical loop end-to-end and emits a **single** verdict. This is the
   most common thing a newcomer (or CI, or a regression check) wants, and today it requires memorizing the
   sequence and the path-threading.

2. **`fork` can silently overwrite its own parent.** The default child path is derived by
   `tracePath.replace(/\.json$/, "-fork.json")` (`src/cli.ts`). If the `--trace` argument does **not** end in
   `.json` (e.g. `traces/example-trace`), the replace is a no-op and the derived `--out` equals the input path
   — so `saveTrace` overwrites the parent cassette with the child. An explicit `--out` equal to `--trace` has
   the same effect. Either way the parent trace is destroyed with no warning. For a debugger whose whole value
   is *preserving* the parent history to diff against, this is a real footgun.

3. **Output is inconsistent across commands.** Label column widths differ per command
   (`record`/`replay`/`verify` pad to 14, `fork` to 15, `inspect` to 20), and the header/verdict vocabulary is
   assembled inline in each `run*` function. There is no shared formatting helper, so the report shapes drift
   as commands are edited, and a new composed command would either duplicate the inline formatting or diverge
   from it.

Two smaller drifts compound the above:

4. **Docs undercount tests.** `DEMO.md` still says "274 tests" in two places; the suite is now 307. The
   canonical local workflow is documented as a linear list of commands but not as *the* recommended one-shot
   check.

**Thesis:** now that the loop and cassette verification are proven, make the local workflow **easier to run**
(one composed offline command that runs and inspects the full loop) and **harder to misuse** (refuse to clobber
a parent trace; standardize report formatting) — **without expanding product surface**. Blackbox stays active
debugging: `record → replay → fork → mutate → continue → diff → verify`. No new observability surface, no live
wiring, no schema/hash/replay behavior change.

---

## 2. Why W4-G is the next smallest milestone

- The loop is complete and each stage is individually hardened (W4-A…F). The remaining friction is **entirely
  in composition, output, and guardrails** — exactly the surface W4-G targets — not in any new capability.
- Every piece **composes existing, already-tested, fake/offline functions** (`runAgentLoop`, `forkRun`,
  `diffTraces`, `verifyTrace`) and existing CLI plumbing. No new provider code, no new dependency, no schema
  change. Blast radius is small and reversible.
- The composed self-check command is explicitly sanctioned by the W4-G candidate scope ("a narrow demo/check
  command only if it composes existing fake/offline commands") and pays for itself immediately as a smoke check
  and an onboarding path.
- The `fork` overwrite guard is a two-line safety check that closes a data-loss footgun in the one command
  whose entire purpose is to *not* lose the parent.
- It is the smallest step that leaves the local CLI meaningfully more usable without touching the proven core.

---

## 3. Scope

Three cohesive pieces under one thesis. (1) is primary; (2) and (3) are small supporting hardening.

### 3.1 Composed offline self-check command (`check`)

A new fully-offline subcommand that runs the canonical loop in one shot and emits a single PASS/FAIL verdict:

```
npm run cli -- check [--out-dir <dir>] [--keep]
```

Stages (all in-memory, fake/deterministic — no model, no tool, no live call):

| # | Stage | Composes | Expected |
|---|---|---|---|
| 1 | `record`  | `runAgentLoop` with the demo success script + `defaultToolExecutor()` | success trace, N steps |
| 2 | `verify(parent)` | `verifyTrace` | PASS (all four invariants) |
| 3 | `fork`    | `forkRun` (tool-result mutation at the demo step) | child trace, valid chain |
| 4 | `verify(child)`  | `verifyTrace` | PASS |
| 5 | `diff`    | `diffTraces` | divergence at the mutation index; non-empty hash-identical shared prefix |

Design discipline (mirrors `verifyTrace`):

- The orchestration lives in a **pure, testable core** `src/workflow/selfCheck.ts` exporting
  `runSelfCheck(opts?): Promise<SelfCheckReport>`. It runs **entirely in memory** using the existing library
  functions and returns a structured report; it does **not** require disk. It cannot make a live call by
  construction — it only instantiates `FakeDeterministicModelClient` and `defaultToolExecutor()`, exactly like
  the existing demo.
- Persistence is **opt-in**: with `--out-dir <dir>` (and/or `--keep`) the command writes the parent and child
  cassettes to disk and prints their paths; with no flag it runs purely in memory and writes nothing. This
  keeps the default `check` side-effect-free and safe to run anywhere.
- The `check` subcommand in `src/cli.ts` is a **thin wrapper**: call `runSelfCheck`, format the stage checklist
  + verdict, exit `0` on PASS / `1` on FAIL (scriptable, like `verify`).

`SelfCheckReport` (illustrative — final types at implementation time):

```ts
export interface SelfCheckStage {
  name: "record" | "verify_parent" | "fork" | "verify_child" | "diff";
  status: "pass" | "fail";
  detail: string;               // human-readable; no key values, no raw SDK objects
}

export interface SelfCheckReport {
  pass: boolean;
  stages: SelfCheckStage[];
  firstFailure?: { name: SelfCheckStage["name"]; detail: string };
  // Present so --keep can persist without re-running:
  parentTrace: Trace;
  childTrace: Trace;
}
```

> Naming: `check` is chosen over `demo`/`selftest` because it reads as "check the loop is sound," runs a verdict,
> and is scriptable. It is a **self-check of the active-debugging loop**, not an observability surface.

### 3.2 `fork` overwrite guardrail

In `runFork` (`src/cli.ts`), after resolving `outPath`, **refuse to write when the resolved output path equals
the resolved parent (`--trace`) path**, comparing normalized absolute paths (so `./a.json` vs `a.json` and the
no-extension footgun are both caught):

```
[blackbox error] Refusing to overwrite the parent trace at <path>. Pass an explicit --out.
```

This closes both failure modes: (a) a `--trace` argument without a `.json` suffix, whose default-derived
`--out` collides with the input, and (b) an explicit `--out` equal to `--trace`. `verify`/`diff`/`inspect` are
read-only and need no such guard, but `diff` may print a gentle note when `--parent` and `--child` resolve to
the same path (optional; not a hard error, since diffing a trace against itself is harmless and yields
"identical").

### 3.3 Output consistency + docs

- **Shared formatting helper** `src/cli/format.ts` exporting a single header builder and label helper, e.g.
  `header(name: string): string` → `` `[blackbox] --- ${name} ---` `` and a `label(s: string): string` with one
  `LABEL_WIDTH` constant. Adopt it in the `run*` functions **without changing any currently-asserted substring**
  (see §6 regression note): the label *text* and header *text* stay identical; only the mechanical padding width
  is unified and the assembly is centralized. `check` uses the same helper so the new command matches the
  existing report vocabulary.
- **Docs**: fix the `DEMO.md` "274 tests" → "307 tests" drift; add a short "Canonical workflow / one-shot check"
  section to `DEMO.md` and `README.md` documenting `npm run cli -- check`; note in both that `fork` now refuses
  to overwrite the parent.

---

## 4. CLI / output shape

**`check` (PASS, in-memory default):**

```
[blackbox] --- check ---
Mode:            in-memory (no files written; pass --out-dir to persist)

  record         pass  success trace, 15 step(s)
  verify_parent  pass  4/4 invariants
  fork           pass  child valid, tool_result mutation at step 3
  verify_child   pass  4/4 invariants
  diff           pass  first divergence at index 3, shared prefix 3 step(s)

Result:          PASS
```

**`check --out-dir traces/selfcheck` (PASS, persisted):**

```
[blackbox] --- check ---
Mode:            persisted
Parent:          traces/selfcheck/check-parent.json
Child:           traces/selfcheck/check-child.json

  record         pass  ...
  ...
Result:          PASS
```

**`check` (FAIL — hypothetical, first failing stage named, exit 1):**

```
Result:          FAIL
First failing stage: verify_child — hash_chain FAIL at step 4
```

- Exit `0` on PASS, `1` on FAIL — scriptable, consistent with `verify`.
- The report never prints a key value or a raw SDK object (there are none in this offline path anyway).

**`fork` guardrail (exit 1):**

```
[blackbox error] Refusing to overwrite the parent trace at /abs/traces/example-trace.json. Pass an explicit --out.
```

---

## 5. Proposed file changes

**New:**
- `src/workflow/selfCheck.ts` — `runSelfCheck(opts?)` + `SelfCheckReport` / `SelfCheckStage` types. Composes
  `runAgentLoop`, `forkRun`, `diffTraces`, `verifyTrace`; in-memory by default. No new logic, only orchestration.
- `src/cli/format.ts` — `header(name)`, `label(s)`, `LABEL_WIDTH`. Presentation only.
- `tests/selfCheck.test.ts` — unit coverage for `runSelfCheck` (see §6).

**Edited (small, additive):**
- `src/cli.ts` — add the `check` subcommand (allow-list `--out-dir`/`--keep`, `runCheck`, usage text, switch
  case); add the overwrite guard in `runFork`; adopt `src/cli/format.ts` helpers where it does not change any
  asserted substring. No change to `record`/`replay`/`diff`/`verify`/`list`/`inspect` behavior.
- `tests/cli.test.ts` — add `check` PASS smoke (exit 0, prints `Result: PASS`, stage names), `check --out-dir`
  persistence smoke, `check --bogus` unknown-flag, and a `fork --trace X --out X` overwrite-guard exit-1 test.
- `DEMO.md`, `README.md` — test-count fix + canonical `check` workflow section + fork-guard note.
- `docs/08_build_log.md` — W4-G entry (at implementation time, not now).
- `AGENTS.md` — bump "Current Milestone" pointer to W4-G (at implementation time).

**Not touched (behavior unchanged):**
- `src/trace/hash.ts`, `src/trace/TraceTypes.ts`, `src/trace/TraceRecorder.ts`, `src/trace/verifyTrace.ts`,
  `src/trace/neutrality.ts`
- `src/replay/CassetteReplay.ts` (`loadTrace`/`validateTrace`/`replayTrace`)
- `src/fork/forkRun.ts`, `src/fork/diffTraces.ts`, `src/agent/*` (including `AnthropicModelClient`)
- `package.json` (no new script required — `check` runs under the existing `cli` script; no new dependency).
  Optionally a convenience `"example:check": "tsx src/cli.ts check"` alias **may** be added; decide at
  implementation time. Not required by acceptance.

---

## 6. Test plan

All offline, fake/deterministic, zero live calls.

**`tests/selfCheck.test.ts` (unit, in-process — no subprocess):**
- Happy path: `runSelfCheck()` returns `pass: true` with all five stages `pass`, in order.
- Determinism: two calls produce structurally identical stage reports (same names/statuses/details).
- In-memory default writes nothing to disk; the report still carries `parentTrace`/`childTrace`.
- Persistence: `runSelfCheck({ outDir })` writes exactly two cassettes that `loadTrace`+`validateTrace`
  successfully, and the child's `parentId` references the parent.
- The parent and child both pass `verifyTrace` independently (guards against the composed report masking a
  real per-trace failure).
- `diff` stage reports divergence at the mutation index with a non-empty, hash-identical shared prefix.

**`tests/cli.test.ts` (subprocess smokes):**
- `check` exits 0, prints `[blackbox] --- check ---`, `Result: PASS`, and each stage name.
- `check --out-dir <temp>` exits 0, writes the two cassettes, prints their paths; temp dir cleaned by the test.
- `check --bogus` exits 1 with `Unknown flag: --bogus`.
- `fork --trace <p> --out <p>` (same path) exits 1 with the "Refusing to overwrite the parent" message; the
  parent file is unchanged (assert bytes/hash equal before/after).
- `fork` on a `--trace` argument lacking `.json` whose derived `--out` would collide exits 1 with the same guard.

**Regression (must stay green, unchanged):**
- Every existing assertion in `tests/cli.test.ts` (`record`/`replay`/`fork`/`diff`/`verify`/`list`/`inspect`
  substrings: "success trace", "First divergence", "Summary:", "PASS", "Version:", "Unknown flag: --bogus",
  "Missing value for --trace", "3 of 5", etc.) — the `format.ts` adoption must **not** alter any of these.
- `tests/verifyTrace.test.ts`, `tests/replay.test.ts`, `tests/toolUseProofHelpers.test.ts`, and all other
  suites unchanged and passing. Target: 307 existing + new tests, all green, zero live calls.

---

## 7. Non-goals

- No web UI, dashboard, React, or any frontend.
- No hosted backend, remote cassette storage, auth, or sharing.
- No LangChain / LlamaIndex / MCP / agent framework.
- No Anthropic CLI wiring; no live tests; no new provider adapter; no `ANTHROPIC_API_KEY` path in `check`.
- No production SDK, metrics, OTEL export, or observability platform. `check` is a **self-test of the loop**,
  not a monitoring surface.
- No change to hashing, the trace schema, `validateTrace`, `replayTrace`, `loadTrace`, `forkRun`, `diffTraces`,
  or `verifyTrace` **semantics** — W4-G only *composes* and *formats* them.
- No positional-argument parser rework (flag-based `--out-dir`/`--keep` only, consistent with existing commands).
- No auto-repair/migration of cassettes; no new mutation modes; no new fork geometry.
- No `diff` exit-code-on-divergence change (would alter existing exit-0 contract and break current smokes).
- No committing of any trace artifact; `traces/` stays git-ignored, `check --out-dir` defaults must not target a
  committed path.

---

## 8. Rollback plan

W4-G is **purely additive and composition/presentation-only**:

- Revert `src/workflow/selfCheck.ts`, `src/cli/format.ts`, `tests/selfCheck.test.ts`, and the `check`
  subcommand block + the `runFork` overwrite guard + the `format.ts` adoption in `src/cli.ts`. Revert the
  `check`/fork-guard additions in `tests/cli.test.ts` and the doc edits.
- Because `hash.ts`, `validateTrace`, `replayTrace`, `loadTrace`, `forkRun`, `diffTraces`, and `verifyTrace` are
  untouched, reverting W4-G cannot affect `record`/`replay`/`fork`/`diff`/`verify` behavior. No cassette on disk
  is changed by `check` (in-memory by default; `--out-dir` writes only where told).
- If only the `format.ts` adoption is problematic, the minimal rollback is to keep the inline formatting in each
  `run*` function and have `check` format locally — no functional difference.
- If only the fork guard is too strict for some workflow, it can be relaxed to a warning without touching the
  composed command.

---

## 9. First implementation prompt

> Implement W4-G (Fork/Verify Workflow Polish) per `docs/19_week_four_g_plan.md`. Local TypeScript CLI/core
> only. Do NOT add live calls, CLI Anthropic wiring, a new provider adapter, a new dependency, or any product
> surface beyond what this plan specifies. Do NOT change the semantics of `hash.ts`, `validateTrace`,
> `replayTrace`, `loadTrace`, `forkRun`, `diffTraces`, or `verifyTrace`.
>
> 1. Create `src/workflow/selfCheck.ts`: `runSelfCheck(opts?)` returning a `SelfCheckReport` that runs the loop
>    **entirely in memory** by composing the existing fake/offline functions — `runAgentLoop`
>    (`FakeDeterministicModelClient` + `defaultToolExecutor()`, the demo success script), `verifyTrace` on the
>    parent, `forkRun` (tool-result mutation at the demo step), `verifyTrace` on the child, and `diffTraces`.
>    Stages run in order (`record → verify_parent → fork → verify_child → diff`), each recorded as pass/fail with
>    a human-readable detail; short-circuit is not required but the first failure must be identifiable. Persist
>    the parent + child cassettes only when `opts.outDir` is provided. Never make a live call; never print a key.
> 2. Create `src/cli/format.ts`: `header(name)`, `label(s)`, `LABEL_WIDTH`. Adopt these in `src/cli.ts` **without
>    changing any substring the existing tests assert on** (header text and label text stay identical).
> 3. Add a `check` subcommand to `src/cli.ts` (`--out-dir`/`--keep` allow-list, usage text, switch case) that
>    calls `runSelfCheck`, prints the §4 stage checklist + `Result: PASS/FAIL` (and persisted paths when
>    `--out-dir`), and exits 0 on PASS / 1 on FAIL. Do not change any existing subcommand's behavior.
> 4. Add the overwrite guard to `runFork`: after resolving `outPath`, if its normalized absolute path equals the
>    resolved `--trace` path, `die` with "Refusing to overwrite the parent trace …; pass an explicit --out."
> 5. Add `tests/selfCheck.test.ts` (unit) and extend `tests/cli.test.ts` (subprocess) per §6, including the
>    fork-guard exit-1 case and a bytes-unchanged assertion on the parent. Keep everything offline.
> 6. Update `DEMO.md` + `README.md` (test count 274→307; canonical `check` workflow section; fork-guard note),
>    add the `docs/08_build_log.md` W4-G entry, and bump the `AGENTS.md` "Current Milestone" pointer.
>
> Acceptance: `npm test -- --run` passes (307 existing + new, zero live calls); `record`/`replay`/`fork`/`diff`/
> `verify`/`list`/`inspect` unchanged and green; `check` exits 0 on PASS / 1 on FAIL; `fork` refuses to overwrite
> its parent; `package.json` gains no dependency; `traces/` stays git-ignored and no cassette is committed. Then
> summarize per the CLAUDE.md response format (files changed / real / mocked / tests / next safest task).

## 10. Codex audit prompt

> Audit the W4-G implementation against `docs/19_week_four_g_plan.md` and `AGENTS.md`. Verify:
>
> 1. **No behavior change** to `src/trace/hash.ts`, `validateTrace`, `replayTrace`, `loadTrace`, `forkRun`,
>    `diffTraces`, or `verifyTrace` — W4-G only *composes* and *formats* them. Confirm via diff.
> 2. **`check` cannot make a live call** — `runSelfCheck` runs in memory using only `FakeDeterministicModelClient`
>    + `defaultToolExecutor()` (like the demo); no `AnthropicModelClient`/provider import is reachable from the
>    self-check or the `check` subcommand; no `ANTHROPIC_API_KEY` path exists.
> 3. **`check` is side-effect-free by default** — with no `--out-dir` it writes nothing to disk; with `--out-dir`
>    it writes exactly the two named cassettes and prints their paths, and nothing is committed (`traces/`
>    git-ignored).
> 4. **Composition, not reimplementation** — `runSelfCheck` calls the existing `runAgentLoop`/`forkRun`/
>    `diffTraces`/`verifyTrace`; it does not duplicate hashing, replay, or diff logic.
> 5. **Fork overwrite guard** — `fork` refuses (exit 1, clear message) when the resolved `--out` equals the
>    resolved `--trace`, including the no-`.json`-suffix collision; the parent file is byte-unchanged after a
>    rejected fork. Read-only commands are unaffected.
> 6. **Output consistency without regression** — the `src/cli/format.ts` adoption changed no substring asserted
>    by existing tests; header/label text is identical; `check` uses the shared helper. `check` exits 0 on PASS,
>    1 on FAIL, matching `verify`'s scriptable contract.
> 7. **Guardrails held** — `npm test -- --run` passes with zero live calls; `record`/`replay`/`fork`/`diff`/
>    `verify`/`list`/`inspect` unchanged; `package.json` gained no dependency; no new provider adapter, no CLI
>    Anthropic wiring, no live tests, no observability surface; docs match what shipped (test count, `check`
>    workflow, fork-guard note) with no overclaim.
>
> Report any drift between the plan, the docs, and the code before the milestone is tagged.
