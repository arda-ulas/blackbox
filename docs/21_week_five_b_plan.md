# W5-B Plan — Public Demo Narrative + Repo Readiness

**Status:** PLANNED (not implemented). Plan-only document.
**Predecessor:** W5-A complete, pushed, tagged `week-five-trace-fixture-corpus`. Current HEAD/origin/master
`d1b11a8 feat: add trace fixture regression corpus`. Full core loop proven, polished, and now protected by a
committed regression baseline: `record → replay → fork → mutate → continue → diff → verify → check`. Tests:
360/360 offline, zero live calls.
**Mode:** documentation / repo-readiness polish only. **No source, test, fixture, `package.json`, or `.gitignore`
changes.** No live calls, no CLI Anthropic wiring, no new provider adapter, no product-surface expansion.

> This is the accepted-plan document for W5-B. Nothing here is implemented yet. Implementation happens in a later
> slice under the first-implementation prompt in §8. Writing this plan file is the *only* change in the current
> commit.

---

## 1. Problem statement

The technical proof is strong: the full active-debugging loop is implemented, hardened, composed under one
self-check, proven live against the real provider (opt-in), and now frozen against a committed regression corpus.
360 tests pass fully offline. What is *not* yet strong is how the repository **reads to a first-time visitor** — a
reviewer, a hiring manager, or a future collaborator who lands on the repo cold and has five minutes.

Concretely, the docs have accreted rather than been authored:

1. **README is a changelog, not a narrative.** `README.md` is organized as a running ledger of milestone sections
   (`Week-One Proof ✓`, `Week-Two Hardening ✓`, … `Week-Five Regression Hardening ✓`). This is excellent internal
   history but a poor front door: a new reader must reconstruct "what is this and why should I care" from a
   week-by-week build log. The single most important question — *what is Blackbox and what does it prove* — is not
   answered crisply up top.

2. **The Status section is stale and mis-leads.** `README.md`'s "Status" section still leads with *"Week Four
   structured transcript migration (W4-D) is complete and tagged"* as the headline state of the project. That
   predates W4-E (live proof), W4-F (verify), W4-G (check), and all of W5-A (fixture corpus). A reader's first
   impression is a project frozen three milestones ago. (The per-milestone `✓` sections below it *are* current, so
   the README simultaneously under- and over-states itself.)

3. **DEMO.md has a stale, checkable number.** `DEMO.md`'s Prerequisites block says `npm test -- --run  # 321 tests;
   all should pass`. The real baseline is **360**. Any reviewer who runs the command sees a mismatch on line one of
   the walkthrough — a small thing that quietly undermines trust in every other claim in the doc.

4. **No single "what it is / what it is not" statement.** The guardrails (no UI, no backend, no live tests by
   default, fake/offline default) are the *most credible* thing about this repo — they signal disciplined scope.
   But they live scattered across `README.md`'s "Not Current Focus", `DEMO.md`'s "Current Limitations", `CLAUDE.md`,
   and `AGENTS.md`. A visitor never sees them stated together as a deliberate, confident boundary.

5. **No consolidated "proof status" or "for reviewers" path.** A reviewer has to infer *what is actually proven vs.
   mocked* and *which commands to run to confirm it* from the DEMO's real-vs-mocked table plus scattered prose.
   There is no single "here's how a skeptic verifies this in four commands" path.

**Thesis:** the code is demo-ready; the *repo* is not yet. W5-B makes the repository understandable, credible, and
demo-ready **without adding a single runtime feature** — it re-narrates the front door (README), tightens the
walkthrough (DEMO), consolidates the "is / is not" boundary and the "proof status", and adds a short "for
reviewers" verification path. Every command in the docs is brought current and confirmed to exist. Nothing
overclaims production readiness. No code, tests, fixtures, or config change.

---

## 2. Why W5-B is the next smallest milestone

- **The technical work is done and protected.** W4 closed the loop and proved it live; W5-A froze it against
  regression. The next unit of value is not more mechanism — it is making the existing mechanism *legible*. That is
  the smallest remaining step that increases the project's value to an outside reader.
- **It is pure documentation.** Blast radius is a handful of Markdown files (`README.md`, `DEMO.md`, one new plan
  doc, a build-log entry). **No source, no tests, no fixtures, no `package.json`, no `.gitignore`.** Reverting is
  `git checkout` on the touched docs.
- **It removes concrete, already-identified defects.** The stale README Status headline (§1.2) and the wrong test
  count in DEMO (§1.3) are live inaccuracies a reviewer *will* hit. Fixing them is low-risk and high-signal.
- **It de-risks any future outward-facing step** (a demo, a writeup, sharing the repo) by ensuring the docs match
  the code exactly and claim exactly what is proven — no more, no less.
- **It respects every guardrail.** Docs polish cannot touch the fake/offline default, the replay-is-structural
  guarantee, the no-live-tests rule, or the no-new-adapter rule, because it changes no code. It is the safest
  possible milestone.

---

## 3. Scope

Five cohesive documentation edits under one thesis: make the repo readable, credible, and demo-ready. All are
additive/rewording; none introduces a new command, feature, or claim beyond what the code already proves.

### 3.1 README structure and clarity

Re-author `README.md` so the front door answers, in order:

- **What Blackbox is** — one or two sentences, unchanged in substance from the current tagline (a local time-travel
  debugger for AI agents: record → replay → fork → mutate → continue → diff → verify → check).
- **The core loop**, stated once, crisply, with the one-line meaning of each verb.
- **What it proves** — the headline invariants in plain language (offline replay is structural; fork prefixes are
  hash-identical; the whole loop is proven live against a real provider via opt-in scripts; a frozen corpus guards
  cassette compatibility).
- **A current, accurate Status line** — replace the stale W4-D headline (§1.2) with the true current state (post
  W5-A, tagged `week-five-trace-fixture-corpus`, 360 tests offline). The per-milestone `✓` history is **retained**
  (it is valuable and accurate) but moved below the narrative, framed explicitly as build history rather than as
  the project's headline.
- **Quick Start** — kept, verified current (see §5).

The rewrite is a *reorganization and a status correction*, not a deletion of history. No milestone `✓` section is
removed; they are re-framed under a "Build history" heading beneath the new narrative lead.

### 3.2 DEMO.md walkthrough polish

- **Fix the stale count:** `321 tests` → `360 tests` in the Prerequisites block (the single checkable inaccuracy).
- Ensure the walkthrough reads as a clean end-to-end story: `record → replay → fork → diff → verify → check →
  fixtures`. The eight numbered command sections already exist and are accurate; W5-B adds a short closing
  **fixtures** note (pointing at `npm run fixtures:generate` check-mode and the committed corpus) so the walkthrough
  ends on the regression baseline, matching the current core loop's `…→ verify → check` plus the W5-A corpus.
- Confirm every command block matches the real CLI/scripts (see §5). No new commands are introduced.

### 3.3 "What Blackbox is / is not" section

Add one concise, consolidated section (in `README.md`, the front door) that states the boundary confidently in two
short lists:

- **Is:** a local, offline-by-default, deterministic time-travel debugger for single-agent tool-using runs;
  cassette record/replay with a canonical hash chain; fork + mutate + diff; offline verify + one-shot check; a
  committed fake/offline regression corpus; an opt-in, human-run live proof against Anthropic.
- **Is not:** a web UI / dashboard / backend / hosted service; an observability or OTEL/metrics platform; an agent
  framework (no LangChain/LlamaIndex/MCP); a multi-agent orchestrator; an npm-published binary; a production SDK.

This consolidates the boundary that today is scattered across README "Not Current Focus", DEMO "Current
Limitations", `CLAUDE.md`, and `AGENTS.md` — stated once, as a deliberate scope choice, not an apology.

### 3.4 "Proof status" section

Add a short, skimmable "Proof status" section (in `README.md`) making the real-vs-mocked posture unambiguous:

- **Fake/offline default loop** — the default CLI and all of `npm test` use `FakeDeterministicModelClient` +
  fixture tools; zero live calls; replay is structurally offline.
- **Opt-in Anthropic proof scripts** — three human-run, key-gated proof scripts (`example:real-proof`,
  `example:real-tooluse-proof`, `example:real-fork-proof`); never in `npm test`, never CLI-wired; record real runs,
  replay offline. The full live `record → replay → fork → mutate → continue → diff` loop is proven (W4-E).
- **Fixture regression corpus** — committed fake/offline v2 cassettes under `fixtures/traces/` with frozen hashes
  (W5-A) guard cassette compatibility.
- **No UI / backend / dashboard / observability platform** — restated as a proof-of-discipline, not a TODO.

This may reuse/point to DEMO.md's existing "What Is Real vs. Mocked" table rather than duplicating it, to avoid two
sources of truth (decide at implementation time; a single canonical table with the README section linking to it is
preferred).

### 3.5 "For reviewers" path

Add a short "For reviewers" block (in `README.md`) with the exact four-command skeptic path, each line annotated
with what it proves:

```sh
npm install                 # no build step needed to run the offline loop
npm test -- --run           # 360 tests, fully offline, zero live calls
npm run cli -- check        # one-shot: record → verify → fork → verify → diff → single PASS
npm run fixtures:generate   # check mode: the committed regression corpus is in sync
```

Every command must be verified to exist and behave as annotated (§5). The annotations must not overclaim: `check`
is the composed offline self-check, `fixtures:generate` (no `--write`) is a read-only in-sync check.

### 3.6 No-overclaim pass

A deliberate read-through of the edited docs to ensure nothing claims production readiness, a shipped SDK, a
published package, live-by-default behavior, a UI, or a capability the code does not prove. Any superlative that
implies more than "a proven local demo with an opt-in live proof" is softened. The existing DEMO "Current
Limitations" list is the model for tone and is preserved.

---

## 4. Proposed docs changes (file-by-file)

**New (this commit — plan only):**
- `docs/21_week_five_b_plan.md` — this document. (The only change in the plan commit.)

**Edited (in the *implementation* slice, not now):**
- `README.md` — re-authored front-door narrative (§3.1); new "What Blackbox is / is not" (§3.3); new "Proof status"
  (§3.4); new "For reviewers" (§3.5); Status line corrected from W4-D to post-W5-A; milestone `✓` history retained
  and re-framed as "Build history"; Quick Start verified current; no-overclaim pass (§3.6).
- `DEMO.md` — `321` → `360` in Prerequisites; closing **fixtures** note so the walkthrough ends on the corpus
  (§3.2); command blocks re-confirmed against the real CLI; no-overclaim pass.
- `docs/08_build_log.md` — a W5-B entry recording the docs-only change and confirming the post-W5-B test total is
  unchanged at 360 (docs cannot change test count).

**Explicitly NOT touched by W5-B (guardrail):**
- Any file under `src/`, `tests/`, `scripts/`, or `fixtures/`.
- `package.json`, `package-lock.json`, `.gitignore`, `tsconfig.json`, `vite`/`vitest` config.
- `AGENTS.md`, `CLAUDE.md` — left as-is by W5-B unless a separate, explicitly-scoped decision updates the "Current
  State" pointer; **not** part of this milestone. (If the human later wants the `CLAUDE.md`/`AGENTS.md` "Current
  State" pointer advanced to "post-W5-A / W5-B docs readiness," that is a separate tiny commit, not W5-B scope.)

---

## 5. Command verification plan

W5-B's central discipline: **every command that appears in the edited docs must exist and behave as described.**
Because W5-B changes no code, this is a *verification* exercise, not a test-writing one. In the implementation
slice, run each documented command and confirm the doc matches reality:

**Commands referenced across README + DEMO (must all be current and pass):**
- `npm install` — succeeds; no build step needed for the offline loop.
- `npm test -- --run` — **360** tests pass, zero live calls, no API key present. (Confirms the count the docs now
  claim.)
- `npm run cli -- record` — writes the two demo cassettes; `Validation: passed`.
- `npm run cli -- list` — 2 of 2 valid, 0 warnings.
- `npm run cli -- inspect` — 15-step timeline for the success trace.
- `npm run cli -- replay` — offline replay, `status: success`.
- `npm run cli -- fork` — writes the child, first divergence at index 3, `Validation: passed`.
- `npm run cli -- diff --parent traces/example-trace.json --child traces/example-trace-fork.json` — `tool_result
  differs at index 3`.
- `npm run cli -- verify --trace traces/example-trace.json` — PASS, 4/4 invariants.
- `npm run cli -- check` — single PASS over record → verify → fork → verify → diff.
- `npm run fixtures:generate` — check mode reports the committed corpus in sync, writes nothing.

**Script names cross-checked against `package.json`** (no doc may name a script that does not exist): `cli`,
`fixtures:generate`, `example:record`, `example:replay`, `example:fork`, `example:real-proof`,
`example:real-tooluse-proof`, `example:real-fork-proof`, `test`. Any command referenced in the docs must map to one
of these (or to a `cli` subcommand: `record`/`replay`/`fork`/`diff`/`verify`/`check`/`list`/`inspect`).

**Explicitly not run in verification:** any `example:real-*` proof with a live key. The docs *describe* these as
opt-in; W5-B verifies only that (a) the script names exist in `package.json` and (b) without a key they fail safely
at the key guard. **No with-key live proof is run in W5-B.**

**Optional (decide at implementation time):** whether to add a tiny docs-command smoke check. Default position:
**do not** add tests in W5-B — the existing suite already exercises the CLI, and W5-B is docs-only. A docs-command
test would be a source/test change and is therefore out of the stated scope unless a later, explicit decision
justifies it (noted here so the option is on record, not adopted).

---

## 6. Non-goals

- **No source or runtime changes.** Nothing under `src/`, `scripts/`, or `fixtures/`. No change to hashing, trace
  schema, `validateTrace`/`replayTrace`/`loadTrace`, `forkRun`, `diffTraces`, `verifyTrace`, `neutrality`,
  `selfCheck`, or `cli.ts`.
- **No tests** (unless a later, explicit decision justifies a docs-command validation test — not adopted here).
- **No fixture changes.** The committed corpus and generator are untouched.
- **No `package.json` / `.gitignore` / build-config changes.** No new dependency, no new script, no new alias.
- **No UI, dashboard, backend, hosted service, remote storage, auth, or sharing.**
- **No Anthropic CLI wiring; no live proof run; no new/changed provider adapter; no live tests in `npm test`.**
- **No production SDK, eval platform, metrics/observability/OTEL platform, or prompt-management surface.**
- **No new capability claim.** W5-B may only *describe* what the code already proves; it may not add or imply any
  new behavior, and must remove (not add) any overclaim.
- **No `AGENTS.md` / `CLAUDE.md` rewrite** as part of W5-B (a separate tiny pointer-advance commit is out of scope
  here).

---

## 7. Rollback plan

W5-B is **purely documentation**:

- Revert is `git checkout -- README.md DEMO.md docs/08_build_log.md` (and, if undesired, delete
  `docs/21_week_five_b_plan.md`). Because no code, test, fixture, or config file is touched, reverting W5-B **cannot
  affect any runtime behavior, any test outcome, or the fixture corpus**. The loop
  (`record`/`replay`/`fork`/`diff`/`verify`/`check`) and the 360-test suite are identical with or without W5-B.
- If only part of the rewrite is unwanted (e.g., the README reorganization but not the DEMO count fix), the edits
  are independent per file and can be reverted individually.
- If the consolidated "is / is not" or "Proof status" section is judged redundant with DEMO's existing table, the
  minimal fallback is to keep the DEMO table as the single source of truth and have the README section link to it
  rather than restate it — no functional difference.

---

## 8. First implementation prompt

> Implement W5-B (Public Demo Narrative + Repo Readiness) per `docs/21_week_five_b_plan.md`. **Documentation only —
> do NOT touch any file under `src/`, `tests/`, `scripts/`, or `fixtures/`, and do NOT touch `package.json`,
> `package-lock.json`, `.gitignore`, or any build config.** Do NOT add live calls, CLI Anthropic wiring, a new
> provider adapter, a new dependency, a new npm script, a new CLI subcommand, or any product surface. Do NOT add
> tests. Do NOT run any `example:real-*` proof with a live key.
>
> 1. Re-author `README.md` as a front door (§3.1): lead with *what Blackbox is*, the core loop with one-line verb
>    meanings, *what it proves* in plain language, and a **corrected Status line** reflecting the true current state
>    (post-W5-A, tagged `week-five-trace-fixture-corpus`, 360 tests offline) — replacing the stale "W4-D is
>    complete" headline. **Retain** every milestone `✓` section but move them below the narrative under a "Build
>    history" heading. Keep Quick Start.
> 2. Add to `README.md` a concise **"What Blackbox is / is not"** section (§3.3) and a **"Proof status"** section
>    (§3.4: fake/offline default loop; opt-in Anthropic proof scripts; fixture regression corpus; no
>    UI/backend/dashboard/observability). Prefer pointing at DEMO's existing real-vs-mocked table over duplicating
>    it.
> 3. Add to `README.md` a **"For reviewers"** block (§3.5) with the exact path: `npm install`; `npm test -- --run`
>    (360, offline, zero live calls); `npm run cli -- check` (one-shot PASS); `npm run fixtures:generate` (check
>    mode, corpus in sync) — each line annotated with what it proves, no overclaim.
> 4. Polish `DEMO.md` (§3.2): fix `321` → `360` in Prerequisites; add a short closing **fixtures** note so the
>    walkthrough ends on `… → verify → check → fixtures`; re-confirm every command block against the real CLI.
> 5. Run the **command verification plan** (§5): execute every command referenced in the edited docs and confirm the
>    doc matches reality (counts, output shapes, PASS verdicts). Confirm every script name referenced exists in
>    `package.json`. Confirm the `example:real-*` scripts fail safely at the key guard **without** a live run. Do NOT
>    run any with-key live proof.
> 6. Do a **no-overclaim pass** (§3.6) over both files — nothing may claim production readiness, a shipped SDK, a
>    published package, live-by-default behavior, a UI, or any unproven capability.
> 7. Add a `docs/08_build_log.md` W5-B entry: docs-only change, files touched, and confirmation the test total is
>    **unchanged at 360** (docs cannot change it).
>
> Acceptance: `README.md` leads with a current, accurate narrative and correct Status; the "is / is not", "Proof
> status", and "For reviewers" sections are present and non-overclaiming; `DEMO.md` says 360 and ends on the
> fixtures step; every documented command was run and matches its description; no file under `src/`/`tests/`/
> `scripts/`/`fixtures/` and no `package.json`/`.gitignore`/build config changed; `git status` shows only
> `README.md`, `DEMO.md`, `docs/08_build_log.md` (and this plan doc) modified; `npm test -- --run` still 360/360,
> zero live calls. Then summarize per the CLAUDE.md response format (files changed / real / mocked / tests / next
> safest task).

---

## 9. Codex audit prompt

> Audit the W5-B implementation against `docs/21_week_five_b_plan.md`, `CLAUDE.md`, and `AGENTS.md`. Verify:
>
> 1. **Documentation-only.** `git diff --stat` shows changes confined to `README.md`, `DEMO.md`,
>    `docs/08_build_log.md`, and `docs/21_week_five_b_plan.md`. **No file under `src/`, `tests/`, `scripts/`, or
>    `fixtures/`, and no `package.json`, `package-lock.json`, `.gitignore`, or build config, changed.** Confirm via
>    diff.
> 2. **No runtime/test/fixture impact.** `npm test -- --run` is still **360/360**, zero live calls, no key present.
>    The corpus under `fixtures/traces/` is byte-identical; `npm run fixtures:generate` (check mode) still reports in
>    sync. `git ls-files traces` is empty; `git ls-files fixtures/traces` still lists exactly the five committed
>    fixtures.
> 3. **Every documented command is real and accurate.** Every command in `README.md`/`DEMO.md` maps to a real
>    `package.json` script or `cli` subcommand and behaves as the doc says (run them: `check` → single PASS,
>    `verify` → 4/4, `fork`/`diff` → first divergence at index 3, `fixtures:generate` → in sync). The claimed test
>    count (360) matches reality in **both** files. No doc names a script or subcommand that does not exist.
> 4. **Status is current, not stale.** The README no longer headlines "W4-D complete"; it reflects post-W5-A state
>    (`week-five-trace-fixture-corpus`, 360 tests). The milestone `✓` history is retained (not deleted) and re-framed
>    as build history.
> 5. **No overclaim.** Nothing claims production readiness, a shipped/published SDK or binary, live-by-default
>    behavior, a UI/backend/dashboard, or any capability the code does not prove. The opt-in, human-run, never-in-
>    `npm test`, never-CLI-wired nature of the Anthropic proofs is stated accurately. The fake/offline default and
>    structural-offline replay are described correctly.
> 6. **Guardrails held.** No Anthropic CLI wiring, no live tests, no new provider adapter, no new dependency, no new
>    script/subcommand, no UI/backend/observability surface, no live proof run introduced. The "is / is not" and
>    "Proof status" sections do not contradict `AGENTS.md`/`CLAUDE.md` guardrails.
>
> Report any drift between the plan, the docs, and the code before the milestone is tagged.

---

## 10. Optional later Fable prompt (narrative polish)

> *(Optional, only after Codex accepts the W5-B docs and only if a final prose pass is wanted. Fable is a narrative
> stylist here, not a decision authority — it may reword for clarity and flow but may not add, remove, or soften any
> factual claim, command, count, or guardrail.)*
>
> Do a light narrative-polish pass over the W5-B `README.md` (and, if useful, the `DEMO.md` intro) for a first-time
> reader landing on the repo cold. Improve flow, opening hook, and skimmability of the "What Blackbox is",
> "is / is not", "Proof status", and "For reviewers" sections. **Constraints:** change no command, no script name,
> no test count (360), no tag name, and no factual claim; do not introduce any new capability claim or soften any
> guardrail; do not claim production readiness, a published package, or live-by-default behavior; keep the
> fake/offline-default and opt-in-live-proof framing exactly as audited. Preserve the retained milestone `✓` build
> history. Output only reworded prose within the existing structure — no structural or factual change that would
> require a re-audit. If any suggested wording would alter a fact, stop and flag it instead of applying it.
