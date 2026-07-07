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

Where a doc claim and the repo disagree, **the repo wins** and the doc is corrected — never the reverse. The
permitted edits are: (a) the stale test count `360 → 394` wherever it appears; (b) the README Status headline +
tag lines advanced to the W6-B/W6-C state with the durable tag wording of §3.5; (c) new README build-history
sections for W5-B, W6-A, W6-B (and a W6-C release-freeze note); (d) the DEMO opening core-loop string extended to
`… → diff → verify → check`; (e) the appended build-log entry; and (f) the **required** current-state pointer
refresh in `AGENTS.md` and `CLAUDE.md` (§3.6). If Phase A uncovers a *command* mismatch that cannot be fixed by docs
(not expected), the work **stops** and a separate, Codex-audited source-fix plan is written — W6-C does not silently
patch runtime code.

### 3.3 A release-freeze checklist is captured in this plan (§6)

The "freeze" is a definition, not a new artifact: a short, repeatable checklist (§6) that asserts the exact
repo state the public docs are allowed to claim at this tag. It lives in this plan first. A separate
`docs/24_week_six_c_release_checklist.md` is created **only if** the checklist proves too large to live inline
(not expected; see §11).

### 3.4 No new CLI surface, no runtime change (both explicit)

W6-C adds **no** CLI flag, command, or exit code, and changes **no** source, test, fixture, or config file except
the documentation files enumerated in §7. The freeze verifies the *existing* surface; it does not extend it.

### 3.5 Durable tag wording (survives W6-C's own tag)

W6-C is expected to land its own release-freeze tag: **`week-six-release-freeze`**. Naming
`week-six-verify-replay-explanations` as "latest tag" in `README.md` would therefore become false the moment W6-C is
tagged. To stay true *after* W6-C tagging, the README must distinguish the two:

- **Latest release-freeze tag:** `week-six-release-freeze` (this milestone; the frozen, verified public surface).
- **Latest technical-capability tag before release-freeze:** `week-six-verify-replay-explanations` (W6-B — the last
  behaviour-changing milestone).

Any equivalent wording is acceptable provided it remains literally true after `week-six-release-freeze` exists. The
README must **not** call `week-six-verify-replay-explanations` "the latest tag" unqualified. Because the release-freeze
tag is created only at closeout (after push), the doc edit lands referencing `week-six-release-freeze` as the
intended release-freeze tag; §6-B's post-push checklist confirms the tag actually points at HEAD.

### 3.6 `AGENTS.md` and `CLAUDE.md` are required, not optional

W6-C is a **release-freeze + repo-truth** milestone, so the two agent-facing state files must also tell the truth.
Both currently carry stale current-state language: `AGENTS.md` still says "Current State: W5-B docs/repo-readiness"
and cites `360/360`; `CLAUDE.md` still describes the "Post-W5-A. W5-B in progress" state with `360/360` and a
W5-B-scoped "Next Safest Task". Reconciling them is **in required scope** for W6-C (a narrow current-state pointer
refresh only — the same category of edit prior milestones made at closeout, now mandatory rather than optional).
Guardrails, build-scope rules, the agent-role table, invariants, technical rules, response-format sections, and all
historical milestone entries (including their historical counts) are preserved verbatim in both files.

---

## 4. Exact acceptance criteria

An implementation of W6-C is accepted only if **all** of the following hold:

1. **Every documented command verified.** Every command in `README.md` and `DEMO.md` appears in the §5 matrix with
   a concrete evidence source (script in `package.json`, subcommand/flag in `src/cli.ts`, or path/exit-code in the
   command body) and a PASS. No command is marked verified by assertion.
2. **Test count truthful everywhere.** No doc states a stale test total. Every count reads **394/394** (or the exact
   number `npm test -- --run` reports at implementation time, if a later same-scope doc-only commit changed it —
   the number must match the suite, whatever it is).
3. **Status + tag wording truthful and durable.** `README.md` Status names the current milestone state (W6-C
   release-freeze, post-W6-B) and uses the §3.5 durable tag wording — **latest release-freeze tag:**
   `week-six-release-freeze`; **latest technical-capability tag before release-freeze:**
   `week-six-verify-replay-explanations`. No doc calls `week-six-verify-replay-explanations` "the latest tag"
   unqualified, and no doc claims `week-five-trace-fixture-corpus` is HEAD.
4. **Build history complete.** `README.md`'s build-history section has accurate W5-B, W6-A, and W6-B entries in
   milestone order (plus a W6-C release-freeze note), consistent with `docs/08_build_log.md` and the tag set.
5. **Core loop stated consistently.** Both `README.md` and `DEMO.md` state the loop as
   `record → replay → fork → mutate → continue → diff → verify → check` in their front-matter narrative.
6. **`AGENTS.md` and `CLAUDE.md` reconciled (required).** Both agent-facing state files are truthful at closeout:
   - **W6-B closed and tagged** `week-six-verify-replay-explanations`.
   - **W6-C (release-freeze + README/DEMO verification) is the current milestone**, tagged `week-six-release-freeze`
     at closeout.
   - **Current baseline is 394/394** (or the then-true suite count) wherever a *current* count appears.
   - **No stale W5-A / W5-B current-state language** remains (no "Current State: W5-B", no "Post-W5-A. W5-B in
     progress", no W5-B-scoped "Next Safest Task").
   - **No stale current `360/360`** where the current state should read 394/394.
   - **Guardrails, build-scope rules, the agent-role table, invariants, technical rules, and response-format
     sections are preserved verbatim**; all **historical milestone entries and their historical counts are
     unchanged** — only current-state pointers/counts/next-step lines advance.
7. **No command/flag/path/exit-code claim changed.** The only doc edits are the drift classes in §1 (count, status,
   tag, build-history, core-loop string), the §3.6 `AGENTS.md`/`CLAUDE.md` pointer refresh, and the build-log entry.
   No command invocation, flag name, default path, or exit-code claim is altered (Phase A confirms them already
   correct).
8. **Release-freeze checklists present and green.** The §6-A local pre-push checklist passes at the implementation
   commit; the §6-B post-push/tag checklist passes at closeout. Both outcomes are recorded in the build-log entry.
9. **Offline + green, unchanged.** `npm test -- --run` passes at **394** (or the then-current true count), zero live
   calls, no API key required. `npm run cli -- check` PASS. `npm run fixtures:generate` check mode reports the
   corpus in sync. `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard.
10. **No frozen artifact touched.** No fixture byte changes; no frozen hash constant in `tests/fixtures.test.ts` is
    edited; `git ls-files traces` stays empty. `hash.ts`, `TraceStepHashInput`, `CURRENT_TRACE_VERSION`,
    `Trace`/`TraceStep`/`TraceStepType`, `validateTrace`, `replayTrace`, `forkRun`, `diffTraces`, `verifyTrace`,
    `selfCheck`, `cli.ts`, and all provider/adapter code are untouched.
11. **No new dependency / surface.** `package.json` / `package-lock.json` gain no dependency or script. No UI,
    backend, dashboard, observability, or Anthropic CLI wiring.
12. **Docs-only diff.** `git diff --name-only` at the implementation commit shows only the allowed documentation
    files: `README.md`, `DEMO.md`, `AGENTS.md`, `CLAUDE.md`, `docs/08_build_log.md`, `docs/24_week_six_c_plan.md`
    (status header), and (only if §11 triggers) `docs/24_week_six_c_release_checklist.md`. No file under `src/`,
    `tests/`, `scripts/`, or `fixtures/`, and no `package.json` / `package-lock.json` / `.gitignore`.
13. **Historical counts preserved.** Prior milestone entries keep their historical counts (e.g. W4-G 321, W5-A 360,
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
| Tag wording durable (§3.5): release-freeze `week-six-release-freeze`; last capability tag `week-six-verify-replay-explanations` | `git tag` / `git log --decorate` | PASS after §7 edit (release-freeze tag confirmed by §6-B post-push) |
| Test total = 394/394 | `npm test -- --run` | PASS after §7 edit |
| `AGENTS.md` / `CLAUDE.md` current-state truthful | file contents vs. tags/count | PASS after §7 edit |

The live proof scripts (rows 14–16) are verified for **existence only** — they are opt-in, key-gated, and never run
by this milestone (row 16's key-guard exit may be exercised without a key, as prior milestones do).

---

## 6. Release-freeze definition (checklist)

The "freeze" is a repeatable checklist in **two phases**, because W6-C is audited locally *before* push. Phase A is
the gate for the local closeout (the working tree is expected to be **ahead** of `origin/master` by the W6-C
commit(s), not aligned). Phase B is the gate applied *after* push and tag, when HEAD/origin/tag alignment becomes
required. Both outcomes are recorded in the build-log entry.

### 6-A. Local pre-push closeout (at the implementation commit, before push/tag)

**Repo state (local)**
- [ ] Working tree clean.
- [ ] On branch `master`.
- [ ] Branch is **ahead of `origin/master` by exactly the W6-C implementation/docs commit(s)** and by nothing else
      (do not require HEAD = origin here — the commit is not pushed yet).
- [ ] `git ls-files traces` is empty; `git ls-files fixtures/traces` lists exactly the five committed fixtures.

**Test + loop**
- [ ] `npm test -- --run` → **394/394** (or the then-true count), zero live calls, no API key present.
- [ ] `npm run cli -- check` → PASS.
- [ ] `npm run fixtures:generate` (check mode) → corpus in sync, writes nothing.
- [ ] `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` → exits at the key guard (no live call).

**Docs truthful**
- [ ] Every command in the §5 matrix marked PASS with evidence.
- [ ] Test count in `README.md`, `DEMO.md`, `AGENTS.md`, `CLAUDE.md` matches the suite (394) wherever a *current*
      count appears; historical counts unchanged.
- [ ] `README.md` Status uses the §3.5 durable tag wording (release-freeze `week-six-release-freeze`; last
      capability tag `week-six-verify-replay-explanations`) — not "latest tag = W6-B" unqualified.
- [ ] `README.md` build history has W5-B, W6-A, W6-B entries in order (plus a W6-C release-freeze note).
- [ ] `README.md` and `DEMO.md` both state the full loop `record → replay → fork → mutate → continue → diff →
      verify → check`.
- [ ] `AGENTS.md` and `CLAUDE.md` current-state pointers name W6-C as current and W6-B (`week-six-verify-replay-
      explanations`) as the last closed capability tag; no stale W5-A/W5-B current-state language remains.
- [ ] No doc claims a command, flag, path, or exit code the repo does not implement.

**Guardrails (no forbidden files changed)**
- [ ] `package.json` / `package-lock.json` / `.gitignore` unchanged; no new dependency or script.
- [ ] `git diff --name-only` shows only the allowed docs (`README.md`, `DEMO.md`, `AGENTS.md`, `CLAUDE.md`,
      `docs/08_build_log.md`, `docs/24_week_six_c_plan.md`, and — only if §11 triggers —
      `docs/24_week_six_c_release_checklist.md`).
- [ ] No source/test/fixture/config change.

Passing every 6-A line is the gate for the **local Codex closeout audit**. Any failing line blocks push.

### 6-B. Post-push / tag closeout (after push and after the W6-C tag is created)

- [ ] `git push` completed; **HEAD = `origin/master`**.
- [ ] The W6-C tag **`week-six-release-freeze`** exists and **points at HEAD**.
- [ ] Working tree clean.
- [ ] `git tag --list "week-*"` includes **`week-six-diff-inspect-ergonomics` (W6-A)**,
      **`week-six-verify-replay-explanations` (W6-B)**, and **`week-six-release-freeze` (W6-C)**.

Passing every 6-A line locally then every 6-B line after push/tag is the definition of "release-frozen at W6-C."

---

## 7. Docs update plan

Edits are the **minimum** needed to reconcile the §1 drift; nothing else in these files is touched.

- **`README.md`**
  - **Status section** — advance the headline from "Post-W5-A. Ready for W5-B (docs/repo-readiness)." to the W6-C
    release-freeze state (post-W6-B); replace "Latest tag: `week-five-trace-fixture-corpus` (W5-A …)" with the §3.5
    **durable** wording — **latest release-freeze tag:** `week-six-release-freeze`; **latest technical-capability tag
    before release-freeze:** `week-six-verify-replay-explanations` — so the line stays true after W6-C is tagged;
    change "Tests: 360/360" to "Tests: 394/394".
  - **"For reviewers" block** — change the `npm test -- --run # 360 tests` comment to `# 394 tests`.
  - **"Build history"** — append sections in order: **Week-Five Public Demo Readiness
    (`week-five-public-demo-readiness`)**, **Week-Six Diff/Inspect Ergonomics (`week-six-diff-inspect-ergonomics`)**,
    **Week-Six Verify/Replay Explanations (`week-six-verify-replay-explanations`)**, and a **Week-Six Release Freeze
    (`week-six-release-freeze`)** note — each a short, accurate bullet list consistent with the build-log entries.
    No prior section is rewritten.
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
- **`AGENTS.md`** *(required)* — narrow current-state pointer refresh only: change "Current State: W5-B
  docs/repo-readiness (W5-A closed and tagged)" to name **W6-C release-freeze as current** with **W6-B
  (`week-six-verify-replay-explanations`) closed and tagged**, and the current baseline **394/394**; update the
  "Test Rule"/current-state count from `360/360` to 394/394 wherever it reflects the *current* suite. Preserve the
  Build Scope Guardrails, invariants, the Documentation Rule, the Agent Roles table, Commit Hygiene, and every
  historical milestone entry (and their historical counts) verbatim.
- **`CLAUDE.md`** *(required)* — narrow current-state/count/next-step refresh only: change the "Post-W5-A. W5-B
  (docs/repo-readiness) in progress." headline to the **W6-C release-freeze** state; add
  `week-six-verify-replay-explanations` (and, at closeout, `week-six-release-freeze`) to the closed-tag set; change
  the current test count `360/360` to **394/394**; re-point the "Agent Workflow" sequencing and "Next Safest Task"
  from the W5-B flow to the W6-C release-freeze flow. Preserve Hard Guardrails, Technical Rules, Core Loop, and
  Response Format verbatim; do not rewrite the closed-tags historical list beyond adding the newly closed tags.
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
4. **Freeze checklists executed.** Every §6-A line passes locally before push; every §6-B line passes after
   push/tag; both results are captured in the build-log entry.
5. **Docs-only diff asserted.** `git diff --name-only` shows only the allowed docs (criterion §4.12) —
   `README.md`, `DEMO.md`, `AGENTS.md`, `CLAUDE.md`, `docs/08_build_log.md`, `docs/24_week_six_c_plan.md`.
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
> Allowed files (docs-only): `README.md`, `DEMO.md`, `AGENTS.md`, `CLAUDE.md`, `docs/08_build_log.md`,
> `docs/24_week_six_c_plan.md` (status header), and — only if §11 explicitly triggers —
> `docs/24_week_six_c_release_checklist.md`. Touch nothing else.
>
> 1. **Phase A — verify (read-only).** For every command in `README.md` and `DEMO.md`, confirm it against its source
>    of truth: `npm run *` scripts against `package.json`; `npm run cli -- <sub>` subcommands/flags against the
>    `src/cli.ts` allow-lists and dispatch switch; default paths and exit codes against the command bodies. Record
>    the result in the §5 matrix. Run `npm test -- --run` and note the exact total. Run `npm run cli -- check`,
>    `npm run fixtures:generate` (check mode), and `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof`
>    (key-guard exit). Execute the §6-A local pre-push freeze checklist.
> 2. **Phase B — reconcile (docs only).** Edit the allowed docs *only* for the proven drift:
>    - the stale test count `360 → 394` (or the true suite count) everywhere a *current* count appears (in
>      `README.md`, `DEMO.md`, `AGENTS.md`, `CLAUDE.md`);
>    - the README Status headline + tag lines advanced to the W6-C release-freeze state using the §3.5 **durable**
>      wording (latest release-freeze tag `week-six-release-freeze`; latest capability tag before release-freeze
>      `week-six-verify-replay-explanations`) — do **not** write "latest tag = W6-B" unqualified;
>    - new README build-history sections for W5-B, W6-A, W6-B in order, plus a W6-C release-freeze note;
>    - the DEMO opening core-loop string extended to `… → diff → verify → check`;
>    - the **required** narrow current-state pointer refresh in `AGENTS.md` and `CLAUDE.md` per §3.6 / §7 (W6-C
>      current, W6-B closed/tagged, 394/394, no stale W5-A/W5-B language; guardrails/roles/invariants/historical
>      entries and historical counts preserved verbatim).
>    Do not change any command, flag, path, or expected-output block. Append a W6-C build-log entry recording the
>    matrix result and the §6-A checklist pass (and, at closeout, the §6-B result).
> 3. If Phase A uncovers a real *command* mismatch that cannot be fixed by docs, **stop** and write a separate,
>    Codex-audited source-fix plan — do not patch runtime code under this milestone.
>
> Acceptance gate (local, pre-push): `npm test -- --run` green at the count the docs now state (zero live calls, no
> key), `npm run cli -- check` PASS, `npm run fixtures:generate` check mode in sync,
> `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard, `git ls-files traces` empty,
> `package.json`/`package-lock.json`/`.gitignore` unchanged, `git diff --name-only` shows only the allowed docs,
> every §5 matrix row PASS, every §6-A line green, branch ahead of `origin/master` by the W6-C commit(s) only. Then
> report: files changed / what is real / what is mocked / tests pass / next safest task. Do not push or tag (§6-B is
> applied only after the human pushes and tags `week-six-release-freeze`).

---

## 13. Codex audit prompt

> Audit the W6-C plan in `docs/24_week_six_c_plan.md` (and, once implemented, the diff) as a repo-aware reviewer
> before it is accepted for implementation / before tag. Confirm specifically:
>
> 1. **Docs-only, allowed set.** No change to any file under `src/`, `tests/`, `scripts/`, `fixtures/`, or to
>    `package.json` / `package-lock.json` / `.gitignore`. `git diff --name-only` shows only the allowed docs:
>    `README.md`, `DEMO.md`, `AGENTS.md`, `CLAUDE.md`, `docs/08_build_log.md`, `docs/24_week_six_c_plan.md` (and, if
>    §11 triggered, `docs/24_week_six_c_release_checklist.md`).
> 2. **Every documented command is real.** Each command in `README.md`/`DEMO.md` maps to an actual `package.json`
>    script or `src/cli.ts` subcommand/flag; no doc claims a command, flag, path, or exit code the repo does not
>    implement. The §5 matrix is complete and evidence-backed.
> 3. **Counts/status truthful.** Every *current* test count matches `npm test -- --run` (394 at HEAD) in
>    `README.md`, `DEMO.md`, `AGENTS.md`, and `CLAUDE.md`; no doc claims `week-five-trace-fixture-corpus` is HEAD;
>    the build history has accurate W5-B/W6-A/W6-B entries plus a W6-C release-freeze note.
> 4. **Tag wording durable (§3.5).** The README uses release-freeze `week-six-release-freeze` as the latest
>    release-freeze tag and `week-six-verify-replay-explanations` as the latest capability tag before release-freeze
>    — it does **not** call W6-B "the latest tag" unqualified, so the wording stays true after W6-C is tagged.
> 5. **`AGENTS.md` / `CLAUDE.md` reconciled (required).** Both name W6-C as the current milestone and W6-B
>    (`week-six-verify-replay-explanations`) as the last closed capability tag, cite 394/394 as the current
>    baseline, and carry no stale W5-A/W5-B current-state language or stale current `360/360`. Guardrails,
>    build-scope rules, the agent-role table, invariants, technical rules, and response-format sections are
>    preserved verbatim; all historical milestone entries and their historical counts are unchanged.
> 6. **Core loop stated consistently.** Both front-door docs state `record → replay → fork → mutate → continue →
>    diff → verify → check`.
> 7. **No overclaim.** No doc asserts a live-by-default path, a shipped/published package, a UI/backend/dashboard,
>    or a capability the code does not prove. Anthropic proofs remain described as opt-in, human-run,
>    never-in-`npm test`, never-CLI-wired.
> 8. **Frozen artifacts intact.** No fixture byte or frozen-hash change; `git ls-files traces` empty;
>    `git ls-files fixtures/traces` lists the five committed fixtures unchanged.
> 9. **Historical record preserved.** Prior milestone entries and their historical counts are unchanged; only
>    current-state headlines advanced.
> 10. **Freeze checklists sound and phase-correct.** §6-A asserts the *local pre-push* state (working tree clean, on
>     master, branch ahead of `origin/master` by the W6-C commit(s) only — **not** HEAD = origin) and passed at the
>     implementation commit; §6-B asserts the *post-push/tag* state (HEAD = origin/master, `week-six-release-freeze`
>     points at HEAD, week-six tags include W6-A/W6-B/W6-C) and is applied after push. Both are recorded in the
>     build log. Flag any pre-push line that impossibly requires HEAD = origin.
> 11. **Guardrails held.** No UI/backend/dashboard/observability, no Anthropic CLI wiring, no live call, no new
>     provider adapter, no new dependency, no schema/hash change, no new CLI surface, no product-surface expansion.
>
> Report any scope creep (especially any touch to source/tests/fixtures, any new dependency or CLI surface, or any
> doc claim not backed by the repo) as a blocker.
