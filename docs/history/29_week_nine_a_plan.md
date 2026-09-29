# W9-A — Cassette CI Harness (`assert`)

**Status:** IMPLEMENTED / in closeout.
**Intended tag:** `week-nine-cassette-assert`.
**Precondition:** clean tree at `8741024` (`week-eight-readme-hero`), 489/489 offline baseline.

## 1. One-sentence scope

Add one CLI command, `assert`, that makes a committed cassette usable as a
deterministic, offline CI regression test — composing the existing `verifyTrace`
invariants with the existing `terminalOutcome` / `toolCallSequence` reads under
declarative, exact-match expectations, and returning exit 0/1.

## 2. Command

```
npm run cli -- assert --trace <path> [expectation flags]
```

Expectation flags (all optional; a check row is created only for a supplied flag):

- `--trace <path>` — **required** (unlike `verify`, which defaults to a demo trace;
  a CI assertion must be explicit about which cassette it pins).
- `--expect-status <success|error|incomplete>` — enum-validated; `die()` otherwise.
- `--expect-final-answer <string>` — exact string equality vs `terminalOutcome().finalAnswer`.
- `--expect-failure-reason <string>` — exact equality vs `failureReason`.
- `--expect-tools <comma-separated>` — exact ordered equality vs `toolCallSequence()`.
  Empty string ⇒ `[]` (assert a final-answer-only run); otherwise split on comma
  and trim each entry.

## 3. Semantics (locked)

- Fully offline; no model/tool/network call is constructible in this path.
- Exact match only — no fuzzy, normalized, or semantic comparison (W7-B precedent).
- Expectations come from CLI flags, never the cassette itself, never a sidecar file.
- Exit 0 only when verification passes **and** all supplied expectations pass.
- Exit 1 on: invariant failure, expectation failure, load/JSON/version failure,
  missing `--trace`, bad enum, unknown flag, or missing flag value.
- If verification fails, supplied expectation checks become `skip` (never silent
  pass); the outcome/tool reads are not consulted for comparison. Absent flags
  produce no rows.

## 4. Design decisions (Codex-audited)

- **Name `assert`** — fits the single-verb CLI grammar; no collision with `verify`
  (internal soundness), `check` (full record→…→diff loop), or `npm test`. The
  relationship is `verify ⊂ assert`: `assert` runs the four `verifyTrace`
  invariants unchanged, then layers declared behavioral expectations.
- **Compose, don't modify** — a new pure module `src/workflow/assertCassette.ts`
  (beside `selfCheck.ts`) calls `verifyTrace` / `terminalOutcome` /
  `toolCallSequence` as-is. `AssertReport` embeds the existing `VerifyReport`.
  `assertCassetteFile` mirrors `verifyTraceFile`'s honest-fail contract (load
  failure ⇒ FAIL report, never a throw) by delegating the load-failure verdict to
  `verifyTraceFile` itself.
- **Flags, not sidecar** — a sidecar expectation file would be new committed schema
  surface to version/freeze/audit; rejected for W9-A. Cassette-self-reference is
  circular (the `replayability` invariant already checks replay-vs-claim). CI
  intent lives in the npm script / workflow YAML, where flags are diff-reviewed.
- **Rendering** — reuse the W8-A helpers only (`header` / `kv` / `verdict` /
  `section` / `GLYPH`); the expectations rows reuse the same `name/status/detail`
  table shape as `verify`'s invariant rows for visual consistency (no per-row
  glyph — the `verdict` line carries `✓`/`✗`). No `termStyle` change, no new glyph
  or color. On verify failure, reuse `formatVerifyFailure`; on expectation failure,
  a local `check:` / `expected:` / `actual:` / `action:` block.

## 5. Files changed

| File | Action |
|---|---|
| `docs/29_week_nine_a_plan.md` | add (this plan) |
| `src/workflow/assertCassette.ts` | add (pure module) |
| `src/cli.ts` | edit (`runAssert` + flag constants + usage line + dispatch case + unknown-subcommand valid list) |
| `tests/assertCassette.test.ts` | add |
| `tests/cliAssert.test.ts` | add |
| `tests/cliNoAnsi.test.ts` | edit (assert pass/fail/bad-flag + CI-present cases) |
| `README.md` | edit (command list, Quick Start, CI section, Status advance) |
| `DEMO.md` | edit (assert walkthrough + What-Is-Real row) |
| `docs/08_build_log.md` | edit (W9-A entry) |
| `CLAUDE.md` / `AGENTS.md` | edit (current-state pointers) |

## 6. Explicitly untouched

`fixtures/` (read-only test input — **no fixture rewrite**), `scripts/`,
`package.json`, `package-lock.json`, `.gitignore`, `assets/brand/` (README hero
frozen), trace schema / `hash.ts` / canonical hashing, `verifyTrace` /
`verifyTraceFile` behavior, `terminalOutcome` / `toolCallSequence` behavior,
`replayTrace`, `forkRun`, `runSelfCheck`, `diffTraces` / `diffOutcome`,
`termStyle.ts`, the four frozen formatters, and every other command's output
(especially `check`, which stays byte-identical). No new dependency, exit code,
sidecar format, npm script, or `.github/workflows/` file.

**`docs/11_cli_spec.md` is a historical W3-A CLI spec and is deliberately left
untouched in W9-A** — it is a point-in-time artifact, not a living contract;
updating it is deferred rather than done here.

## 7. Tests

`tests/assertCassette.test.ts` (pure): pass for each expectation type; fail for
wrong status / answer / reason / tools (content, order, too-few, too-many);
final-answer expectation on an error trace fails with `actual "(none)"`; empty
`expectTools` passes a final-answer-only fixture; no-expectations mode passes
invariants-only with no rows; invariant failure ⇒ supplied expectations `skip`
(and absent ones produce no rows); `assertCassetteFile` on a missing file ⇒ FAIL
report, no throw; purity (input trace not mutated).

`tests/cliAssert.test.ts` (CLI): the three documented pass paths exit 0;
no-expectations passes; wrong expectation exits 1 with the expected/actual/action
block; missing `--trace` / bad enum / unknown flag exit 1 on stderr; stdout
byte-identical across two runs.

`tests/cliNoAnsi.test.ts`: assert pass path, failing-expectation path, missing
`--trace` and bad-enum stderr paths, and a CI-present assert stdout case — all
escape-free.

## 8. Acceptance criteria

`assert` exits 0 on a committed fixture with correct expectations and 1 on any
failure; invariants render and gate expectations (`skip` on invariant failure);
load failure ⇒ FAIL + exit 1, no throw; output uses the W8-A grammar and is
escape-free on non-TTY/CI and byte-identical run-to-run; all frozen surfaces and
`check` stdout unchanged; fixtures byte-identical and in sync; full suite green
with zero live calls and no API key.

## 9. Failure conditions (stop, don't improvise)

- Any needed change to `verifyTrace` / `terminalOutcome` / schema / hashing ⇒ abort.
- Expectation semantics drifting to fuzzy/semantic matching ⇒ abort.
- Temptation toward a sidecar file, npm script, or committed workflow ⇒ defer.
- Any other command's stdout or a fixture byte changes ⇒ abort and diagnose.
- Committed fixtures not satisfying the documented example ⇒ fix docs, never fixtures.
