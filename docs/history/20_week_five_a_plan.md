# W5-A Plan — Trace Fixture Corpus + Regression Harness

**Status:** PLANNED (not implemented). Plan-only document.
**Predecessor:** W4-G complete, pushed, tagged `week-four-fork-verify-workflow`
(`8445744` feat, `b878efd` docs cleanup). Full core loop proven and polished:
`record → replay → fork → mutate → continue → diff → verify → check`. Tests: 321/321 offline, zero live calls.
**Mode:** local TypeScript regression hardening only. No live calls, no CLI Anthropic wiring, no new provider
adapter, no product-surface expansion.

> This is the accepted-plan document for W5-A. Nothing here is implemented yet. Implementation happens in a
> later slice under the first-implementation prompt in §10.

---

## 1. Problem statement

The active-debugging loop is complete, individually hardened, and composed under one self-check (W4-G). But every
guarantee the loop makes — cassette schema compatibility, hash-chain integrity, provider neutrality, offline
replayability, fork-prefix hash identity, and stable first-divergence — is currently only ever exercised against
**freshly generated, in-process traces**. There is no *committed, frozen* trace that a future change is measured
against. Concretely:

1. **No committed reference cassettes.** Every test that touches a trace builds one at runtime via `runAgentLoop`
   / `TraceRecorder` and asserts on it in the same process. Nothing on disk pins the exact byte/January shape of a
   known-good v2 cassette. If a refactor silently changed the recorded payload shape, the canonical serialization,
   or the hash input fields, **the tests would regenerate the new shape and still pass** — they never compare
   against a previously-frozen artifact. The one guarantee we most want to protect (a cassette recorded today
   still loads, validates, and replays tomorrow) has no committed witness.

2. **Hash-input drift is invisible.** `hashTraceStepInput` hashes `{index, type, timestamp, payload, prevHash}`
   (`src/trace/hash.ts`). If someone reorders those fields, adds one, or changes `canonicalize`, the whole chain
   shifts. Runtime-only tests recompute both sides with the *same* new code, so the change is self-consistent and
   undetected. A committed fixture with a **frozen expected hash** turns that silent drift into a red test.

3. **Fork-prefix identity and first-divergence have no frozen witness.** `diffTraces` and `forkRun` are covered by
   in-process tests (`tests/fork.test.ts`, `tests/diffTraces.test.ts`), but the specific property "a committed
   parent and its committed child share a byte-for-byte hash-identical prefix and first diverge at exactly index
   N" is never asserted against artifacts that outlive the test run. This is the headline invariant of the whole
   tool; it deserves a frozen parent/child pair.

4. **Provider neutrality is only checked on ephemeral traces.** `auditTraceNeutrality` / `verifyTrace` are well
   tested, but never run against a committed corpus that a human can eyeball and that CI re-audits on every
   change. A committed corpus doubles as documentation of exactly what a clean, neutral v2 cassette looks like.

**Thesis:** freeze a small, fully fake/offline **v2 trace corpus** under version control and add a **regression
harness** that loads those committed cassettes and asserts every core invariant against them — including
**frozen expected hashes** so hash-input or canonicalization drift fails loudly. This is not product expansion; it
is a safety net around the *existing* core so future changes cannot silently break cassette compatibility,
replayability, verification, canonical hashing, fork-prefix identity, or first-divergence behavior. No runtime
semantics change.

---

## 2. Why W5-A is the next smallest milestone

- The loop and its composed self-check are done (W4-A…G). The one thing missing before any *new* work is a
  **frozen regression baseline** that protects what already exists. W5-A adds exactly that and nothing else.
- It is **pure additive test/fixture hardening**: a committed `fixtures/traces/` directory, one regression test
  file, and a small deterministic generator script. No change to `hash.ts`, `TraceTypes.ts`, `TraceRecorder`,
  `verifyTrace`, `neutrality`, `CassetteReplay`, `forkRun`, or `diffTraces` — the harness only *consumes* them.
- Everything is fake/offline and already-tested machinery; blast radius is a new directory plus tests. Reverting
  is deleting them.
- It directly de-risks every future milestone (W5-B+): any later change that would break cassette compatibility
  now trips a committed-fixture test instead of shipping silently.
- It is the smallest step that converts the loop's guarantees from "true in this process" into "true against a
  frozen artifact under version control."

---

## 3. Scope

Three cohesive pieces under one thesis. (1) the committed corpus and (2) the regression harness are primary; (3)
the generator is a small, guarded convenience.

### 3.1 Committed fake/offline v2 trace corpus (`fixtures/traces/`)

A new **committed** directory `fixtures/traces/` holding a handful of small, deterministic, sanitized v2
cassettes generated from the fake model + fixture tools. These are checked into git (unlike `traces/`, which stays
ignored). Every fixture:

- is schema **version 2** (`CURRENT_TRACE_VERSION`);
- is produced **only** from `FakeDeterministicModelClient` + `defaultToolExecutor()` — no Anthropic, no live, no
  provider-native content;
- is **timestamp-normalized** so it is byte-reproducible (see §7 — `runAgentLoop` stamps `Date.now()`, so raw
  output is not reproducible; the generator pins every `timestamp` and `createdAt` to a fixed constant and lets
  the standard hash chain recompute);
- passes `verifyTrace` (or, for the intentionally-terminal-error fixture, passes verify with a legitimate
  `run_failed` terminal and no false success claim);
- is provider-neutral by construction (`auditTraceNeutrality` clean).

Proposed fixtures (final names/count at implementation time; see §4):

| File | Kind | Purpose |
|---|---|---|
| `success-final-answer.v2.json` | success, no tools | Minimal happy path: model_input → model_output(final) → run_completed. |
| `success-tool-use.v2.json` | success, multi-tool | The demo path (search → calendar → booking → final). Exercises tool rounds + neutral `call-N` ids. |
| `error-unknown-tool.v2.json` | terminal error | A `run_failed` trace (unknown tool). Must *verify* (no success claim) and replay as `status=error`. |
| `fork-parent.v2.json` | fork parent | Normalized parent used for the fork/diff pair (same content as the tool-use success). |
| `fork-child.v2.json` | fork child | Forked from `fork-parent` with a tool-result mutation at the demo step; shares a hash-identical prefix and first diverges at the mutation index. |

Negative/tampered cases (bad hash, wrong version, leaked marker) are **not** committed as separate corrupt files —
they are derived **in-memory at test time** by mutating a loaded good fixture (mirroring `tests/verifyTrace.test.ts`).
This keeps the committed corpus 100% valid and neutral, and keeps the "junk cassette" surface out of version
control.

### 3.2 Regression harness (`tests/fixtures.test.ts`)

A new offline test suite that loads the committed corpus from disk and asserts every core invariant against it:

- **Schema version supported** — each fixture `loadTrace`s (no version rejection) and `version === CURRENT_TRACE_VERSION`.
- **Hash chain valid** — `validateTrace` passes for every fixture.
- **Frozen expected hashes** — a committed table of `{ fixture → final-step hash (or per-step hashes) }` is
  asserted, so any change to `hashTraceStepInput` field set, `canonicalize`, or the recorded payload shape fails
  loudly. (The expected hashes live in the test as constants, regenerated deliberately via §7 policy — never
  auto-relaxed.)
- **Provider neutrality clean** — `auditTraceNeutrality(trace).ok === true` for every fixture, and full
  `verifyTrace(...).invariants` for `provider_neutrality` is `pass`.
- **Offline replay succeeds where expected** — `replayTrace` returns `status: "success"` for the success
  fixtures (with the expected final `result`), and the error fixture replays as `status: "error"` with the
  expected `failureReason`.
- **Terminal error trace verifies appropriately** — `verifyTrace(error fixture).pass === true` (a legitimate
  `run_failed` run has no success claim, so replayability passes) — guarding the W4-F "don't falsely reject a
  terminal error" behavior against a frozen artifact.
- **Fork child shares a canonical-hash-identical prefix before divergence** — for the committed
  `fork-parent`/`fork-child` pair, `diffTraces` reports `hasDivergence`, `sharedPrefixLength > 0`, and every step
  `[0, sharedPrefixLength)` has `parent.steps[i].hash === child.steps[i].hash`.
- **First divergence remains stable** — `diffTraces(...).firstDivergenceIndex === <frozen index>` (the mutation
  step), asserted as a committed constant so a change to fork geometry or diff logic trips the test.
- **Corpus completeness guard** — the suite asserts the set of loaded fixtures matches an expected manifest, so a
  new fixture added without a test (or a deleted one) is caught.

All assertions are offline, fake/deterministic, zero live calls, zero network.

### 3.3 Deterministic fixture generator (`scripts/generateFixtures.ts`)

A small script that (re)generates the committed corpus deterministically. It exists so the corpus can be
regenerated intentionally when a v2 change is *deliberately* made (with an explicit human + Codex decision), never
as an automatic side effect. Discipline:

- **Deterministic:** pins every `timestamp` and `createdAt` to a fixed constant so re-running yields
  byte-identical files (see §7). It composes the existing fake/offline functions and the normalization helper —
  no new record/hash logic.
- **Guarded against accidental overwrite:** by default it runs in **check/verify mode** (regenerate in memory,
  compare to the committed files, exit non-zero on any drift **without writing**). It only writes when invoked with
  an explicit `--write` flag. This makes it safe to run in CI as a "corpus is in sync" check and impossible to
  clobber the corpus by accident.
- **No live path:** instantiates only `FakeDeterministicModelClient` + `defaultToolExecutor()`; cannot make a real
  call by construction.
- Optionally wired as `npm run fixtures:generate` (check mode) / `npm run fixtures:generate -- --write`; the exact
  npm alias is decided at implementation time (mirrors how W4-G left `example:check` optional). No new dependency.

---

## 4. Proposed fixture files

Under `fixtures/traces/` (committed):

- `success-final-answer.v2.json`
- `success-tool-use.v2.json`
- `error-unknown-tool.v2.json`
- `fork-parent.v2.json`
- `fork-child.v2.json`

Design notes:

- Names carry `.v2` to make the schema version legible at a glance and to leave room for a future `.v3` corpus
  without a confusing rename.
- `fork-parent.v2.json` and `success-tool-use.v2.json` may be **identical content** (the parent *is* the tool-use
  success run); they are kept as two files so the fork pair is self-documenting and the fork test does not depend
  on the success test's fixture. Decide at implementation time whether to dedupe; not required by acceptance.
- `fork-child.v2.json` is generated by `forkRun` over the **normalized** `fork-parent` (so the copied prefix keeps
  the parent's frozen hashes), then the whole child is normalized with the same rule. First divergence lands at
  the mutated tool_result step.
- The corpus is intentionally tiny (5 files, each a handful of steps) — enough to cover every invariant, small
  enough to eyeball in a diff.

---

## 5. Proposed source / test / doc file changes

**New (committed):**
- `fixtures/traces/success-final-answer.v2.json`
- `fixtures/traces/success-tool-use.v2.json`
- `fixtures/traces/error-unknown-tool.v2.json`
- `fixtures/traces/fork-parent.v2.json`
- `fixtures/traces/fork-child.v2.json`
- `tests/fixtures.test.ts` — the regression harness (§3.2, §6).
- `scripts/generateFixtures.ts` — deterministic generator, check-by-default (§3.3). Includes a small, local
  **normalization helper** (`normalizeTrace(trace, base)`: rebuild the step chain through a fresh `TraceRecorder`
  with a fixed timestamp so hashes recompute deterministically). The helper is fixture-tooling only.

**Edited (small, additive):**
- `.gitignore` — **critical gotcha (verified):** the current pattern `traces/` (no leading slash) also matches
  `fixtures/traces/`, so the corpus would be silently ignored. Anchor the existing ignore to the repo root by
  changing `traces/` → `/traces/`. This keeps the root generated-output directory ignored while allowing
  `fixtures/traces/` to be committed. Add a short comment explaining the anchor. (Verification in §6:
  `git check-ignore -v fixtures/traces/x.json` must return **nothing**; `git check-ignore -v traces/x.json` must
  **still** match.)
- `package.json` — *optionally* add `"fixtures:generate": "tsx scripts/generateFixtures.ts"` (check mode; pass
  `-- --write` to write). No new dependency. Decide at implementation time; not required by acceptance.
- `README.md` — a short "Trace fixture corpus" subsection: what `fixtures/traces/` is, that it is fake/offline
  only, and how to regenerate it deliberately (`fixtures:generate -- --write`) with the Codex-audit caveat.
- `docs/08_build_log.md` — W5-A entry (at implementation time), recording the post-W5-A test total.

**Not touched (behavior unchanged — the harness only consumes them):**
- `src/trace/hash.ts`, `src/trace/TraceTypes.ts`, `src/trace/TraceRecorder.ts`, `src/trace/verifyTrace.ts`,
  `src/trace/neutrality.ts`
- `src/replay/CassetteReplay.ts` (`loadTrace` / `validateTrace` / `replayTrace`)
- `src/fork/forkRun.ts`, `src/fork/diffTraces.ts`, `src/workflow/selfCheck.ts`, `src/agent/*` (including
  `AnthropicModelClient`), `src/cli.ts`.

---

## 6. Test plan

All offline, fake/deterministic, zero live calls, zero network. Target: 321 existing + new, all green.

**`tests/fixtures.test.ts` (loads the committed corpus from `fixtures/traces/`):**

- **Manifest completeness:** the set of `*.json` files in `fixtures/traces/` equals the expected manifest (catches
  an untested new fixture or an accidental deletion).
- **Per fixture — schema + chain:** `loadTrace` succeeds, `version === CURRENT_TRACE_VERSION`, `validateTrace`
  does not throw.
- **Per fixture — frozen hashes:** the fixture's final-step `hash` (and, for at least one fixture, the full
  per-step hash list) equals a committed constant. Any hash-input/canonicalization/payload drift fails here.
- **Per fixture — neutrality:** `auditTraceNeutrality(trace).ok === true`; `verifyTrace` `provider_neutrality`
  invariant is `pass`.
- **Success fixtures — replay:** `replayTrace` → `status: "success"` with the expected `result` string; full
  `verifyTrace(...).pass === true`.
- **Error fixture — replay + verify:** `replayTrace` → `status: "error"` with the expected `failureReason`;
  `verifyTrace(...).pass === true` (terminal error is not falsely rejected).
- **Fork pair — prefix identity:** `diffTraces(forkParent, forkChild)` → `hasDivergence === true`,
  `sharedPrefixLength > 0`, and `parent.steps[i].hash === child.steps[i].hash` for every `i` in the shared prefix;
  `forkChild.parentId === forkParent.id`.
- **Fork pair — stable first divergence:** `diffTraces(...).firstDivergenceIndex === <frozen mutation index>`.
- **Generator is in sync (optional but recommended):** import the generator's in-memory build and assert it equals
  the committed files (i.e. running check-mode would pass) — proving the corpus and generator cannot drift apart.

**`scripts/generateFixtures.ts` self-consistency (may live in the same test file or a tiny unit test):**
- `normalizeTrace` is idempotent (normalizing twice yields byte-identical output) and produces a `validateTrace`-clean chain.
- Check mode returns "in sync" for the committed corpus; a deliberately altered in-memory trace reports drift.

**`.gitignore` regression (documented manual check, run in the implementation slice):**
- `git check-ignore -v fixtures/traces/success-tool-use.v2.json` returns nothing (tracked).
- `git check-ignore -v traces/example-trace.json` still matches `/traces/` (root output still ignored).
- `git ls-files fixtures/traces` lists all five committed fixtures; `git ls-files traces` stays empty.

**Regression (must stay green, unchanged):**
- All existing suites unchanged and passing (`tests/cli.test.ts`, `tests/verifyTrace.test.ts`,
  `tests/selfCheck.test.ts`, `tests/fork.test.ts`, `tests/diffTraces.test.ts`, `tests/replay.test.ts`, etc.).
- `record` / `replay` / `fork` / `diff` / `verify` / `check` / `list` / `inspect` behavior unchanged.

---

## 7. Fixture generation / update policy

**Why normalization is required.** `runAgentLoop` appends steps without an explicit timestamp, so each step gets
`Date.now()`; `TraceRecorder` defaults `createdAt` to `Date.now()` too. Raw recorded traces are therefore **not**
byte-reproducible — their timestamps (and thus every hash) change on each run. To commit a stable corpus, the
generator normalizes: it rebuilds each trace through a fresh `TraceRecorder`, appending every step with a **fixed
timestamp** (e.g. `0`) and a **fixed `createdAt`**, letting the existing `hashTraceStepInput` recompute a
deterministic chain. Normalization uses only existing primitives (`TraceRecorder.append(type, payload, timestamp)`
and `loadPrefix`) — it changes **no** runtime semantics; it is fixture tooling.

**Determinism guarantees.** Fixed model scripts + fixed tool inputs + fixed timestamps ⇒ byte-identical files on
every regeneration. The `fork-child` is generated from the **normalized** `fork-parent` so the shared prefix keeps
identical hashes.

**Update procedure (deliberate, never automatic):**
1. A change to the v2 schema, recorded payload shape, `canonicalize`, or `hashTraceStepInput` is a **deliberate,
   explicitly-scoped** decision — it does not happen inside W5-A.
2. When such a change is intentionally made in a *future* milestone, regenerate with
   `tsx scripts/generateFixtures.ts --write`, then **update the frozen expected hashes** in `tests/fixtures.test.ts`
   in the same commit, with a build-log note and a Codex audit explaining *why* the frozen values changed.
3. The generator's **default (no `--write`) check mode** must pass in CI/`npm test` context: it regenerates in
   memory and compares to the committed files, so the corpus can never silently drift from the generator.
4. Never regenerate to make a failing regression test pass without understanding the drift — a changed frozen hash
   is a signal, not noise.

**Guardrails on the corpus itself:**
- Fake/offline only. No Anthropic/live/provider traces, ever. Nothing copied from `traces/`.
- Committed fixtures must always be valid and neutral (negative cases are derived in-memory at test time).
- The corpus stays tiny and human-reviewable.

---

## 8. Non-goals

- No web UI, dashboard, React, or any frontend.
- No hosted backend, remote fixture storage, auth, or sharing.
- No LangChain / LlamaIndex / MCP / agent framework.
- No Anthropic CLI wiring; no live tests; no new provider adapter; no `ANTHROPIC_API_KEY` path anywhere in the
  corpus, harness, or generator.
- No committing of any Anthropic/live/provider trace, or anything from `traces/`.
- No new runtime dependency; no production SDK, metrics, OTEL export, or observability platform. The corpus is a
  **regression baseline**, not a monitoring surface.
- **No change to hashing, the trace schema, `validateTrace`, `replayTrace`, `loadTrace`, `forkRun`, `diffTraces`,
  `verifyTrace`, `neutrality`, `TraceRecorder`, or the CLI** — W5-A only *consumes* and *freezes* them. (The
  generator's `normalizeTrace` is fixture tooling built from existing primitives; it adds no runtime behavior.)
- No cassette auto-migration/repair; no new mutation modes; no new fork geometry.
- No new CLI subcommand (the generator is a script, not a `blackbox` subcommand). If a convenience command is ever
  wanted, it is a separate, explicitly-scoped decision.
- No relaxing or auto-updating of frozen expected hashes to make a test pass.

---

## 9. Rollback plan

W5-A is **purely additive test/fixture/tooling**:

- Delete `fixtures/traces/`, `tests/fixtures.test.ts`, and `scripts/generateFixtures.ts`; revert the `.gitignore`
  anchor (`/traces/` → `traces/`), the optional `package.json` alias, and the `README.md` subsection.
- Because `hash.ts`, `TraceTypes.ts`, `TraceRecorder`, `verifyTrace`, `neutrality`, `CassetteReplay`, `forkRun`,
  `diffTraces`, `selfCheck`, and `cli.ts` are untouched, reverting W5-A cannot affect any runtime behavior. The
  loop (`record`/`replay`/`fork`/`diff`/`verify`/`check`) is unchanged with or without the corpus.
- If only the `.gitignore` anchor is undesirable, the alternative is to name the corpus a non-colliding directory
  (e.g. `fixtures/cassettes/`) instead of anchoring — no functional difference to the harness.
- If the frozen-hash assertions prove too brittle for some intended-and-audited change, the minimal fallback is to
  keep structural assertions (schema/chain/neutrality/replay/fork-prefix/first-divergence) and drop only the
  frozen-hash constants — but this weakens drift detection and should be a deliberate, audited choice.

---

## 10. First implementation prompt

> Implement W5-A (Trace Fixture Corpus + Regression Harness) per `docs/20_week_five_a_plan.md`. Local TypeScript
> regression hardening only. Do NOT add live calls, CLI Anthropic wiring, a new provider adapter, a new
> dependency, or any product surface. Do NOT change the semantics of `hash.ts`, `TraceTypes.ts`, `TraceRecorder`,
> `verifyTrace`, `neutrality`, `loadTrace`/`validateTrace`/`replayTrace`, `forkRun`, `diffTraces`, `selfCheck`, or
> `cli.ts`.
>
> 1. Create `scripts/generateFixtures.ts`: a deterministic generator that composes `FakeDeterministicModelClient`
>    + `defaultToolExecutor()` + `runAgentLoop` + `forkRun`, plus a local `normalizeTrace(trace, base)` helper
>    that rebuilds each trace through a fresh `TraceRecorder`, appending every step with a fixed timestamp and
>    fixed `createdAt` so the existing hash chain recomputes deterministically (byte-reproducible output). It must
>    run in **check mode by default** (regenerate in memory, compare to the committed files, exit non-zero on drift,
>    write nothing) and only write when passed `--write`. It must be incapable of a real model/tool/network call.
> 2. Generate and commit the corpus under `fixtures/traces/`: `success-final-answer.v2.json`,
>    `success-tool-use.v2.json`, `error-unknown-tool.v2.json`, `fork-parent.v2.json`, `fork-child.v2.json`. All v2,
>    fake/offline, timestamp-normalized, neutral, and valid. `fork-child` is forked from the normalized
>    `fork-parent` with a tool-result mutation at the demo step and shares a hash-identical prefix.
> 3. Fix `.gitignore`: change `traces/` → `/traces/` (anchor to repo root) so `fixtures/traces/` is committable
>    while the root `traces/` output stays ignored. Verify with `git check-ignore -v` on both paths and confirm
>    `git ls-files fixtures/traces` lists all five and `git ls-files traces` is empty.
> 4. Create `tests/fixtures.test.ts` (offline) asserting, against the committed corpus: manifest completeness;
>    schema version supported; hash chain valid; **frozen expected hashes** (final-step hash for each, plus one
>    full per-step hash list); provider neutrality clean; success fixtures replay as `success` with expected
>    result and `verifyTrace` PASS; the error fixture replays as `error` and `verifyTrace` PASSES (terminal error
>    not falsely rejected); the fork pair shares a hash-identical prefix (`sharedPrefixLength > 0`, per-step hash
>    equality) with a **frozen** `firstDivergenceIndex`; and that the generator's in-memory build matches the
>    committed files (check mode passes). Derive any negative/tamper cases in memory from a loaded good fixture —
>    do not commit corrupt fixtures.
> 5. Optionally add a `package.json` `"fixtures:generate"` script (check mode; `-- --write` to write) — no new
>    dependency. Add a short `README.md` "Trace fixture corpus" subsection (fake/offline only; deliberate
>    regeneration with the Codex-audit caveat) and a `docs/08_build_log.md` W5-A entry with the post-W5-A test
>    total.
>
> Acceptance: `npm test -- --run` passes (321 existing + new, zero live calls); `record`/`replay`/`fork`/`diff`/
> `verify`/`check`/`list`/`inspect` unchanged and green; the five committed fixtures load/validate/verify/replay as
> specified; the fork pair shows a hash-identical prefix and a frozen first-divergence index; `.gitignore` tracks
> `fixtures/traces/` and still ignores root `traces/`; `git ls-files traces` is empty; `package.json` gains no
> dependency. Then summarize per the CLAUDE.md response format (files changed / real / mocked / tests / next
> safest task).

## 11. Codex audit prompt

> Audit the W5-A implementation against `docs/20_week_five_a_plan.md`, `CLAUDE.md`, and `AGENTS.md`. Verify:
>
> 1. **No runtime behavior change** to `src/trace/hash.ts`, `TraceTypes.ts`, `TraceRecorder`, `verifyTrace`,
>    `neutrality`, `CassetteReplay` (`loadTrace`/`validateTrace`/`replayTrace`), `forkRun`, `diffTraces`,
>    `selfCheck`, or `cli.ts`. W5-A only consumes/freezes them. Confirm via diff.
> 2. **Corpus is fake/offline only** — every committed fixture is v2, provider-neutral (`auditTraceNeutrality`
>    clean), and contains no Anthropic/live/provider markers, ids, usage, stop metadata, or key material. Nothing
>    was copied from `traces/`.
> 3. **`fixtures/traces/` is actually committed and `traces/` is still ignored** — `git ls-files fixtures/traces`
>    lists all five; `git ls-files traces` is empty; `git check-ignore -v` confirms the `/traces/` anchor and that
>    `fixtures/traces/` is not ignored.
> 4. **Determinism** — `tsx scripts/generateFixtures.ts` (check mode) reports the corpus in sync and writes
>    nothing; running the generator in memory reproduces the committed bytes; `normalizeTrace` is idempotent and
>    yields `validateTrace`-clean chains. The generator cannot make a live call (only fake model + fixture tools).
> 5. **Harness asserts the real invariants against frozen artifacts** — schema-version-supported, hash-chain
>    valid, **frozen expected hashes** (so hash-input/canonicalization/payload drift fails), neutrality clean,
>    success replay + verify PASS, terminal-error verify PASS (not falsely rejected), fork-prefix hash identity,
>    and a **frozen first-divergence index**. Confirm the frozen constants are genuine (recompute a couple by hand
>    or via the generator) and not tautologically derived from the same fixture at runtime.
> 6. **Guardrails held** — `npm test -- --run` passes with zero live calls; `record`/`replay`/`fork`/`diff`/
>    `verify`/`check`/`list`/`inspect` unchanged; `package.json` gained no dependency; no new provider adapter, no
>    CLI Anthropic wiring, no live tests, no observability surface; no committed corrupt/provider fixtures; docs
>    match what shipped with no overclaim.
>
> Report any drift between the plan, the docs, and the code before the milestone is tagged.
