# W13-A Plan — Worked Debugging Case Study (docs-only)

**Status:** IMPLEMENTED (in closeout). This document is the accepted plan and historical record; the sections below
describe what was planned and were carried out in a docs-only slice.
**Predecessor:** W12-A closed/tagged (`week-twelve-reviewer-demo-path`). Tests: 583/583 offline, zero live calls.
**Mode:** documentation only — add one concrete, worked debugging case study so a cold reviewer can see one specific
bug Blackbox debugs, end to end. **No source, test, fixture, `scripts/`, `package.json`, `package-lock.json`,
`.gitignore`, or `assets/brand/` change.**
**Tag policy:** after Codex closeout audit and push, this docs slice may be tagged `week-thirteen-worked-case-study`.

---

## 1. Problem statement

An external audit found Blackbox technically credible and differentiated (canonical hash + prefix verification,
offline cassette replay, foreign-transcript ingest, cassette assertions for CI, TypeScript/local-first/no-API-key)
but flagged a **communication gap**: a cold reviewer cannot yet see *one concrete bug* Blackbox debugs. The README
proves capabilities and offers a curated command tour (W12-A), but it never tells a single bug story with a
before/after answer.

W13-A closes that gap with no new engine feature. Every mechanism the story needs already exists and is
test-frozen: tool-result mutation (`forkRun`), the derived offline continuation (`ReactiveDemoModelClient`), the
first-divergence pin (`diffTraces`/`formatFirstDivergence`), the behavioral `Outcome:` verdict (`diffOutcome`), and
the exact-match regression gate (`assert`). The only thing missing is the narrative frame.

## 2. Scope

### 2.1 README

- **One new section, "Worked example: debugging one bad answer",** placed after the W12-A "For reviewers" block and
  before "Quick Start". It tells one bug story over the **native corpus** cassette
  `fixtures/traces/success-tool-use.v2.json` (not the foreign cassette — deliberately disjoint from the W12-A
  reviewer path): the recorded run booked a room off a wrong/misleading `search` result at step 3; fork at index 4
  with a tool-result mutation at step 3 injecting `{"results":[],"available":false,"message":"No hotels available
  for that date."}` to `--out traces/case-study-fix.json`; the corrected child declines to book; `diff` pins the
  first divergence at index 3 and prints the behavioral `Outcome:` verdict; `assert` pins the corrected child with
  `--expect-status success --expect-final-answer '<exact captured string>' --expect-tools search`.
- **Short real-output excerpts**, captured byte-for-byte from real non-TTY runs (never invented): the parent
  `replay` `Result:` line; the `diff` first-divergence + `Outcome:` block; the `assert` PASS + expectations block
  (including the exact `final_answer` expectation).
- **One plain real-vs-fake statement:** real record/replay/fork/diff/assert machinery over a committed cassette;
  deterministic fake model (`ReactiveDemoModelClient`); fixture tool stubs; no live provider/network call;
  `traces/case-study-fix.json` generated/local/git-ignored; a **framing device over a committed cassette**, not
  automatic bug-finding.
- **One "What Blackbox is not" tighten** to functional positioning (not rivalry): "Not an agent framework or
  orchestrator (no LangChain, LlamaIndex, or MCP) — Blackbox does not run your agent for you; it records, replays,
  forks, and diffs recorded histories. It sits beside frameworks, not in place of them." No LangGraph/LangChain/MCP
  support claim.
- **Untouched:** the W12-A "For reviewers" block (byte-identical), the hero, the core-loop string, the Status block,
  the `assert`/`adaptForeignTranscript` outside-the-loop framing, and Build history (**W13-A is not added to Build
  history before its tag exists**). Current counts stay **583**.

### 2.2 DEMO.md

- Prefer untouched. Permitted: at most **one** concise cross-link sentence pointing at the README case study — **no**
  duplicated commands or output. (Implemented: left untouched.)

### 2.3 Bookkeeping

`docs/34_week_thirteen_a_plan.md` (this doc); a `docs/08_build_log.md` W13-A entry (completed docs edits only; no
commit/tag claimed; tag policy `week-thirteen-worked-case-study` after closeout); `CLAUDE.md` / `AGENTS.md`
current-state pointers (W12-A complete/tagged; W13-A docs-only worked-case-study slice in closeout; next task Codex
closeout audit → commit → push → tag; no W14 work until scoped and audited).

## 3. File allowlist (exhaustive)

`docs/34_week_thirteen_a_plan.md` (new), `README.md`, `DEMO.md` (one cross-link sentence max, optional),
`docs/08_build_log.md`, `CLAUDE.md`, `AGENTS.md`.

**Untouched:** everything under `src/`, `tests/`, `fixtures/`, `scripts/`; `package.json`, `package-lock.json`,
`.gitignore`; `assets/brand/` (hero included); `docs/11_cli_spec.md`; all prior plan docs; the README W12-A "For
reviewers" block.

**Not added:** source changes, tests, fixtures, npm scripts, `scripts/` runners, CLI commands, CLI flags,
dependencies, package publishing, `ARCHITECTURE.md`, dashboard/UI, real model integration, LangChain/LangGraph/MCP
integration, SDK/framework/live-ingestion claims, W14 work.

## 4. Codex correction (final assert must pin the final answer)

The final `assert` in the case study **must** carry `--expect-final-answer` with the exact string derived by the
deterministic continuation — `Based on the search result, no options are available: "No hotels available for that
date.". I could not complete the booking.` — captured from a real run, never guessed. `--expect-status success
--expect-tools search` alone would pass but would not pin the corrected *answer*, which is the whole point of the
fix; the final-answer expectation is what turns the case study into a real regression gate. (`verify ⊂ assert`, so
the assertion also re-proves the child's four invariants.)

## 5. Acceptance criteria

1. All four case-study commands run green exactly as documented, verified by execution; every README excerpt
   byte-matches real non-TTY output (including the exact `--expect-final-answer` string).
2. The child is written only to git-ignored `traces/` via the explicit `--out`; `git ls-files traces` empty; no
   fixture added or changed (`fixtures:generate` in sync; `fixtures/external/` still exactly two files).
3. The case study duplicates no W12-A reviewer-path command; the reviewer-path block is byte-unchanged.
4. The section states the real-vs-fake boundary plainly and claims no automatic bug-finding, root-cause AI, or
   framework support.
5. `npm test -- --run` still **583/583**; `check` byte-identical run-to-run; the seven W12-A reviewer commands still
   green (regression).
6. `git status --short --untracked-files=all` shows exactly the allowlisted docs; `git diff --name-only` shows only
   the tracked edits; frozen-path diff (`src tests fixtures scripts package.json package-lock.json .gitignore
   assets/brand docs/11_cli_spec.md`) empty.

## 6. Failure conditions (stop and escalate)

- The story cannot be told truthfully with existing output (a wrong derived answer or diff verdict) — that indicates
  a different milestone, not a doc workaround and not a source tweak.
- Any new fixture, test, npm script, CLI flag, dependency, `ARCHITECTURE.md`, or packaging work.
- Duplicated expected-output blocks across README and DEMO, or edits inside the W12-A reviewer-path block.
- Wording that claims live ingestion, LangGraph/LangChain/MCP support, automatic debugging, or production readiness.

## 7. Verification

`npm test -- --run` (583/583); `npm run fixtures:generate` (in sync); `npx tsx src/cli.ts check` twice
(byte-identical); the four case-study commands top to bottom (capture output for the excerpts); the seven W12-A
reviewer commands (regression); `git ls-files traces` (empty); `git status --short --untracked-files=all` (only
allowlisted docs); `git diff --check`; frozen-path `git diff --name-only HEAD` empty.

## 8. Rollback

Delete `docs/34_week_thirteen_a_plan.md` and revert the edited docs. No code/test/fixture/config is touched, so
rollback cannot affect runtime behavior, test outcomes, or the corpus.
