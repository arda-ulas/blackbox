# W6-C Plan — Release Freeze + README/DEMO Verification

**Status:** PLANNED (awaiting Codex audit before implementation). This document is the scoped, plan-only
deliverable. No source, test, fixture, config, runtime, CLI, or provider change is made by writing it.
**Predecessor:** W6-B complete, pushed, tagged `week-six-verify-replay-explanations` (HEAD `7edfb29`). The full
core loop is implemented, hardened, composed under one self-check, proven live (opt-in), frozen against a committed
regression corpus, and documented: `record → replay → fork → mutate → continue → diff → verify → check`. Tests:
**394/394** offline, zero live calls.
**Mode:** documentation / repo-readiness verification only. **No change to canonical hashing, trace schema, replay
semantics, fixture bytes, provider adapters, the CLI surface, or any runtime behaviour.** No live calls, no CLI
Anthropic wiring, no new provider adapter, no product-surface expansion, no new dependency, no new CLI flag,
command, or exit code.

---

## 1. Problem statement

After W6-A (diff/inspect legibility) and W6-B (verify failure explanations), the local technical core is strong
enough to demo. The remaining gap is not a missing capability — it is **trust in the public surface.** The two
front-door documents a reader actually runs (`README.md`, `DEMO.md`) have drifted from the repo since they were
last authored at W5-B (360/360, `week-five-trace-fixture-corpus`):

Concrete drift found during planning (inventory, not yet fixed — this plan is plan-only):

1. **Stale test count.** `README.md` cites `360/360` (Status line and the "For reviewers" four-command block) and
   `DEMO.md` cites `360 tests` (Prerequisites). The true baseline is **394/394** (W6-A +21, W6-B +13 over the 360
   W5-A baseline).
2. **Stale status headline + latest tag.** `README.md` Status reads **"Post-W5-A. Ready for W5-B
   (docs/repo-readiness)."** with **"Latest tag: `week-five-trace-fixture-corpus` (W5-A …)"**. The true HEAD is
   `week-six-verify-replay-explanations` (W6-B), with W5-B, W6-A, W6-B all closed and tagged.
3. **Incomplete build history.** `README.md`'s per-milestone "Build history" ends at "Week-Five Regression
   Hardening (`week-five-trace-fixture-corpus`)" — it has no W5-B, W6-A, or W6-B section, so a reader cannot see
   that diff legibility and verify explanations shipped.
4. **Core-loop string drift in DEMO.** `DEMO.md`'s opening paragraph (line ~3) states the loop as
   `record → replay → fork → mutate → continue → diff`, omitting `→ verify → check`, even though the walkthrough now
   includes verify (step 7), check (step 8), and fixtures (step 9). `README.md` already states the full loop; the
   two front-door docs disagree.

Critically, **every command shown in both docs is accurate and exists.** `record`, `replay`, `fork`, `diff`,
`verify`, `check`, `list`, `inspect` are all dispatched in `src/cli.ts`; `fixtures:generate`, `cli`, and the three
`example:real-*` proof scripts are all real `package.json` scripts. The flag names, default paths, and exit-code
claims match the implementation. So the drift is confined to **numeric / status / tag / narrative claims**, not to
runnable commands — which keeps W6-C docs-only.

None of these are correctness bugs in the product. They are **readiness bugs on the public surface** — the exact
thing that erodes a skeptical reviewer's trust when they clone the repo, run the commands, and see counts that do
not match the docs.

---

## 2. Why W6-C is the next smallest milestone

- **The core is already strong; a new capability is not the smallest move.** W6-A and W6-B made both outcomes of the
  debugger's central artifact legible. The next smallest useful step is not more capability — it is making the
  current surface *trustworthy and repeatable* so the project can be shared without drift.
- **It changes no runtime and no data.** Like W5-B, this is a documentation / repo-readiness pass. Every source
  file, test, fixture byte, frozen hash, and `package.json` script stays untouched. This is the lowest-risk
  category of change available — strictly lower than W6-A/W6-B, which at least touched presentation code.
- **It is fully verifiable offline against the repo itself.** Every claim in the docs can be checked against
  `package.json` (scripts), `src/cli.ts` (subcommands/flags), `git tag`/`git log` (tags/HEAD), and a single
  `npm test -- --run` (count). No live call, no new fixture, no judgement call.
- **It closes a real, found gap.** The drift in §1 is not hypothetical — it is inventoried above. A reader running
  the "For reviewers" path today is told 360 tests and sees 394. Fixing that is the definition of readiness.
- **Everything larger is out of scope or unscoped.** A second provider adapter, any UI, an npm publish, or a new
  CLI surface all require their own audited plan. Freezing and verifying the current demo surface is the smallest
  step that increases shareability without touching any of them.

---

## 3. Design: verify every public claim against the repo, then reconcile docs to reality

The work has two phases. **Phase A is read-only verification** (produce the matrix in §5, confirming which claims
match and which drift). **Phase B is a minimal docs reconciliation** — edit `README.md` / `DEMO.md` *only* where
Phase A proved a claim stale, plus append the build-log entry. No command, flag, path, or exit-code claim is
expected to change (Phase A is expected to confirm them all correct); only the four drift classes in §1 are
expected to need edits.

### 3.1 Command verification is evidence-based, not asserted

For every command shown in `README.md` and `DEMO.md`, the implementer confirms it against a concrete source of
truth: `npm run *` scripts against `package.json`; `npm run cli -- <sub>` subcommands and their flags against the
`src/cli.ts` allow-lists and dispatch switch; default file paths against the command bodies; exit-code claims
against the `process.exit` / `die` calls. The matrix in §5 is the artifact; a command may not be marked verified on
assertion alone.

### 3.2 Docs are reconciled to reality, never reality to docs

Where a doc claim and the repo disagree, **the repo wins** and the doc is corrected — never the reverse. The only
edits permitted are: (a) the stale test count `360 → 394` wherever it appears; (b) the README Status headline +
latest-tag line advanced to the W6-B state; (c) new README build-history sections for W5-B, W6-A, W6-B; (d) the
DEMO opening core-loop string extended to `… → diff → verify → check`; (e) the appended build-log entry. If Phase A
uncovers a *command* mismatch that cannot be fixed by docs (not expected), the work **stops** and a separate,
Codex-audited source-fix plan is written — W6-C does not silently patch runtime code.

### 3.3 A release-freeze checklist is captured in this plan (§6)

The "freeze" is a definition, not a new artifact: a short, repeatable checklist (§6) that asserts the exact
repo state the public docs are allowed to claim at this tag. It lives in this plan first. A separate
`docs/24_week_six_c_release_checklist.md` is created **only if** the checklist proves too large to live inline
(not expected; see §11).

### 3.4 No new CLI surface, no runtime change (both explicit)

W6-C adds **no** CLI flag, command, or exit code, and changes **no** source, test, fixture, or config file except
the documentation files enumerated in §7. The freeze verifies the *existing* surface; it does not extend it.

---

## 4. Exact acceptance criteria

An implementation of W6-C is accepted only if **all** of the following hold:

1. **Every documented command verified.** Every command in `README.md` and `DEMO.md` appears in the §5 matrix with
   a concrete evidence source (script in `package.json`, subcommand/flag in `src/cli.ts`, or path/exit-code in the
   command body) and a PASS. No command is marked verified by assertion.
2. **Test count truthful everywhere.** No doc states a stale test total. Every count reads **394/394** (or the exact
   number `npm test -- --run` reports at implementation time, if a later same-scope doc-only commit changed it —
   the number must match the suite, whatever it is).
3. **Status + latest tag truthful.** `README.md` Status names the current milestone state (post-W6-B) and
   `week-six-verify-replay-explanations` as the latest tag; no doc claims `week-five-trace-fixture-corpus` is HEAD.
4. **Build history complete.** `README.md`'s build-history section has accurate W5-B, W6-A, and W6-B entries in
   milestone order, consistent with `docs/08_build_log.md` and the tag set.
5. **Core loop stated consistently.** Both `README.md` and `DEMO.md` state the loop as
   `record → replay → fork → mutate → continue → diff → verify → check` in their front-matter narrative.
6. **No command/flag/path/exit-code claim changed.** The only doc edits are the drift classes in §1 (count, status,
   tag, build-history, core-loop string) plus the build-log entry. No command invocation, flag name, default path,
   or exit-code claim is altered (Phase A confirms them already correct).
7. **Release-freeze checklist present and green.** The §6 checklist is executed and every line passes at the
   implementation commit; the outcome is recorded in the build-log entry.
8. **Offline + green, unchanged.** `npm test -- --run` passes at **394** (or the then-current true count), zero live
   calls, no API key required. `npm run cli -- check` PASS. `npm run fixtures:generate` check mode reports the
   corpus in sync. `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard.
9. **No frozen artifact touched.** No fixture byte changes; no frozen hash constant in `tests/fixtures.test.ts` is
   edited; `git ls-files traces` stays empty. `hash.ts`, `TraceStepHashInput`, `CURRENT_TRACE_VERSION`,
   `Trace`/`TraceStep`/`TraceStepType`, `validateTrace`, `replayTrace`, `forkRun`, `diffTraces`, `verifyTrace`,
   `selfCheck`, `cli.ts`, and all provider/adapter code are untouched.
10. **No new dependency / surface.** `package.json` / `package-lock.json` gain no dependency or script. No UI,
    backend, dashboard, observability, or Anthropic CLI wiring.
11. **Docs-only diff.** `git diff --name-only` at the implementation commit shows only documentation files:
    `README.md`, `DEMO.md`, `docs/08_build_log.md`, this plan's status header, and (only if §11 triggers)
    `docs/24_week_six_c_release_checklist.md`. No file under `src/`, `tests/`, `scripts/`, or `fixtures/`.
12. **Historical counts preserved.** Prior milestone entries keep their historical counts (e.g. W4-G 321, W5-A 360,
    W6-A 381, W6-B 394); only *current-state* headlines are advanced. No historical build-log entry is rewritten.

---

## 5. Command verification matrix

The implementer fills the **Result** column from concrete evidence during Phase A. The **Evidence** column names
the source of truth. Expected result at the current HEAD is PASS for every row (all commands confirmed present
during planning); the matrix is the artifact that *proves* it rather than asserting it.

| # | Documented command | Shown in | Evidence source | Expected |
|---|---|---|---|---|
| 1 | `npm install` | README, DEMO | standard npm | PASS |
| 2 | `npm test -- --run` | README, DEMO | `test` script (`vitest`) in `package.json` | PASS (count must read 394) |
| 3 | `npm run cli -- record` | README, DEMO | `cli` script + `record` case in `src/cli.ts` | PASS |
| 4 | `npm run cli -- list` | README, DEMO | `list` case + `LIST_ALLOWED` | PASS |
| 5 | `npm run cli -- inspect` | README, DEMO | `inspect` case + `INSPECT_ALLOWED` | PASS |
| 6 | `npm run cli -- replay` | README, DEMO | `replay` case + `REPLAY_ALLOWED` | PASS |
| 7 | `npm run cli -- fork` | README, DEMO | `fork` case + `FORK_ALLOWED` + default `-fork.json` path | PASS |
| 8 | `npm run cli -- diff --parent … --child …` | README, DEMO | `diff` case + `DIFF_ALLOWED` (`--parent`/`--child` required) | PASS |
| 9 | `npm run cli -- verify --trace …` | README, DEMO | `verify` case + `VERIFY_ALLOWED` + exit 0/1 | PASS |
| 10 | `npm run cli -- check` | README, DEMO | `check` case + `CHECK_ALLOWED` (`--out-dir`) | PASS |
| 11 | `npm run cli -- check --out-dir <dir>` | DEMO | `runCheck` persisted mode | PASS |
| 12 | `npm run fixtures:generate` | README, DEMO | `fixtures:generate` script (check mode default) | PASS |
| 13 | `npm run fixtures:generate -- --write` | README | `scripts/generateFixtures.ts` `--write` branch | PASS (documented as deliberate-only) |
| 14 | `npm run example:real-proof` | DEMO | `example:real-proof` script (opt-in, key-gated) | PASS (existence; not run) |
| 15 | `npm run example:real-tooluse-proof` | DEMO | `example:real-tooluse-proof` script | PASS (existence; not run) |
| 16 | `npm run example:real-fork-proof` | DEMO, README-adjacent | `example:real-fork-proof` script | PASS (existence; key-guard exit only) |

Additional claim checks (non-command, still verified against the repo):

| Claim | Source of truth | Expected |
|---|---|---|
| "15 steps" success trace | `record` success scenario in `src/cli.ts` + DEMO inspect timeline | PASS |
| "5 steps" error trace | `record` error scenario | PASS |
| "7 steps" child fork | fork demo path | PASS |
| "First divergence at index 3" / "shared prefix 3" | `diffTraces` over the demo/fork pair | PASS |
| "5 fixture(s)" corpus | `fixtures/traces/` file count + `FIXTURE_MANIFEST` | PASS |
| verify PASS block wording | `runVerify` output in `src/cli.ts` | PASS |
| verify FAIL labelled block (`Failure` / `invariant:` / `action:`) | `formatVerifyFailure` (W6-B) | PASS |
| Latest tag = `week-six-verify-replay-explanations` | `git tag` / `git log --decorate` | PASS after §7 edit |
| Test total = 394/394 | `npm test -- --run` | PASS after §7 edit |

The live proof scripts (rows 14–16) are verified for **existence only** — they are opt-in, key-gated, and never run
by this milestone (row 16's key-guard exit may be exercised without a key, as prior milestones do).

---

## 6. Release-freeze definition (checklist)

The "freeze" is this repeatable checklist. It asserts the exact repo state the public docs are allowed to claim at
the W6-C tag. Every line must pass at the implementation commit and the result is recorded in the build-log entry.

**Repo state**
- [ ] Working tree clean; on `master`; HEAD aligned with `origin/master`.
- [ ] `git ls-files traces` is empty (no cassette committed); `git ls-files fixtures/traces` lists exactly the five
      committed fixtures.
- [ ] `git tag --list "week-*"` contains all closed tags through `week-six-verify-replay-explanations`.

**Test + loop**
- [ ] `npm test -- --run` → **394/394** (or the then-true count), zero live calls, no API key present.
- [ ] `npm run cli -- check` → PASS.
- [ ] `npm run fixtures:generate` (check mode) → corpus in sync, writes nothing.
- [ ] `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` → exits at the key guard (no live call).

**Docs truthful**
- [ ] Every command in the §5 matrix marked PASS with evidence.
- [ ] Test count in `README.md` + `DEMO.md` matches the suite (394).
- [ ] `README.md` Status names the post-W6-B state and `week-six-verify-replay-explanations` as latest tag.
- [ ] `README.md` build history has W5-B, W6-A, W6-B entries in order.
- [ ] `README.md` and `DEMO.md` both state the full loop `record → replay → fork → mutate → continue → diff →
      verify → check`.
- [ ] No doc claims a command, flag, path, or exit code the repo does not implement.

**Guardrails**
- [ ] `package.json` / `package-lock.json` unchanged; no new dependency or script.
- [ ] `git diff --name-only` shows documentation files only.
- [ ] No source/test/fixture/config change.

Passing every line is the definition of "release-frozen at W6-C." Any failing line blocks the tag.

---

## 7. Docs update plan

Edits are the **minimum** needed to reconcile the §1 drift; nothing else in these files is touched.

- **`README.md`**
  - **Status section** — advance the headline from "Post-W5-A. Ready for W5-B (docs/repo-readiness)." to the
    post-W6-B state; change "Latest tag: `week-five-trace-fixture-corpus` (W5-A …)" to
    `week-six-verify-replay-explanations` (W6-B) with a one-line descriptor; change "Tests: 360/360" to
    "Tests: 394/394".
  - **"For reviewers" block** — change the `npm test -- --run # 360 tests` comment to `# 394 tests`.
  - **"Build history"** — append three sections in order: **Week-Five Public Demo Readiness
    (`week-five-public-demo-readiness`)**, **Week-Six Diff/Inspect Ergonomics (`week-six-diff-inspect-ergonomics`)**,
    **Week-Six Verify/Replay Explanations (`week-six-verify-replay-explanations`)** — each a short, accurate bullet
    list consistent with the build-log entries. No prior section is rewritten.
  - Optionally add one line to "What it proves" noting divergence and verify-failure legibility (W6-A/W6-B) — only
    if it stays accurate and adds no overclaim; skip if it risks bloat.
- **`DEMO.md`**
  - **Opening paragraph (line ~3)** — extend the core-loop string to
    `record → replay → fork → mutate → continue → diff → verify → check`.
  - **Prerequisites (line ~13)** — change `npm test -- --run # 360 tests` to `# 394 tests`.
  - No step body, command, flag, path, or expected-output block changes (Phase A confirms them accurate; W6-A/W6-B
    already refreshed the diff and verify blocks).
- **`docs/08_build_log.md`** — append a `2026-… — Week Six W6-C (release freeze + README/DEMO verification)` entry
  following the established What Was Built / Outcome / Guardrails Held structure, recording the matrix result, the
  freeze-checklist pass, and the exact doc edits.
- **`README.md` / `DEMO.md` command lists** — unchanged in count and order; only the inline comments/claims above
  change.
- **`AGENTS.md` / `CLAUDE.md`** — current-state pointer refresh at closeout only (advance the "current milestone"
  line and closed-tag set), consistent with prior milestones; no guardrail or invariant change. *(Optional at
  closeout; not required for the matrix/freeze work itself.)*
- **`docs/03_trace_schema.md`** — no change (schema untouched; hard requirement).

---

## 8. Test plan

W6-C writes no test code — the "tests" are the offline verification commands run against the repo, plus the
unchanged suite proving nothing regressed.

1. **Suite unchanged and green.** `npm test -- --run` passes at **394** (or the then-true count), zero live calls,
   no API key. The number the suite reports is the number the docs must state (criterion §4.2).
2. **Full-loop smoke.** `npm run cli -- check` → PASS; `npm run fixtures:generate` (check mode) → in sync;
   `tests/fixtures.test.ts` unmodified and passing.
3. **Command matrix executed.** Each §5 row confirmed against its evidence source; the live proof rows confirmed
   for existence (`example:real-fork-proof` exercised only to its key-guard exit, no live call).
4. **Freeze checklist executed.** Every §6 line passes; the result is captured in the build-log entry.
5. **Docs-only diff asserted.** `git diff --name-only` shows documentation files only (criterion §4.11).
6. **No frozen artifact touched.** `git ls-files traces` empty; `git ls-files fixtures/traces` lists the five
   fixtures unchanged; no frozen hash constant edited.

Target: baseline **394/394**, unchanged, all green, zero live calls. W6-C adds no test and removes none.

---

## 9. Non-goals (explicit)

- **No source, runtime, or CLI change.** `src/**`, including `cli.ts`, is off-limits. No new flag, command, or exit
  code (no `--json`, no `--freeze`). If Phase A finds a real command mismatch fixable only in source, the work
  **stops** and a separate, Codex-audited plan is written (see §3.2).
- **No test or fixture change.** `tests/**`, `scripts/**`, `fixtures/**` are unchanged. No new test, no fixture
  rewrite, no frozen-hash edit.
- **No `package.json` / `package-lock.json` change.** No new dependency, script, `bin` entry, or version bump. No
  npm publish.
- **No `.gitignore` change.**
- **No canonical-hash or trace-schema change.** `hash.ts`, `TraceStepHashInput`, `CURRENT_TRACE_VERSION`,
  `Trace`/`TraceStep`/`TraceStepType` are frozen.
- **No provider adapter change and no Anthropic CLI wiring.** No live proof run as part of this milestone (existence
  and key-guard checks only).
- **No UI, backend, dashboard, or observability/metrics surface.**
- **No new product capability.** No eval platform, prompt management, production SDK, or multi-agent work.
- **No rewrite of historical docs.** Prior milestone build-log/README entries and their historical counts are
  preserved verbatim; only current-state headlines advance.

---

## 10. Rollback plan

- **Isolated blast radius.** Changes are confined to documentation files (`README.md`, `DEMO.md`,
  `docs/08_build_log.md`, this plan's status header, optional `AGENTS.md`/`CLAUDE.md` pointer refresh). No source,
  test, fixture, hash, schema, or on-disk cassette is affected.
- **Single-commit revert.** The reconciliation lands as one commit (the plan lands as its own prior commit);
  `git revert <sha>` restores the previous docs verbatim. Because no code, hash, schema, or fixture changed, revert
  is total — no regeneration needed.
- **Tripwires.** `tests/fixtures.test.ts` (frozen hashes) and `npm run fixtures:generate` (check mode) fail loudly
  if the change accidentally touches hashing or a fixture. `git diff --name-only` showing any non-doc file is an
  immediate signal to stop — criterion §4.11 forbids it.
- **No external state.** Nothing is pushed, tagged, deployed, or sent to any provider by this milestone, so rollback
  is purely local.

---

## 11. When to add a separate release-checklist file

The §6 checklist lives in this plan by default. Create `docs/24_week_six_c_release_checklist.md` **only if** during
implementation the checklist grows enough that keeping it inline harms this plan's readability, *or* the human wants
a standalone, copy-pasteable pre-tag runbook. If created, it is a verbatim lift of §6 plus the §5 matrix — it adds
no new assertion and changes no scope. Absent that trigger, no new file is created (default expectation: not
needed).

---

## 12. First implementation prompt

> Implement W6-C (release freeze + README/DEMO verification) exactly as scoped in `docs/24_week_six_c_plan.md`.
> Documentation / verification only — do not touch any file under `src/`, `tests/`, `scripts/`, or `fixtures/`, and
> do not change `package.json`, `package-lock.json`, or `.gitignore`.
>
> 1. **Phase A — verify (read-only).** For every command in `README.md` and `DEMO.md`, confirm it against its source
>    of truth: `npm run *` scripts against `package.json`; `npm run cli -- <sub>` subcommands/flags against the
>    `src/cli.ts` allow-lists and dispatch switch; default paths and exit codes against the command bodies. Record
>    the result in the §5 matrix. Run `npm test -- --run` and note the exact total. Run `npm run cli -- check`,
>    `npm run fixtures:generate` (check mode), and `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof`
>    (key-guard exit). Execute the §6 freeze checklist.
> 2. **Phase B — reconcile (docs only).** Edit `README.md` and `DEMO.md` *only* for the proven drift: the stale test
>    count `360 → 394` (or the true suite count) everywhere it appears; the README Status headline + latest-tag line
>    advanced to the W6-B state (`week-six-verify-replay-explanations`); new README build-history sections for W5-B,
>    W6-A, W6-B in order; the DEMO opening core-loop string extended to `… → diff → verify → check`. Do not change
>    any command, flag, path, or expected-output block. Append a W6-C build-log entry recording the matrix result
>    and the freeze-checklist pass. Optionally refresh the `AGENTS.md`/`CLAUDE.md` current-state pointers at
>    closeout.
> 3. If Phase A uncovers a real *command* mismatch that cannot be fixed by docs, **stop** and write a separate,
>    Codex-audited source-fix plan — do not patch runtime code under this milestone.
>
> Acceptance gate: `npm test -- --run` green at the count the docs now state (zero live calls, no key),
> `npm run cli -- check` PASS, `npm run fixtures:generate` check mode in sync,
> `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard, `git ls-files traces` empty,
> `package.json` unchanged, `git diff --name-only` shows documentation files only, every §5 matrix row PASS, every
> §6 freeze line green. Then report: files changed / what is real / what is mocked / tests pass / next safest task.
> Do not push or tag.

---

## 13. Codex audit prompt

> Audit the W6-C plan in `docs/24_week_six_c_plan.md` (and, once implemented, the diff) as a repo-aware reviewer
> before it is accepted for implementation / before tag. Confirm specifically:
>
> 1. **Docs-only.** No change to any file under `src/`, `tests/`, `scripts/`, `fixtures/`, or to `package.json` /
>    `package-lock.json` / `.gitignore`. `git diff --name-only` shows documentation files only.
> 2. **Every documented command is real.** Each command in `README.md`/`DEMO.md` maps to an actual `package.json`
>    script or `src/cli.ts` subcommand/flag; no doc claims a command, flag, path, or exit code the repo does not
>    implement. The §5 matrix is complete and evidence-backed.
> 3. **Counts/tags/status truthful.** Every test count matches `npm test -- --run` (394 at HEAD); the README Status
>    and latest-tag line name `week-six-verify-replay-explanations`; no doc claims `week-five-trace-fixture-corpus`
>    is HEAD; the build history has accurate W5-B/W6-A/W6-B entries.
> 4. **Core loop stated consistently.** Both front-door docs state `record → replay → fork → mutate → continue →
>    diff → verify → check`.
> 5. **No overclaim.** No doc asserts a live-by-default path, a shipped/published package, a UI/backend/dashboard,
>    or a capability the code does not prove. Anthropic proofs remain described as opt-in, human-run,
>    never-in-`npm test`, never-CLI-wired.
> 6. **Frozen artifacts intact.** No fixture byte or frozen-hash change; `git ls-files traces` empty;
>    `git ls-files fixtures/traces` lists the five committed fixtures unchanged.
> 7. **Historical record preserved.** Prior milestone entries and their historical counts are unchanged; only
>    current-state headlines advanced.
> 8. **Freeze checklist sound.** The §6 checklist actually asserts the state the public docs claim, and every line
>    passed at the implementation commit (recorded in the build log).
> 9. **Guardrails held.** No UI/backend/dashboard/observability, no Anthropic CLI wiring, no live call, no new
>    provider adapter, no new dependency, no schema/hash change, no new CLI surface, no product-surface expansion.
>
> Report any scope creep (especially any touch to source/tests/fixtures, any new dependency or CLI surface, or any
> doc claim not backed by the repo) as a blocker.
