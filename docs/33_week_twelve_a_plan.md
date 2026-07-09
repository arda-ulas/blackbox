# W12-A Plan — Reviewer Demo Path (docs-only)

**Status:** IMPLEMENTED (in closeout). This document is the accepted plan and historical record; the sections below
describe what was planned and were carried out in a docs-only slice.
**Predecessor:** W10-A closed/tagged (`week-ten-foreign-transcript-adapter`); W11-A closed/tagged
(`week-eleven-foreign-fork-proof`). Tests: 583/583 offline, zero live calls.
**Mode:** documentation only — reconcile the public docs after W10-A/W11-A and ship a curated 3–5 minute reviewer
path. **No source, test, fixture, `scripts/`, `package.json`, `package-lock.json`, `.gitignore`, or `assets/brand/`
change.**
**Tag policy:** after Codex closeout audit and push, this docs refresh may be tagged `week-twelve-reviewer-demo-path`.

---

## 1. Problem statement

Two tagged technical milestones (W10-A foreign transcript adapter, W11-A foreign fork proof) landed after the public
docs were last reconciled. As a result the front door understates the project on facts a reviewer can check in one
command: README Status still read **522/522** and named cassette assertions as the most recent milestone; the "For
reviewers" block claimed `# 522 tests`; Build history stopped at W9-A; and DEMO.md's Prerequisites count predated two
milestones. A reviewer hits a wrong number on line one — the exact defect class W5-B / W6-C existed to kill.

The proof itself is complete and needs no new mechanism: adapt (W10-A) → verify/replay/assert → fork/mutate/continue/
diff (W11-A). W12-A's job is to make that proof **legible in 3–5 minutes** and to make the public docs true again.

## 2. Scope

### 2.1 README

- **"For reviewers" → a curated 3–5 minute path.** One-time `npm install` (the only network step — installs from the
  npm registry), then **seven fully offline proof commands**: full suite → native `check` → committed-cassette
  `assert` → foreign `verify` → foreign `fork` (explicit `--out traces/chat-tool-use-fork.json`) → `diff` → child
  `assert`. Each annotated; framed as a curated tour, **not** exhaustive. One plain real-vs-fake statement:
  everything after install is local/deterministic/fake/offline with no API key; the forked child is a generated,
  local, git-ignored artifact; the CLI continuation invokes only the local deterministic fake — foreign tools are
  never executed and no live provider/network call occurs.
- **Status reconciled** to durable wording (per the W9-B rule): 583/583; schema v2; most recent technical milestone:
  foreign-origin cassette active-debugging proof (`week-eleven-foreign-fork-proof`). No "in closeout" / "intended
  tag" / "latest tag" phrasing; no W-code soup.
- **"What Blackbox is"** gains one bullet for foreign-transcript ingest (adapt a synthetic external-style transcript
  into a first-class cassette — verify/replay/assert/fork/diff fully offline; an adapter-boundary proof).
- **Build history** appends concise W10-A and W11-A entries from the build log. **W12-A is not added to Build history
  before its tag exists.**
- Hero, core-loop string, and the assert/ingest outside-the-loop framing unchanged.

### 2.2 DEMO.md (narrow)

- Prerequisites test count `522 → 583`.
- One concise closing "Foreign cassette (adapt → fork → diff)" section listing the foreign verify/fork/diff/assert
  commands and pointing to the README curated path; plus real-vs-mocked rows (adapter synthetic/non-official; CLI
  continuation = `ReactiveDemoModelClient` + default fixture executor; foreign tools not executed; no live provider
  call).
- **No existing step body, command, flag, or expected-output block edited.** Historical 522/559 counts inside
  milestone-history text are preserved.

### 2.3 Bookkeeping

`docs/33_week_twelve_a_plan.md` (this doc); a `docs/08_build_log.md` W12-A entry (completed docs edits only; no
commit/tag claimed; tag policy `week-twelve-reviewer-demo-path` after closeout); `CLAUDE.md` / `AGENTS.md`
current-state pointers (W11-A complete/tagged; W12-A docs-only reviewer-path slice in closeout; next task Codex
closeout audit → commit → push → tag).

## 3. File allowlist (exhaustive)

`docs/33_week_twelve_a_plan.md` (new), `README.md`, `DEMO.md`, `docs/08_build_log.md`, `CLAUDE.md`, `AGENTS.md`.

**Untouched:** everything under `src/`, `tests/`, `fixtures/`, `scripts/`; `package.json`, `package-lock.json`,
`.gitignore`; `assets/brand/` (hero included); `docs/11_cli_spec.md`; all prior plan docs.

**Not added:** tests, npm scripts, `scripts/` runners, CLI commands, CLI flags, dependencies, source behavior, W12-B
work.

## 4. Acceptance criteria

1. Every command in README and DEMO runs green exactly as documented (correct exit codes, correct annotated
   behavior), verified by execution.
2. No stale current-state count in README/DEMO: current numbers read **583**; historical counts inside past
   build-history/build-log entries preserved.
3. README Status is durable (survives the W12-A tag) and names W11-A as the most recent technical milestone; Build
   history includes W10-A and W11-A but not W12-A.
4. The reviewer path states real vs fake/offline plainly and claims no framework/SDK/live-ingestion/foreign-tool-
   execution support.
5. `npm test -- --run` still **583/583**; `check` byte-identical run-to-run; `fixtures:generate` in sync; `git diff`
   confined to the six allowlisted files; no trace committed.

## 5. Failure conditions (stop and escalate)

- A documented command fails or cannot be truthfully described without a source/flag change (that is a different
  milestone).
- Any temptation to add an npm script, `scripts/` runner, CLI flag, test, or dependency.
- DEMO.md edits growing beyond the count fix + one closing section + real-vs-mocked rows.
- Any wording claiming official framework/SDK support, live ingestion, or foreign tool execution.

## 6. Test plan

No new tests (deliberate): every documented command is already pinned — the offline loop and `check` by
`tests/cli.test.ts`, `assert` on the corpus by `tests/cliAssert.test.ts`, and the foreign verify/fork/diff/assert
sequence verbatim by `tests/foreignFork.test.ts`. Verification is **execution** (W6-C Phase-A style): run the full
reviewer path top to bottom and confirm each exit code and annotated claim, then run the standard battery and confirm
the suite total is unchanged at 583.

## 7. Rollback

Delete `docs/33_week_twelve_a_plan.md` and revert the five edited docs. No code/test/fixture/config is touched, so
rollback cannot affect runtime behavior, test outcomes, or the corpus.
