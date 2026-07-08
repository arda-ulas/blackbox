# W9-B Plan — Public-Readiness Refresh (docs-only)

**Status:** IMPLEMENTED (documentation slice). This document is the accepted plan and historical record; the sections
below describe what was planned and carried out in a docs-only slice.
**Predecessor:** W9-A is **complete and tagged** (`week-nine-cassette-assert`). The cassette CI harness — the
`assert` command — is the most recent technical milestone: it turns a committed cassette into a deterministic
offline PASS/FAIL regression test by composing the `verifyTrace` invariants with exact-match expectations over the
replayed terminal outcome and tool-call sequence. Tests: 522/522 offline, zero live calls. The CLI is nine commands.
**Mode:** documentation / public-readiness polish only. **No source, test, fixture, `package.json`, `package-lock.json`,
or `.gitignore` change.** No live calls, no CLI Anthropic wiring, no new provider adapter, no product-surface
expansion.
**Tag policy:** after Codex closeout audit and push, this docs refresh may be tagged `week-nine-public-readiness`.

---

## 1. Problem statement

W9-A landed the `assert` command and closed cleanly under `week-nine-cassette-assert`. The runtime is done and
protected; what needs a pass now is how the repository **reads to a stranger** — a reviewer, a hiring manager, or a
future collaborator landing on the repo cold after W9-A closed.

Concretely:

1. **README Status is written in in-flight, milestone-code language.** It headlines *"Week Nine cassette CI harness
   (W9-A) — implemented / in closeout"* and lists an *"intended tag"*. Both go stale the moment `week-nine-cassette-assert`
   is tagged (it is), and the W-code narrative reads as internal build-log shorthand, not a front door.

2. **`assert` is under-surfaced in "What Blackbox is."** The command exists and is documented lower in the README,
   but the top-of-file capability list does not yet name the single new capability crisply: a committed cassette
   becomes a deterministic offline CI regression test using exact expectations, fully offline.

3. **`CLAUDE.md` / `AGENTS.md` current-state pointers describe W9-A as in closeout.** With W9-A tagged, those
   pointers should read as *complete and tagged*, and the next task should point at the W9-B closeout flow — not at
   closing W9-A.

**Thesis:** the code is demo-ready and the most recent milestone (cassette assertions) is tagged; W9-B makes the
*repo* read correctly to a stranger **without adding a single runtime feature** — it rewrites the README Status in
durable public language, adds one precise `assert` capability bullet, appends the missing build-history entries, and
refreshes the two agent-instruction files' current-state pointers. No code, tests, fixtures, or config change.

---

## 2. Durability rule (why the wording matters)

A public-readiness refresh must not introduce wording that becomes false the instant it is tagged. W9-B explicitly
**avoids**:

- "W9-B in closeout" / "W9-B implemented / in closeout" as a public-state pointer.
- "intended tag …".
- calling `week-nine-cassette-assert` "the latest tag" in the README Status (a later tag will supersede it).

W9-B **uses** durable wording instead:

- W9-A is **complete and tagged** as `week-nine-cassette-assert`.
- W9-B is a **documentation-only public-readiness refresh**.
- Most recent technical milestone: **cassette assertions** (`week-nine-cassette-assert`).
- W9-B tag policy: this docs refresh **may be tagged** `week-nine-public-readiness` **after closeout**.

---

## 3. Scope

### 3.1 README Status — durable public language

Rewrite the Status section in concise, stranger-facing language: a local deterministic time-travel debugger; trace
schema **v2**; **522/522** offline tests; **cassette assertions complete**; most recent technical milestone: cassette
assertions (`week-nine-cassette-assert`). No W-code soup. Do not say "latest tag" (a later tag supersedes it) —
prefer "most recent technical milestone." The hero, the core-loop string, and `assert`'s position **outside** the
core loop are unchanged.

### 3.2 One `assert` capability bullet under "What Blackbox is"

Add one precise bullet: a committed cassette becomes a **deterministic offline CI regression test using exact
expectations, fully offline**. This surfaces the W9-A capability in the top-of-file list without moving `assert`
into the core loop.

### 3.3 Build history — append W8-B and W9-A

Append the two missing build-history sections (W8-B README hero polish, W9-A cassette CI harness) in the established
format, sourced from `docs/08_build_log.md`. Do **not** add a W9-B build-history section that claims an uncreated
commit or tag; leave W9-B out of the README build history until after tagging.

### 3.4 `CLAUDE.md` / `AGENTS.md` current-state pointers

Narrow current-state refresh only: state W9-A is **complete and tagged**; state W9-B is a **docs-only
public-readiness refresh**; no "in closeout" / "intended tag" wording; re-point the next task to the W9-B closeout
flow (Codex closeout audit → commit → push → tag `week-nine-public-readiness`). Guardrails, invariants, build-scope
rules, agent-role tables, and every historical milestone entry are preserved verbatim.

### 3.5 `docs/08_build_log.md` — append a W9-B entry

Append a W9-B entry describing the completed documentation edits only. Do not claim a commit or tag exists yet; state
the tag policy is `week-nine-public-readiness` after closeout.

---

## 4. Allowed files (exhaustive)

`README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/30_week_nine_b_plan.md`, `docs/08_build_log.md`. Any diff outside this
set is out of scope.

**Explicitly NOT touched by W9-B (guardrail):**
- `DEMO.md`
- `docs/11_cli_spec.md`
- Anything under `assets/brand/`, `src/`, `tests/`, `fixtures/`, `scripts/`.
- `package.json`, `package-lock.json`, `.gitignore`.
- Any command output or runtime behavior.

---

## 5. Verification plan

Because W9-B changes no code, verification confirms the docs match reality and nothing outside the allowed set moved:

```sh
git status --short --branch --untracked-files=all
git diff --name-only
git diff --check
npm test -- --run                     # still 522/522, zero live calls
npm run fixtures:generate             # check mode: corpus in sync, writes nothing
npx tsx src/cli.ts check              # run twice, compare stdout/stderr byte-for-byte
git ls-files traces                   # empty — no cassette committed
git diff --name-only HEAD -- DEMO.md src tests fixtures scripts package.json package-lock.json .gitignore assets/brand docs/11_cli_spec.md
rg -n '^export const CURRENT_TRACE_VERSION|CURRENT_TRACE_VERSION\s*=' src   # schema v2 unchanged
```

Manual checks: README Status contains no milestone-code narrative, does not say "W9-B in closeout", does not say
"intended tag", and does not call `week-nine-cassette-assert` the latest tag; the core-loop string is unchanged;
`assert` remains outside the loop; `DEMO.md` and `assets/brand/` are unchanged.

---

## 6. Non-goals

- No source, runtime, test, fixture, `package.json`, `package-lock.json`, or `.gitignore` change.
- No new capability claim — W9-B may only describe what the code already proves.
- No `DEMO.md`, `docs/11_cli_spec.md`, or `assets/brand/` change.
- No UI/backend/dashboard/observability, no Anthropic CLI wiring, no live proof run, no new provider adapter, no new
  dependency.
- No in-flight lifecycle wording ("in closeout" / "intended tag") introduced into any public-state pointer.

---

## 7. Rollback plan

W9-B is purely documentation. Revert is `git checkout -- README.md CLAUDE.md AGENTS.md docs/08_build_log.md` (and, if
undesired, delete `docs/30_week_nine_b_plan.md`). Because no code, test, fixture, or config file is touched, reverting
W9-B cannot affect any runtime behavior, any test outcome, or the fixture corpus. The loop and the 522-test suite are
identical with or without W9-B.
