# W8-A Plan — Terminal Experience Polish

**Status:** PLANNED (plan-only commit; awaiting Codex plan audit before any implementation). No source, test,
fixture, or package change accompanies this document.

**Predecessor:** W7-B complete, pushed, tagged `week-seven-behavioral-outcome-diff` (HEAD `7db2258`). The full core
loop is implemented, hardened, composed under one self-check, proven live (opt-in), frozen against a committed
regression corpus, release-frozen with truthful docs, derives the offline continuation answer from the mutated
`tool_result` (W7-A), and reports a behavioral `Outcome:` verdict on `diff` / `fork` (W7-B):
`record → replay → fork → mutate → continue → diff → verify → check`. Tests: **442/442** offline, zero live calls.

**Intended tag:** `week-eight-terminal-polish`.

**Mode:** presentation-only slice across the whole CLI surface. **No change to canonical hashing, trace schema,
replay semantics, `replayTrace` return values, `forkRun`, `runSelfCheck` logic, the `diffTraces()` computation, the
`TraceDiff` / `OutcomeDiff` / `VerifyReport` shapes, fixture bytes, provider adapters, or the CLI command/flag/
exit-code surface.** No live calls, no Anthropic CLI wiring, no new provider adapter, no new dependency, no
UI/backend/dashboard/observability surface, no animations, no mascot, no timeline/branch-graph rendering.

**The one deliberate exception to byte-identity:** `check` stdout is re-baselined **once**, on purpose, as part of
adopting the shared visual grammar. This is the only planned deviation from the "stdout byte-identical" invariant
that W6/W7 held, and it is called out explicitly here (§4, §7) so the closeout audit expects it rather than flagging
it as drift. After the re-baseline, `check` output is deterministic and byte-identical **run-to-run**; only the
frozen text changes, and only this once.

---

## 1. Problem statement

Blackbox is functionally complete and demo-truthful, but the terminal output was grown command-by-command and shows
its seams:

- **Inconsistent banners.** Every command opens with an ad-hoc `[blackbox] --- <name> ---` line; subsections use a
  second, differently-shaped `--- x ---` rule. There is no single grammar.
- **Duplicated alignment logic.** `runReplay`, `runFork`, and `runCheck` each define their own local
  `label = (s) => s.padEnd(N)` closure with a hand-picked width. Alignment is therefore inconsistent across
  commands and re-implemented three times.
- **Flat hierarchy.** The verdict lines that matter most — `First divergence`, the `Outcome:` behavioral verdict,
  `PASS`/`FAIL` — are rendered in the same weight as routine key/value rows, so the eye has nothing to land on.
- **No color, ever.** Output is plain in every context. That is safe, but it leaves the "premium CLI" feel
  (Claude Code / Linear / Vercel energy) entirely on the table even in an interactive TTY where color is expected.

None of this is a correctness problem. It is purely how the existing, correct information is presented. W8-A closes
that gap without touching what the information *is*.

### Desired vibe

Clean, restrained, useful, beautiful. Aligned labels, a consistent banner grammar, subtle emphasis on the lines that
carry the verdict, restrained color in a TTY only. **Not** goofy, **not** dashboard-like, **not** a web UI. A tiny
wordmark glyph in the banner is acceptable; a mascot, animations, and any timeline/branch-graph visualization are
explicitly deferred (§6).

---

## 2. Current output surface (what exists today)

All CLI rendering lives in `src/cli.ts`. Every command prints through `console.log` with:

- a `[blackbox] --- <command> ---` banner (records/replay/fork/diff/verify/check/list/inspect),
- optional `--- <section> ---` sub-rules (e.g. `--- parent ---`, `--- events ---`, `--- summary ---`),
- per-command `label()` `padEnd` closures for key/value alignment (duplicated in `runReplay`, `runFork`, `runCheck`),
- verdict text produced by the pure formatters: `formatFirstDivergence` / `formatOutcomeDiff` (via `formatDiffReport`
  in `src/fork/diffTraces.ts`), `verifyExplain` (`src/trace/verifyExplain.ts`), and `stepLabels`
  (`src/trace/stepLabels.ts`).

`tests/cli.test.ts` asserts this output with ~123 string assertions (≈78 `toContain`, ≈45 `toBe`). The formatters
return strings only; their computation and the report shapes they read (`TraceDiff`, `OutcomeDiff`, `VerifyReport`)
are the frozen contract and stay unchanged.

---

## 3. Design

### 3.1 New pure module: `src/render/termStyle.ts`

Dependency-free, pure, fully testable. No I/O, no `process.env` read at module scope, no state.

**Structural helpers**

- `header(command: string): string` — one consistent banner grammar for every command (replaces the ad-hoc
  `[blackbox] --- x ---` line). May carry a tiny wordmark glyph (e.g. `◼ blackbox — <command>`). One grammar,
  applied everywhere.
- `section(name: string): string` — one consistent subsection rule (replaces the ad-hoc `--- x ---` sub-rules).
- `kv(label: string, value: string, width?: number): string` — a single aligned key/value renderer that replaces
  the three duplicated `label()` closures. Default `width` chosen to match the widest label in use so alignment is
  uniform across commands.

**Glyph policy (decorative only; text carries the meaning)**

- Allowed Unicode glyphs — exactly these five, no others: `✓` (pass), `✗` (fail), `→` (flow/divergence arrow),
  `▸` (list/step marker), `◼` (wordmark).
- `◼` is allowed **only** as a tiny optional wordmark glyph in the header (e.g. `◼ blackbox — <command>`). It is not
  used as a status/verdict marker anywhere.
- **Glyphs are decorative only — text labels must carry the meaning.** A glyph never stands alone as the sole
  semantic indicator: `✓`/`✗` always accompany the `PASS`/`FAIL` text, `→` accompanies the divergence text, `▸`
  precedes an already-labelled step. Stripping every glyph must leave output whose meaning is fully intact.
- No emoji. No mascot art. No box-drawing characters. No timeline/branch-graph rendering. No additional glyphs
  without a later plan patch.

**Color (hand-rolled ANSI, no dependency)**

- Helpers: `dim`, `bold`, `green`, `red`, `yellow`, `cyan` — each wraps a string in the corresponding SGR pair.
  ~15 lines total. No `chalk`, no new dependency.
- `colorEnabled({ isTTY, env }: { isTTY: boolean; env: NodeJS.ProcessEnv }): boolean` — the single gate. It returns
  `true` **only** when **all** hold:
  - `isTTY === true`, **and**
  - `NO_COLOR` is **not present** as a key in `env` (presence disables color regardless of its value — even empty
    string; this is the [NO_COLOR](https://no-color.org) convention, a presence check, **not** a truthiness check),
    **and**
  - `CI` is **not present** as a key in `env` (presence disables color regardless of value).
  - Presence is tested with `"NO_COLOR" in env` / `"CI" in env`, never `env.NO_COLOR`/`Boolean(env.CI)`.
- There is **no `--color` / `--no-color` flag** in W8-A — no new CLI flags are permitted this milestone, so explicit
  color flags are deferred. `NO_COLOR` (env) is the only opt-out.
- `colorEnabled` is a pure function of its injected inputs — it never reads `process.stdout` or `process.env`
  itself, so tests exercise the truth table by passing values, never by mutating the environment.
- The color helpers accept an `enabled` decision (threaded from the caller's `colorEnabled(...)` result) and emit
  plain text when disabled, so a single upstream decision governs the whole render. The default test capture path
  (non-TTY) therefore always produces plain, escape-free output.

**ASCII / portability fallback**

- Non-TTY / CI output remains **plain text with zero ANSI escapes** (the color gate is off there). This is
  text-first output; ANSI color is optional sugar layered only over an interactive TTY.
- The allowed glyphs may appear in the plain (non-TTY) text where the terminal grammar already places them, but —
  per the glyph policy above — they are **never the only source of meaning**; the adjacent text label always is.
- If implementation discovers glyph portability issues on any target terminal, **fall back to ASCII labels**
  (e.g. drop `◼` from the wordmark, render `PASS`/`FAIL` without `✓`/`✗`) rather than expanding scope or adding
  new configuration. Portability is resolved by removing decoration, never by adding a flag or dependency.

### 3.2 Restyle `src/cli.ts` command surfaces

Route record, replay, fork, diff, verify, check, list, and inspect through `header` / `section` / `kv` and the color
helpers. Delete the duplicated local `label()` closures in favour of `kv`. Give the verdict-bearing lines subtle
emphasis (bold/color on `PASS`/`FAIL`, on the first-divergence line, and on the `Outcome:` verdict; a glyph on
pass/fail) **without changing their text content** — the semantic anchors (`PASS`, `FAIL`, `Outcome:`,
`First divergence`) remain present as plain substrings so `toContain` assertions and downstream reading stay stable.

This is a call-site restyle. Flag parsing, exit codes, the `die()` control flow, and every computed value are
untouched (the `[blackbox error]` prefix text in `die()` may be restyled but its behavior — stderr + `exit(1)` — is
not).

**Stream-boundary guardrail.** W8-A **must not move** existing stdout content to stderr or existing stderr content
to stdout. It restyles the existing human-readable surfaces **in place** on whichever stream already carries them
(`console.log` → stdout, `console.error`/`die()` → stderr). Which stream each message uses, and the exit codes, are
unchanged. Any future machine-readable / JSON output mode is **out of scope** for this milestone.

### 3.3 Layout-only tweaks to existing formatters

`formatFirstDivergence`, `formatOutcomeDiff`, `verifyExplain`, and `stepLabels` may adjust **spacing, indentation,
label alignment, and glyph/emphasis** to fit the shared grammar. Their **computation and the report shapes they
consume (`TraceDiff`, `OutcomeDiff`, `VerifyReport`) are unchanged**, and `formatDiffReport`'s composition order is
unchanged. Any edit that changes *what* is computed rather than *how* it is spaced is out of scope.

---

## 4. `check` stdout re-baseline (the one deliberate deviation)

W6/W7 held `check` stdout byte-identical as a guard. W8-A **intentionally** breaks that once, because adopting the
shared banner/label grammar necessarily reshapes `check`'s output like every other command's. The rules:

1. The change is **deliberate and one-time**. `runSelfCheck` **logic and return shape** are untouched; only
   `runCheck`'s rendering in `src/cli.ts` changes.
2. `check`'s **exit code is unchanged** (`0` PASS / `1` FAIL), and the `runSelfCheck` **return shape** is unchanged.
3. **Before/after output capture is required during implementation** (§4.1) — the before capture is taken from the
   unmodified tree prior to any edit, the after capture from the finished implementation.
4. After the re-baseline, `check` output is **deterministic and byte-identical run-to-run** (no timestamps,
   randomness, or TTY-dependent content beyond the color gate, which is off in the non-TTY test/CI path).
5. Both captures are committed to `docs/08_build_log.md` under the W8-A entry so the one intentional stdout change is
   auditable and obviously deliberate.

### 4.1 Before/after capture (fill during implementation)

```
### BEFORE (pre-W8-A `npm run cli -- check`, non-TTY)
<PLACEHOLDER — paste the exact current output during implementation, before any edit>

### AFTER (post-W8-A `npm run cli -- check`, non-TTY)
<PLACEHOLDER — paste the exact new output during implementation>
```

Both captures also go into `docs/08_build_log.md` under the W8-A entry.

---

## 5. Files likely touched

| File | Change |
|---|---|
| `src/render/termStyle.ts` | **new** — pure styling module (header/section/kv/glyphs/color/colorEnabled) |
| `src/cli.ts` | restyle all eight command surfaces through termStyle; delete duplicated `label()` closures |
| `src/fork/diffTraces.ts` | layout-only tweaks to `formatFirstDivergence` / `formatOutcomeDiff` composition rendering; computation unchanged |
| `src/fork/diffOutcome.ts` | layout-only tweaks to `formatOutcomeDiff`; `diffOutcome` computation + `OutcomeDiff` shape unchanged |
| `src/trace/verifyExplain.ts` | layout-only tweaks; `VerifyReport` shape + verdict semantics unchanged |
| `src/trace/stepLabels.ts` | layout-only tweaks; computation unchanged |
| `tests/termStyle.test.ts` | **new** — colorEnabled truth table, kv alignment, forced-color rendering, no-ANSI |
| `tests/cli.test.ts` | hand-migrate output assertions to the new grammar; keep semantic anchors |
| `tests/replay.test.ts` / `tests/fork.test.ts` / `tests/verify*.test.ts` | update **only** where they assert formatted strings |
| `DEMO.md` | regenerate every expected-output block from real runs |
| `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/08_build_log.md` | status / test-count / current-state updates (+ before/after capture in build log) |
| `docs/27_week_eight_a_plan.md` | **this document** (created in the plan-only commit) |

**Frozen — must show an empty diff:** `src/trace/hash.ts`, `src/fork/forkRun.ts`, `src/replay/CassetteReplay.ts`
(logic), `src/workflow/selfCheck.ts` (logic), `scripts/generateFixtures.ts`, `fixtures/`, `package.json`,
`package-lock.json`, `.gitignore`. `tests/fixtures.test.ts` must pass **unmodified**.

---

## 6. Non-goals (explicitly out of scope)

- No schema, canonical-hash, replay-semantics, `replayTrace` return-value, `forkRun`, `runSelfCheck` logic,
  `diffTraces()` computation, or `TraceDiff` / `OutcomeDiff` / `VerifyReport` shape change.
- No provider / proof-script change; no fixture regeneration; no `scripts/generateFixtures.ts` change.
- No `package.json` / `package-lock.json` / `.gitignore` change; **no new dependency** (ANSI is hand-rolled).
- No new CLI command; no new CLI flag — deliberately **no** `--color` and **no** `--no-color` flag (`NO_COLOR` env
  is the only opt-out; explicit color flags are deferred because no new CLI flags are permitted this milestone); no
  exit-code change.
- No stdout↔stderr stream movement; no machine-readable / JSON output mode (both out of scope — see the
  stream-boundary guardrail in §3.2).
- No animations, spinners, or progress bars. No mascot art. No emoji. No box-drawing tables/characters. No timeline
  or branch-graph rendering (a branch graph is a real feature for a possible future milestone, **not** presentation
  polish). No web UI / dashboard / backend / observability surface.
- Glyphs limited to the five allowed by the §3.1 glyph policy — `✓ ✗ → ▸` for verdict/flow/step (decorative,
  text carries meaning) and `◼` **only** as the optional header wordmark. No additional glyphs without a later plan
  patch; anything animated or illustrated is deferred.

### 6.1 Command priority (all commands in scope; cut order if forced)

Restyling **all** commands is accepted and preferred: one shared renderer is precisely what prevents inconsistent
surfaces, and partial polish (a beautiful `fork` next to an untouched `check`) reads worse than none. But if
implementation becomes too large to land cleanly in one slice:

- **Highest priority (do first, never cut):** `fork`, `diff`, `check` — the demo's money path.
- **Cut order if forced:** drop `list` / `inspect` first, then `record` / `replay`.
- **Coherence gate:** no partial polish is pushed unless the resulting CLI still feels coherent as a whole — a
  consistent grammar across whatever set of commands did ship, with no half-restyled command.

---

## 7. Test plan

1. **`tests/termStyle.test.ts` (new, pure):**
   - `colorEnabled` truth table across `isTTY × NO_COLOR-present × CI-present` (all 8 combinations); returns `true`
     **only** when `isTTY === true` AND `NO_COLOR` is not present in `env` AND `CI` is not present in `env`.
     Presence is tested by key presence (`"NO_COLOR" in env`), not truthiness — include a case where
     `NO_COLOR: ""` (empty string) is present and still disables color.
   - `kv` alignment (labels pad to a consistent column; value column starts at a fixed offset).
   - forced-color rendering via **injected** config (pass `enabled: true`), asserting the expected SGR pairs; and
     forced-plain via `enabled: false`, asserting no escapes. **No `process.env` mutation** anywhere in the suite.
2. **No-ANSI guard (stdout AND stderr):** in the non-TTY test harness, assert **zero** `\x1b[` (regex literal
   `/\x1b\[/`) escapes on both streams:
   - for every existing command's **success path**, captured non-TTY **stdout** contains no `\x1b[` escape;
   - for the existing **error paths**, captured non-TTY **stderr** contains no `\x1b[` escape — including
     `die()` / missing-required-flag / unknown-flag cases;
   - both streams stay escape-free under `NO_COLOR` present and under `CI` present, as well as under plain non-TTY.
   This is the structural guarantee that color never leaks into piped/CI output on either stream.
3. **Determinism:** run `check` twice in-suite and assert the two outputs are byte-identical to each other (the
   re-baselined text is stable run-to-run).
4. **CLI assertion migration:** update `tests/cli.test.ts` exact-string assertions **by hand** to the reviewed new
   output (not blind snapshot regeneration). Keep semantic anchors — `PASS`, `FAIL`, `Outcome:`, `First divergence`
   — present and asserted so future presentation tweaks don't silently drop a verdict.
5. **Untouched suites:** `tests/fixtures.test.ts` passes **unmodified**; `tests/traceOutcome.test.ts`,
   `tests/diffOutcome.test.ts` (report-shape tests), and the hash/schema/fork tests pass **without** behavior
   changes. Any required edit to those files is a scope-violation signal.

---

## 8. Acceptance criteria

- One shared visual grammar (banner → sections → aligned labels → emphasized verdict) across all eight commands; no
  stray old-style `[blackbox] --- x ---` banner remains unless explicitly retained by the new grammar.
- `npm test -- --run` green (442 + new), fully offline, zero live calls, no API key required.
- Piped / `NO_COLOR` / `CI` output contains **zero** ANSI escapes; TTY output shows restrained color.
- `check` exits `0`/`1` exactly as before, and its output is byte-identical **run-to-run** after the documented
  one-time re-baseline; before/after captured in the plan doc (§4.1) and build log.
- `replayTrace` / `runSelfCheck` / `diffTraces` / `verifyTrace` / `diffOutcome` **return values** byte-identical
  (only rendering changed).
- `npm run fixtures:generate` reports the corpus in sync; `git diff` on all frozen paths (§5) is empty;
  `tests/fixtures.test.ts` unmodified.
- Every `DEMO.md` expected-output block matches a fresh real run character-for-character.
- `README.md` / `AGENTS.md` / `CLAUDE.md` / `docs/08_build_log.md` updated honestly (status, test counts,
  current-state pointers, before/after capture).

---

## 9. Risks

1. **Assertion churn.** `tests/cli.test.ts` has ~123 output assertions; restyling touches most. *Mitigation:* lock
   the output grammar in this plan doc before implementation so assertion updates are transcription, not design;
   migrate by hand; keep semantic anchors stable.
2. **`check` stdout re-baseline precedent.** Audits have been trained to flag any `check` diff as drift.
   *Mitigation:* §4 declares the one-time re-baseline loudly, with before/after capture, so the closeout audit
   expects exactly one intentional text change and nothing more.
3. **ANSI leakage (both streams).** Color escaping into piped/CI **stdout or stderr** would corrupt scripts and
   snapshots. *Mitigation:* the structural no-ANSI guard test (§7.2) over every command's non-TTY stdout **and**
   error-path stderr, plus the single `colorEnabled` gate and the `NO_COLOR`/`CI` presence check.
4. **Scope creep into visualization.** "Timeline / branch graph" is seductive and explicitly out (§6).
   *Mitigation:* the audit prompts check for any visualization, box-drawing, animation, or new dependency.
5. **Glyph portability.** `✓ ✗ → ▸ ◼` render safely in modern terminals; exotic glyphs/emoji are rejected (§6), and
   glyphs are decorative (text carries meaning). *Mitigation:* the five-glyph allow-list is fixed in this plan, and
   the documented fallback is to drop to ASCII labels rather than expand scope if a target terminal misbehaves.

---

## 10. Implementation prompt draft (Sonnet)

```
Implement W8-A exactly as scoped in docs/27_week_eight_a_plan.md.

Goal: one consistent, restrained, premium terminal grammar across record /
replay / fork / diff / verify / check / list / inspect — presentation only,
zero behavior change.

Build:
1. src/render/termStyle.ts — pure, dependency-free: header(), section(),
   kv(); allowed glyphs are exactly five — verdict/flow/step (checkmark,
   cross, right-arrow, right-triangle) plus the filled-square wordmark, used
   ONLY as the optional header wordmark. Glyphs are decorative; text labels
   carry the meaning (PASS/FAIL/etc. must read correctly with every glyph
   stripped). Hand-rolled ANSI (dim/bold/green/red/yellow/cyan) and
   colorEnabled({isTTY, env}) — returns true ONLY when isTTY === true AND
   "NO_COLOR" is NOT a key in env AND "CI" is NOT a key in env (PRESENCE
   check via `"NO_COLOR" in env` / `"CI" in env`, NOT truthiness; NO_COLOR:""
   still disables). Pure functions of injected inputs; never read
   process.env / process.stdout inside the module; no env mutation in tests.
   Do NOT write any literal ESC byte in source or tests — represent it as
   "\x1b" / /\x1b\[/.
2. Restyle all cli.ts command surfaces through it; delete the duplicated
   label() closures. Emphasize PASS/FAIL, the first-divergence line, and the
   Outcome: verdict WITHOUT changing their text (keep PASS/FAIL/Outcome:/
   First divergence as plain substrings). Layout-only tweaks allowed in
   formatFirstDivergence, formatOutcomeDiff, verifyExplain, stepLabels —
   computation and report shapes untouched. Do NOT move any existing stdout
   content to stderr or vice versa; restyle in place. No new --color /
   --no-color flag. Priority if the slice must shrink: keep fork/diff/check;
   cut list/inspect first, then record/replay; never ship half-restyled.
3. BEFORE editing, capture the exact current `npm run cli -- check` output
   (non-TTY) into the plan doc §4.1 BEFORE block and the build log. After
   implementing, capture the new output into the AFTER block. check exit code
   and runSelfCheck return shape stay unchanged.
4. tests/termStyle.test.ts (colorEnabled 8-row truth table over
   isTTY x NO_COLOR-present x CI-present incl. NO_COLOR:"" empty-present case,
   kv alignment, forced-color via injected config, forced-plain no-escape);
   a no-ANSI guard asserting zero /\x1b\[/ on non-TTY STDOUT for every
   command success path AND on non-TTY STDERR for error paths (die() /
   missing-flag / unknown-flag), under plain non-TTY, NO_COLOR-present, and
   CI-present; a check-run-twice byte-identity guard; hand-migrate
   cli.test.ts assertions to the grammar locked in the plan doc, keeping
   semantic anchors.
5. Regenerate every DEMO.md expected-output block from real runs; update
   README/AGENTS/CLAUDE/build-log status + test counts + before/after.

Hard constraints: no schema / hash / replay-semantics / replayTrace return /
forkRun / runSelfCheck-logic / runSelfCheck-return-shape / diffTraces-
computation / TraceDiff-OutcomeDiff-VerifyReport-shape / provider change; no
fixture regeneration (tests/fixtures.test.ts passes UNMODIFIED); no
scripts/generateFixtures.ts, package.json, package-lock.json, or .gitignore
change; no dependency; no new command/flag (incl. no --color/--no-color); no
exit-code change; no stdout<->stderr stream movement; no machine-readable/JSON
mode; no animation/spinner/mascot/emoji/box-drawing/timeline/branch-graph; no
literal ESC bytes in source or tests. Return values of replayTrace /
runSelfCheck / diffTraces / verifyTrace / diffOutcome byte-identical. check
stdout changes ONCE, deliberately — capture before/after.

Verify: npm test -- --run (all green, offline, zero live calls); npm run cli
-- check (exit 0, deterministic run-to-run); piped stdout AND error-path
stderr have no ANSI escapes; npm run fixtures:generate in sync; git diff empty
on all frozen paths.

Commit: feat: polish terminal experience
Do not push. Do not tag. Do not start next milestone.
```

---

## 11. Codex plan-audit prompt draft

```
Audit docs/27_week_eight_a_plan.md (W8-A — Terminal Experience Polish) as a
PLAN, before implementation. This is a presentation-only milestone.

Check:
1. Wiring soundness: does the design actually compose? colorEnabled is a pure
   function of injected {isTTY, env} using PRESENCE checks
   ("NO_COLOR" in env / "CI" in env, not truthiness); color helpers take the
   enabled decision; the non-TTY path is guaranteed escape-free on BOTH
   stdout and stderr. Confirm no hidden env or stdout read, and no literal
   ESC bytes anywhere in the plan prose.
2. The `check` stdout re-baseline is the ONLY declared deviation from
   byte-identity, is one-time, keeps exit codes AND the runSelfCheck return
   shape unchanged, and requires before/after capture. Flag if any other
   invariant is quietly relaxed.
3. Guardrails complete and consistent: no schema/hash/replay-semantics/
   replayTrace-return/forkRun/runSelfCheck-logic/runSelfCheck-return-shape/
   diffTraces-computation/TraceDiff-OutcomeDiff-VerifyReport-shape/provider/
   fixture/generator/package/dependency/new-command/new-flag (incl.
   --color/--no-color)/exit-code/stdout<->stderr-movement/JSON-mode change;
   no animation/mascot/emoji/box-drawing/timeline/branch-graph. Glyph policy
   coherent: five allowed glyphs, wordmark square header-only, glyphs
   decorative with text carrying meaning, ASCII fallback documented.
4. Scope realism: is the single shared module + call-site restyle the
   smallest useful version? Is the all-commands scope justified with a
   documented cut order (list/inspect first, then record/replay; keep
   fork/diff/check) and a coherence gate? Is assertion-churn mitigation
   (hand migration, locked grammar, semantic anchors) adequate?
5. Test plan sufficiency: does it structurally prevent ANSI leakage on
   stdout AND stderr (incl. error/die paths, under NO_COLOR-present and
   CI-present), prove run-to-run determinism, and leave fixtures/report-shape
   suites unmodified?

Return: verdict (ready to implement / needs patch) + specific patch list.
Do not implement.
```

---

## 12. Codex closeout-audit prompt draft

```
Audit W8-A (terminal experience polish) at commit <hash> against
docs/27_week_eight_a_plan.md. Presentation-only milestone.

Verify:
1. Frozen paths empty diff: src/trace/hash.ts, src/fork/forkRun.ts,
   src/replay/CassetteReplay.ts (logic), src/workflow/selfCheck.ts (logic),
   fixtures/, scripts/generateFixtures.ts, package.json, package-lock.json,
   .gitignore. tests/fixtures.test.ts unmodified.
2. Behavior identical: exit codes, flag parsing, error paths; return values
   of replayTrace / runSelfCheck / diffTraces / verifyTrace / diffOutcome
   byte-identical; runSelfCheck return shape unchanged; only rendering
   changed. TraceDiff / OutcomeDiff / VerifyReport shapes unchanged. No
   stdout<->stderr stream movement.
3. Color safety: colorEnabled returns true ONLY for isTTY && "NO_COLOR" not
   in env && "CI" not in env (PRESENCE, not truthiness; NO_COLOR:"" disables);
   a test structurally asserts zero /\x1b\[/ escapes in non-TTY STDOUT for
   every command AND non-TTY STDERR for error/die paths, under NO_COLOR-
   present and CI-present; no process.env mutation in tests; no literal ESC
   bytes in source or tests.
4. Determinism: check output byte-identical run-to-run; no timestamps,
   randomness, spinner, or TTY-dependent content besides the gated color.
5. The check-stdout re-baseline is the ONLY semantic-text change, is
   documented with before/after capture in the plan doc §4.1 and the build
   log, and exit codes + runSelfCheck return shape are unchanged. Flag ANY
   other stdout drift.
6. Scope creep: no new dependency, command, or flag (incl. --color/
   --no-color); no animation, mascot, emoji, box-drawing, or timeline/
   branch-graph rendering; glyphs limited to the five allowed (checkmark,
   cross, right-arrow, right-triangle, filled-square wordmark header-only),
   decorative with text carrying meaning.
7. DEMO.md blocks match real runs character-for-character; README / AGENTS /
   CLAUDE test counts and status truthful.

Return: verdict (ready to tag / needs patch) + specific patch list.
```

---

## 13. Sequencing

1. **This plan-only commit** (`docs: plan terminal experience polish`) — no source/test/fixture/package change.
2. **Codex plan audit** (§11) — resolve any patch list before implementing.
3. **Implementation** (§10, Sonnet) — `feat: polish terminal experience`; do not push, do not tag.
4. **Verification** — full green offline suite, no-ANSI guard, run-to-run determinism, frozen-path empty diff,
   fixtures in sync, DEMO regenerated.
5. **Codex closeout audit** (§12) — resolve any patch list.
6. **Push + tag** `week-eight-terminal-polish` — only after Codex accepts.

No implementation, push, or tag accompanies this document.
