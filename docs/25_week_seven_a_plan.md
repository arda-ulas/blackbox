# W7-A Plan — Reactive Deterministic Fake Model

**Status:** PLANNED (awaiting Codex audit before implementation). This document is the scoped, plan-only
deliverable. No source, test, fixture, config, runtime, CLI, or provider change is made by writing it.
**Predecessor:** W6-C complete, pushed, tagged `week-six-release-freeze` (HEAD `e0f9977`). The full core loop is
implemented, hardened, composed under one self-check, proven live (opt-in), frozen against a committed regression
corpus, and release-frozen with truthful docs: `record → replay → fork → mutate → continue → diff → verify → check`.
Tests: **394/394** offline, zero live calls.
**Mode:** demo-credibility slice on the **continuation** step of the offline fork demo. **No change to canonical
hashing, trace schema, replay semantics, fixture bytes, provider adapters, or the CLI surface (no new flag,
command, or exit code).** No live calls, no Anthropic CLI wiring, no new provider adapter, no new dependency, no
UI/backend/dashboard/observability surface.

---

## 1. Problem statement

The offline fork demo proves plumbing, not derived behavior. When `npm run cli -- fork` injects the "no hotels
available" mutation and continues the child run, the child's final answer is **not computed from the mutated
cassette state** — it is a hardcoded string handed to a scripted fake that ignores its input entirely:

- `FakeDeterministicModelClient.complete(_input)` (`src/agent/modelClient.ts:126`) discards `ModelInput` by
  construction — "call N always returns response[N] regardless of the actual input."
- `src/cli.ts:272–273` defines `DEMO_FORK_ANSWER = "No hotels available for Alice this weekend. The area is fully
  booked — consider a different date."` and injects it as the scripted continuation at `src/cli.ts:331`. Prompt
  mode does the same with `"Prompt-mode fork complete."` at `src/cli.ts:348`.
- `src/workflow/selfCheck.ts:46–47,148` carries its own copy of the same canned answer, so the `check` command's
  fork stage is equally scripted.

The consequence: the demo's most persuasive moment — *"mutate a past tool result, continue, and the agent behaves
differently"* — is **authored, not derived**. The child would say "no hotels available" no matter what the
mutation contained. Any engineer who opens `runFork` finds `DEMO_FORK_ANSWER` in under a minute and correctly
discounts the loop as theater. The genuine behavioral proof exists only in the opt-in live script
(`example:real-fork-proof`), which most reviewers will never run.

This is a credibility bug, not a correctness bug: fork geometry, hash re-chaining, prefix identity, and
first-divergence detection are all real and tested. What is missing is that the **continuation** deterministically
*reacts* to the mutation.

---

## 2. Why W7-A is the right next milestone

- **It closes the gap a critical review just named.** The post-W6-C review identified the canned continuation as
  the single biggest demo credibility gap before showing Blackbox to engineers. It is the cheapest change that
  converts the offline demo from "plumbing demonstration" to "derived-behavior demonstration."
- **It is small and fully offline.** One new deterministic `ModelClient` implementation plus swapped injection
  sites. No schema, hash, replay, fixture, provider, or CLI-surface change. The mutation → different-answer chain
  becomes provable in tests with zero live calls.
- **It directly serves the next outward step.** Every downstream artifact (demo video, case study, external
  review) is stronger when changing `--payload-json` visibly changes the child's answer.
- **Everything larger is out of scope or unscoped.** A real model in the CLI is banned; a generic reasoning fake is
  explicitly a non-goal; further docs/polish milestones have near-zero marginal value until this gap is closed.

---

## 3. Exact current credibility gap (evidence inventory)

The canned string `"No hotels available for Alice this weekend. The area is fully booked — consider a different
date."` appears at:

| Site | Role | W7-A treatment |
|---|---|---|
| `src/cli.ts:272–273,331` | CLI `fork` tool-result continuation | **Replace** with reactive model (required) |
| `src/cli.ts:348` (`"Prompt-mode fork complete."`) | CLI `fork` prompt-mode continuation | **Replace** with the same reactive model (required; same injection point) |
| `src/workflow/selfCheck.ts:46–47,148` | `check` fork stage continuation | **Replace** with reactive model (required; output stays byte-identical — see §4.4) |
| `src/examples/fork.ts:93` | Legacy W2 `example:fork` script | **Out of scope** (historical demo path, no longer in the DEMO.md walkthrough; see §9) |
| `scripts/generateFixtures.ts:49–50,125` | Frozen corpus `fork-child.v2.json` generator | **Out of scope — must not change** (fixture policy, §7) |
| `tests/fixtures.test.ts:67` | Frozen-corpus replay assertion of the canned string | **Unmodified** (corpus untouched) |
| `DEMO.md:216` | Quoted expected fork output | **Updated** to the new derived answer (§8) |

Load-bearing fact for scope: the committed `fork-child.v2.json` fixture **embeds the canned answer in its steps
and frozen hashes**. Touching the generator's continuation model would force a corpus regeneration + frozen-hash
update. W7-A therefore leaves the generator untouched (§7).

---

## 4. Proposed design

### 4.1 One new class: a reactive *demo continuation* model (not a framework)

Add `src/agent/reactiveDemoModel.ts` (final name at implementation) exporting one small `ModelClient`
implementation — working name `ReactiveDemoModelClient`. Properties:

- **Pure and deterministic by construction.** `complete(input)` is a pure function of `ModelInput`: no `Date.now`,
  no randomness, no I/O, no network, no provider import. Same input → byte-identical output, always.
- **Reads the transcript.** It scans `input.messages` for the most recent `tool_result` `MessagePart`
  (`modelClient.ts` `MessagePart` union — both the `result` and `error` variants). This is exactly the mutated
  state `forkRun` reconstructs into the continuation's `initialMessages`, so the model genuinely reads the
  mutated cassette state.
- **Small fixed rule table** (final wording at implementation; the *requirements* are binding):
  1. Most recent `tool_result` is the **error variant** → final answer naming the tool and its error, embedding
     the error string.
  2. Most recent `tool_result` `result` indicates **no availability** (`available === false`, or `results` is an
     empty array) → an "unavailable" final answer that **embeds a payload-derived field** (e.g. the payload's
     `message` string). Embedding a mutated field is what makes derivation visible and testable: change the
     mutation's message, the child's answer changes.
  3. Most recent `tool_result` `result` indicates **availability** (non-empty `results`) → a "found availability /
     proceed to booking"-style final answer embedding a deterministic payload field (e.g. first result title or
     result count).
  4. **No `tool_result` in the transcript** → a deterministic generic final answer derived from the last user
     message text. **This is the rule every prompt-mode fork hits** (see §4.2): `forkRun` reconstructs
     `initialMessages` only when tool-result mutations are present, so a prompt-mode continuation sees no tool
     rounds at all — only the mutated prompt.
  5. **Unrecognized result shape** → a deterministic fallback final answer embedding the tool name and a short
     canonical rendering of the payload. Never throws for exotic-but-JSON-safe payloads.
- **Always returns `final_answer`** — it is a one-round *continuation* model for the demo fork, not a planner. It
  never emits `tool_call`. (Consequence: the demo child stays **7 steps** — 4 prefix + `model_input` +
  `model_output` + terminal `metadata` — so DEMO.md's `Steps: 7` and `check`'s `child valid, 7 step(s)` remain
  true.)
- **Provider-neutral.** Output text contains no provider markers; the neutrality audit passes over child traces by
  construction (test-asserted).

Explicitly **not** a broad fake-model framework: one class, one fixed rule table, no configuration surface beyond
the constructor (which should take no required arguments), no plugin points.

### 4.2 Swap the CLI fork continuation (`src/cli.ts`)

In `runFork`, both modes replace their scripted `FakeDeterministicModelClient([...])` continuation with
`new ReactiveDemoModelClient()`. The `DEMO_FORK_ANSWER` constant and the `"Prompt-mode fork complete."` literal are
**deleted** from `cli.ts`. Everything else in `runFork` — flags, allow-lists, overwrite guardrail, output sections,
diff rendering, exit codes — is unchanged. `record`, `replay`, `diff`, `verify`, `list`, `inspect` are untouched.

Prompt-mode note (explicit, corrected per Codex audit): `forkRun` builds `initialMessages` via
`reconstructMessages` **only when `toolResultMutations` is non-empty** (`src/fork/forkRun.ts:169–170`); a
prompt-mode fork passes `initialMessages: undefined` and enters the continuation with just the mutated prompt as a
fresh user message. The reactive model therefore finds **no `tool_result` in its transcript** and produces the
**rule-4 deterministic prompt-derived answer** — it does *not* see the parent's original search result. That is
deterministic, honest, and documented (and still derived: the answer is a function of the mutated prompt text).
**W7-A does not change `forkRun`'s reconstruction behavior** — making prompt-mode continuations transcript-aware
would be a `forkRun` semantics change and is out of scope.

### 4.3 Swap the self-check continuation (`src/workflow/selfCheck.ts`)

The fork stage's injected model becomes `new ReactiveDemoModelClient()`; the local `DEMO_FORK_ANSWER` constant is
deleted. Composition semantics are unchanged — `runSelfCheck` still only composes `runAgentLoop` / `verifyTrace` /
`forkRun` / `diffTraces` over fake/offline clients and cannot make a live call by construction.

### 4.4 `check`: output byte-identical, derivation test required

No `check` stage detail quotes the child answer text (`fork` stage prints `child valid, N step(s), tool_result
mutation at step 3`). Since the reactive model keeps the child at 7 steps and the mutation geometry is unchanged,
`npm run cli -- check` stdout must remain **byte-identical**; existing `selfCheck.test.ts` / `cli.test.ts` check
assertions must pass unedited. If implementation finds any check-output drift, that is a scope signal — stop and
re-examine rather than editing those assertions.

Because W7-A replaces the `check` continuation path, byte-identical output alone would leave the swap untested
from the behavior side. A **required** (not optional) test therefore asserts derivation inside the self-check:
`runSelfCheck()`'s `report.childTrace` replays offline (`replayTrace`) to a final result **derived from the
mutated tool result** — i.e. embedding the demo mutation's `message` ("No hotels available for that date.") —
proving the `check` child's behavior is computed, not scripted, even though the printed report never quotes it.

### 4.5 What is deliberately untouched

`hash.ts`, `TraceStepHashInput`, `CURRENT_TRACE_VERSION`, `Trace`/`TraceStep`/`TraceStepType`, `TraceRecorder`,
`validateTrace`, `replayTrace` (Trace-only signature), `forkRun`, `diffTraces`, `verifyTrace`/`verifyExplain`,
`neutrality.ts`, `stepLabels.ts`, `agentLoop.ts`, `fixtureTools.ts`, `anthropicModelClient.ts`, all proof scripts,
`scripts/generateFixtures.ts`, everything under `fixtures/`, `package.json`/`package-lock.json`, `.gitignore`.
`FakeDeterministicModelClient` itself is **unchanged** — it remains the default for record paths, the generator,
tests, and everywhere a scripted sequence is the point.

---

## 5. Acceptance criteria

An implementation of W7-A is accepted only if **all** of the following hold:

1. **No canned child answer remains on the demo surface.** `grep -rn "No hotels available for Alice" src/cli.ts
   src/workflow` is empty; `"Prompt-mode fork complete."` is gone from `src/cli.ts`. (`src/examples/fork.ts`,
   `scripts/generateFixtures.ts`, and `tests/fixtures.test.ts` retain their occurrences by design — §3, §7, §9.)
2. **The child answer is derived, provably.** Tests demonstrate that with the continuation model held fixed,
   changing only the injected mutation payload changes the child's final answer, and that the answer embeds a
   field of the mutated payload (e.g. its `message`). Two different `--payload-json` values → two different
   answers at the CLI level. **Prompt mode:** a prompt-mode fork produces the rule-4 deterministic prompt-derived
   answer (no `tool_result` visible per §4.2), test-asserted — not the old canned string, and not a rule-2/3
   answer.
3. **Determinism.** The same fork inputs produce an identical child answer across repeated runs (unit +
   integration asserted). The reactive model is a pure function of `ModelInput` — no clock, randomness, or I/O.
4. **Loop invariants intact.** The demo child still: validates (`validateTrace`), verifies (4/4 invariants),
   replays offline, shares a hash-identical 3-step prefix with the parent, first-diverges at index 3, and has 7
   steps. Existing `forkRun`/diff semantics untested-changed nowhere; existing tests pass unedited except where a
   test literally asserted the deleted canned string (inventory in §6.6 — expected: none in `tests/`).
5. **Offline guarantee untouched.** `replayTrace` signature and behavior unchanged; the reactive model is
   fake/offline; no CLI path can reach a real provider. `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof`
   still exits at the key guard.
6. **`check` output byte-identical AND `check` derivation proven.** `npm run cli -- check` stdout is unchanged and
   its existing tests pass unedited; **additionally, a required new test asserts `runSelfCheck().childTrace`
   replays offline to an answer embedding the demo mutation's `message`** (§4.4). Exit codes everywhere unchanged.
7. **Fixture corpus untouched.** Zero byte changes under `fixtures/`; no frozen-hash constant in
   `tests/fixtures.test.ts` edited; `npm run fixtures:generate` (check mode) reports the corpus in sync.
8. **No new CLI surface.** No new flag, command, or exit code; `FORK_ALLOWED` and all allow-lists unchanged.
9. **No new dependency.** `package.json` / `package-lock.json` byte-identical.
10. **Offline + green.** `npm test -- --run` ≥ 394 + new tests, zero live calls, no API key required.
    `npm run cli -- check` PASS. `git ls-files traces` empty.
11. **Docs match reality — including broad model-client claims.** DEMO.md's fork section quotes the *actual* new
    derived answer and gains a proof point stating the answer is computed from the mutated payload (§8). In
    addition, **no public doc may claim the default CLI or `check` uses only `FakeDeterministicModelClient`**
    after the swap. The known inventory (§8): `README.md:76` (proof-status table row), `DEMO.md:375` (`check`
    "only ever instantiates FakeDeterministicModelClient…"), `DEMO.md:429` (real-vs-mocked model row),
    `DEMO.md:436` (Current Limitations "plays back scripted responses"). Each is updated to state that the default
    CLI remains **fake/offline and deterministic**, using two fake clients: the **scripted** fake for record /
    scripted paths and the **reactive** fake for fork/`check` continuation paths. `DEMO.md:410` (fixtures are
    generated from the scripted fake) stays **unchanged** — it remains true because the generator is untouched.
12. **Neutrality preserved.** The child trace produced by the reactive continuation passes the structured
    neutrality audit (test-asserted).

---

## 6. Test plan

All offline, deterministic, zero live calls, no new fixtures on disk (in-memory traces only, per house pattern).

1. **Reactive model unit tests (new file, e.g. `tests/reactiveDemoModel.test.ts`).**
   - Rule 2: transcript whose latest `tool_result` has `available:false` / empty `results` → answer embeds the
     payload `message`; a *different* message → a *different* answer.
   - Rule 3: non-empty `results` → availability-style answer embedding a payload field; differs from rule-2 output.
   - Rule 1: error-variant `tool_result` → answer embeds the error string.
   - Rule 4: no `tool_result` in transcript → deterministic prompt-derived answer.
   - Rule 5: unrecognized shape → deterministic fallback, does not throw.
   - Determinism: identical input twice → identical output; input object not mutated.
   - Always `final_answer`, never `tool_call`.
2. **Fork integration (extend `tests/fork.test.ts` or a focused new block).** Fork the demo parent with mutation A
   (default no-availability) and mutation B (custom payload) using the reactive model: different `finalAnswer`s,
   each embedding its own payload field; child validates; prefix hashes identical to parent through step 2;
   `firstDivergenceIndex === 3`; child replays offline with the derived answer as `result`; child passes
   `verifyTrace` including neutrality. **Prompt mode:** a prompt-mode `forkRun` (no `toolResultMutations`) with
   the reactive model yields the rule-4 prompt-derived answer — asserting the §4.2 behavior (continuation sees no
   tool rounds) rather than assuming it.
3. **CLI end-to-end (extend `tests/cli.test.ts`).**
   - Default `fork` → exit 0; stdout `Result:` line contains the derived unavailable answer, including the
     mutation's `message` text ("No hotels available for that date.") — proving CLI-level derivation.
   - `fork --payload-json '<custom>'` with a distinct marker string → stdout `Result:` embeds the marker; differs
     from the default answer.
   - Existing fork/diff assertions (divergence, `Summary:`, `changed value (result):`) pass unedited.
4. **Self-check regression + required derivation.** Existing `tests/selfCheck.test.ts` passes unedited (stage
   names/details, 7 steps, divergence at 3, determinism, persistence), and `npm run cli -- check` stdout remains
   byte-identical (existing CLI check assertions unedited). **Required (per Codex audit): a new test asserts
   `runSelfCheck().childTrace` replays offline (`replayTrace`) to a result embedding the demo mutation's `message`
   ("No hotels available for that date.")** — proving the `check` continuation derives its behavior from the
   mutated result even though the printed report never quotes the answer.
5. **Corpus tripwires.** `tests/fixtures.test.ts` unmodified and green; `npm run fixtures:generate` (check mode)
   in sync — proving the generator/corpus were not dragged along.
6. **Canned-string inventory check.** Confirm before implementation (grep) that no test under `tests/` asserts the
   CLI/self-check canned answer text (current evidence: the only test occurrence is `tests/fixtures.test.ts:67`,
   which asserts the *fixture* answer and stays valid). If a hidden assertion is found, updating it to the derived
   answer is in scope and must be called out in the closeout summary.

Target: 394 baseline + roughly 12–18 new tests, all green, zero live calls.

---

## 7. Fixture policy (explicit)

**No fixture corpus rewrite. The generator is out of scope.**

- The committed `fork-child.v2.json` embeds the canned answer (via `scripts/generateFixtures.ts:125`) in its step
  payloads and frozen hashes, and `tests/fixtures.test.ts:67` asserts that replayed result. Changing the
  generator's continuation model would therefore force `--write` regeneration plus frozen-hash updates.
- That churn buys nothing: the corpus freezes **mechanics** (schema, hash chain, neutrality, replay, fork-prefix
  identity, first-divergence index), not demo narrative. A scripted continuation is a perfectly valid — arguably
  *preferable*, because maximally inert — source for a frozen regression artifact. Nobody demos the fixtures.
- Binding rule: if implementation discovers the corpus is affected anyway (any `fixtures/` byte change, any
  frozen-hash edit, fixtures check-mode drift), **stop** — do not silently regenerate. Either rescope to remove
  the coupling or write a separate, Codex-audited regeneration plan per `docs/20_week_five_a_plan.md` §7.

---

## 8. Docs impact

- **`DEMO.md`** — four targeted updates (all driven by the swap; everything else byte-identical):
  1. **Fork section (step 5):** the `Result:` line in the expected-output block changes to the new derived answer;
     the "Key proof points" list gains/upgrades a bullet stating the child's answer is **computed from the mutated
     payload by a deterministic, input-reading fake** (change the mutation, the answer changes — still zero live
     calls).
  2. **`check` proof point (`DEMO.md:375`):** "it only ever instantiates `FakeDeterministicModelClient` and
     `defaultToolExecutor()`" becomes false after the swap — reword to name both fake clients (scripted fake for
     record, reactive fake for the fork continuation), preserving the claim that no live call is possible by
     construction.
  3. **"What Is Real vs. Mocked" table (`DEMO.md:429`):** split/extend the model-client row to distinguish the
     scripted record model from the reactive fork/`check`-continuation model (both fake, offline, deterministic).
  4. **Current Limitations first bullet (`DEMO.md:436`):** "`FakeDeterministicModelClient` plays back scripted
     responses" — reword to cover both fake clients while keeping the bullet's core claim (no real LLM API called
     by any CLI command or by `npm test`) intact.
  `record`, `list`, `inspect`, `replay`, `diff`, `verify`, fixtures sections otherwise unchanged; the fixtures
  proof point (`DEMO.md:410`, corpus generated from the scripted fake) stays **verbatim — it remains true**
  because the generator is untouched. The standalone-diff section quotes the mutation payload, not the answer —
  verify it survives verbatim (expected yes).
- **`README.md`** — one required update and one optional:
  - **Required — proof-status table (`README.md:76`):** "Default loop (CLI + `npm test`) | Fake / offline —
    `FakeDeterministicModelClient` + fixture tools" must not imply the scripted client is the *only* model client
    on the default path. Reword to "fake/offline deterministic model clients (scripted + reactive demo
    continuation) + fixture tools; zero live calls; replay is structurally offline" or equivalent.
  - **Optional:** one line (e.g. in "What it proves") noting the offline fork continuation derives the child's
    behavior from the mutated cassette state; skip if it reads as bloat.
  - Current test-count mentions update to the new true suite total at closeout (the README states 394 today).
- **`docs/08_build_log.md`** — append the W7-A entry (What Was Built / Outcome / Guardrails Held) at closeout.
- **`AGENTS.md` / `CLAUDE.md`** — current-state pointer refresh at closeout (W7-A current/closed, new test total),
  consistent with precedent — **plus one narrow, explicitly-authorized invariant-wording update**: `AGENTS.md:29`
  ("`FakeDeterministicModelClient` and `defaultFixtureTools()` are the default in all tests and CLI commands…")
  and `CLAUDE.md:43` ("`FakeDeterministicModelClient` + `defaultFixtureTools()` are the default everywhere") are
  reworded to say **fake/offline deterministic model clients remain the default everywhere** — the scripted
  `FakeDeterministicModelClient` for record/scripted paths and the reactive demo continuation client for
  fork/`check` continuation paths. The invariant's *force* (default CLI and `npm test` are fake/offline, zero live
  calls, no key) is preserved verbatim in meaning; only the client naming is corrected so the guardrail text stays
  literally true after W7-A. (AGENTS.md's own escape hatch — "unless a milestone explicitly changes that" — is
  exercised here, by this audited plan.) No other guardrail, role, or invariant changes.
- **`docs/25_week_seven_a_plan.md`** — status header to IMPLEMENTED/in-closeout at landing; body unchanged.
- **`docs/03_trace_schema.md`** — no change (schema untouched; hard requirement).

---

## 9. Non-goals (explicit)

- **No real model in the CLI and no Anthropic CLI wiring.** The reactive model is fake/offline; live proofs remain
  opt-in scripts, unrun by this milestone.
- **No broad fake-model framework.** One class, one fixed rule table, no configuration/plugin surface, no
  scenario DSL. If a second demo scenario someday needs different rules, that is a future scoped decision.
- **No change to `FakeDeterministicModelClient`.** Scripted playback remains the default for record paths, the
  fixtures generator, and tests that script sequences.
- **No schema/hash/replay change.** `CURRENT_TRACE_VERSION`, `hash.ts`, `TraceStepHashInput`, `replayTrace`,
  `validateTrace`, `forkRun`, `diffTraces`, `verifyTrace` semantics all frozen.
- **No fixture rewrite** and no `scripts/generateFixtures.ts` change (§7).
- **No `src/examples/fork.ts` change.** The W2-era `example:fork` script is a tagged historical demo path, absent
  from the DEMO.md walkthrough; swapping its model risks `tests/examples.test.ts` churn for zero demo value. Its
  canned string is acknowledged in §3 and left in place.
- **No new CLI flags/commands/exit codes; no new dependency; no `package.json`/`.gitignore` change.**
- **No UI, backend, dashboard, observability, eval platform, prompt management, or multi-agent work.**
- **No next-milestone implementation** (case study, demo video, outreach are separate decisions).

---

## 10. Rollback plan

- **Isolated blast radius.** One new module (`src/agent/reactiveDemoModel.ts`), two injection-site swaps
  (`src/cli.ts` `runFork`, `src/workflow/selfCheck.ts` fork stage), new tests, and the DEMO/build-log/plan-header
  doc edits. No data model, hashing, schema, fixture, or provider file is touched.
- **Single-commit revert.** The slice lands as one commit; `git revert <sha>` restores the scripted continuation
  verbatim. Because no cassette, hash, schema, or fixture changed, revert is total — no regeneration needed.
- **Tripwires.** `tests/fixtures.test.ts` (frozen hashes) and `npm run fixtures:generate` (check mode) fail loudly
  if the corpus is accidentally dragged along; unedited `selfCheck.test.ts`/`check` assertions fail loudly if
  `check` output drifted; the unedited existing fork/diff assertions fail loudly if fork semantics (not just the
  answer text) moved.
- **No external state before local acceptance.** The implementation commit is not pushed or tagged before the
  Codex closeout audit; pre-acceptance rollback is purely local. Push/tag follow only after acceptance, per house
  workflow.

---

## 11. First implementation prompt (Sonnet)

> Implement W7-A (reactive deterministic fake model) exactly as scoped in `docs/25_week_seven_a_plan.md`. Demo
> continuation only — do not touch `src/trace/hash.ts`, `TraceStepHashInput`, `CURRENT_TRACE_VERSION`,
> `Trace`/`TraceStep`/`TraceStepType`, `validateTrace`, `replayTrace`, `forkRun`, `diffTraces`,
> `verifyTrace`/`verifyExplain`, `neutrality.ts`, `stepLabels.ts`, `agentLoop.ts`, `fixtureTools.ts`,
> `modelClient.ts` (including `FakeDeterministicModelClient`), any provider/adapter or proof-script code,
> `src/examples/fork.ts`, `scripts/generateFixtures.ts`, anything under `fixtures/`, `package.json`,
> `package-lock.json`, or `.gitignore`.
>
> 1. Add `src/agent/reactiveDemoModel.ts`: one `ModelClient` implementation (working name
>    `ReactiveDemoModelClient`) whose `complete(input)` is a pure, deterministic function of `ModelInput` — no
>    clock, randomness, I/O, or provider import. It scans `input.messages` for the most recent `tool_result`
>    `MessagePart` and applies the fixed rule table in plan §4.1 (error variant → answer embedding the error;
>    `available === false` or empty `results` → unavailable answer **embedding the payload's `message`**;
>    non-empty `results` → availability answer embedding a payload field; no tool_result → deterministic
>    prompt-derived answer; unrecognized shape → deterministic fallback, never throws). It always returns
>    `final_answer`, never `tool_call`, and its text is provider-neutral.
> 2. In `src/cli.ts` `runFork`, replace both scripted continuations (tool-result mode's `DEMO_FORK_ANSWER`
>    injection and prompt mode's `"Prompt-mode fork complete."`) with `new ReactiveDemoModelClient()`; delete the
>    dead constants. Change no flag, allow-list, output section, guardrail, or exit code. **Prompt-mode
>    expectation (plan §4.2):** `forkRun` reconstructs `initialMessages` only when tool-result mutations are
>    present, so the prompt-mode child gets the rule-4 prompt-derived answer — do **not** change `forkRun`'s
>    reconstruction to make prompt mode transcript-aware.
> 3. In `src/workflow/selfCheck.ts`, swap the fork stage's injected model to `new ReactiveDemoModelClient()` and
>    delete its local `DEMO_FORK_ANSWER`. `check` stdout must remain byte-identical (the child must still be 7
>    steps, mutation at step 3); if any check assertion would need editing, stop and report instead.
> 4. Add offline tests per plan §6: reactive-model unit tests (all five rules, determinism, input non-mutation,
>    never-tool_call); fork integration (mutation A vs B → different derived answers embedding their payload
>    fields; child validates/verifies/replays; prefix identity; divergence at 3; neutrality audit passes; **a
>    prompt-mode `forkRun` yields the rule-4 prompt-derived answer**); CLI end-to-end (default fork `Result:`
>    embeds "No hotels available for that date."; a custom `--payload-json` marker appears in the child answer;
>    two payloads → two answers); **and the required self-check derivation test: `runSelfCheck().childTrace`
>    replays offline to a result embedding the demo mutation's `message`**. Keep `tests/fixtures.test.ts`,
>    `tests/selfCheck.test.ts`, and all existing fork/diff/check assertions passing **unedited**; do not edit any
>    frozen hash constant.
> 5. Update the docs per plan §8: `DEMO.md` step 5 (new derived `Result:` line + derivation proof point), the
>    `check` proof point at `DEMO.md:375`, the real-vs-mocked model rows (`DEMO.md:429`), and the Current
>    Limitations bullet (`DEMO.md:436`) — each rewritten so no claim implies the default CLI/`check` uses only the
>    scripted client, while keeping "fake/offline, zero live calls" intact; leave `DEMO.md:410` (fixtures from the
>    scripted fake) verbatim. Update `README.md:76`'s proof-status row the same way. Append the W7-A build-log
>    entry. Update this plan's status header to IMPLEMENTED/in-closeout. (`AGENTS.md:29` / `CLAUDE.md:43`
>    invariant wording is refreshed at closeout per §8.)
>
> Acceptance gate: `npm test -- --run` green (≥ 394 + new, zero live calls, no key); `npm run cli -- check` PASS
> with byte-identical output; `npm run fixtures:generate` check mode in sync; zero byte changes under `fixtures/`;
> `grep -rn "No hotels available for Alice" src/cli.ts src/workflow` empty;
> `env -u ANTHROPIC_API_KEY npm run example:real-fork-proof` exits at the key guard; `git ls-files traces` empty;
> `package.json`/`package-lock.json` byte-identical; no new CLI flag. Then report: files changed / what is real /
> what is mocked / tests pass / next safest task. Do not push or tag.

---

## 12. Codex audit prompt

> Audit the W7-A plan in `docs/25_week_seven_a_plan.md` (and, once implemented, the diff) as a repo-aware reviewer
> before it is accepted for implementation / before tag. Confirm specifically:
>
> 1. **Derivation is real.** The child's final answer is computed by reading the reconstructed transcript
>    (including the mutated `tool_result` `MessagePart`) — not selected from a script, not keyed off a constant.
>    Tests prove: same model, different mutation payloads → different answers, each embedding its payload's field.
> 2. **Determinism and purity.** The reactive model uses no clock, randomness, I/O, network, or provider import;
>    identical input → identical output; the input object is not mutated; it never returns `tool_call`.
> 3. **No canned demo answer remains.** `DEMO_FORK_ANSWER` and `"Prompt-mode fork complete."` are gone from
>    `src/cli.ts` and `src/workflow/selfCheck.ts`. The retained occurrences (`src/examples/fork.ts`,
>    `scripts/generateFixtures.ts`, `tests/fixtures.test.ts`) match the plan's explicit out-of-scope list.
> 4. **Loop semantics unchanged.** `forkRun`, `diffTraces`, `replayTrace`, `validateTrace`, `verifyTrace`,
>    `agentLoop`, `hash.ts`, schema/version constants, and `FakeDeterministicModelClient` are untouched. Child
>    trace: 7 steps, hash-identical 3-step prefix, first divergence at index 3, verify 4/4, offline replay, clean
>    neutrality audit — all test-asserted.
> 5. **`check` byte-identical AND derivation-tested.** `npm run cli -- check` stdout unchanged; `selfCheck.test.ts`
>    and the cli check assertions pass unedited; exit codes unchanged everywhere. **The required new test exists
>    and passes: `runSelfCheck().childTrace` replays offline to a result embedding the demo mutation's `message`**
>    — flag its absence as a blocker.
> 5b. **Prompt-mode behavior correct and honest.** The prompt-mode child answer is the rule-4 prompt-derived
>    fallback (because `forkRun` reconstructs `initialMessages` only under tool-result mutations —
>    `forkRun.ts:169–170`), a test asserts it, and no doc/plan text claims prompt-mode continuations see the
>    parent's tool rounds. `forkRun`'s reconstruction behavior is untouched.
> 6. **Fixtures frozen.** Zero byte changes under `fixtures/`; no frozen-hash edit in `tests/fixtures.test.ts`;
>    `npm run fixtures:generate` check mode in sync; `scripts/generateFixtures.ts` untouched.
> 7. **No surface growth.** No new CLI flag/command/exit code; allow-lists unchanged; no new dependency;
>    `package.json`/`package-lock.json`/`.gitignore` byte-identical; no UI/backend/dashboard/observability; no
>    Anthropic CLI wiring; no live call anywhere in the diff; proof scripts untouched.
> 8. **Not a framework.** One class, fixed rule table, no configuration/plugin/DSL surface. Flag any
>    generalization beyond the demo continuation as scope creep.
> 9. **Docs match reality — including broad model-client claims.** DEMO.md step 5's quoted `Result:` matches
>    actual CLI output; the derivation proof point does not overclaim (still fake/offline, still deterministic);
>    the build-log entry is accurate. **Additionally, no public doc still claims the default CLI or `check` uses
>    only `FakeDeterministicModelClient`:** verify `README.md:76`, `DEMO.md:375`, `DEMO.md:429`, and `DEMO.md:436`
>    were rewritten to name both fake clients (scripted for record/scripted paths, reactive for fork/`check`
>    continuations) while preserving the fake/offline/zero-live-calls claims — and that `DEMO.md:410` (fixtures
>    from the scripted fake) was correctly left verbatim. At closeout, confirm the `AGENTS.md:29` / `CLAUDE.md:43`
>    invariant rewording preserves the guardrail's force (default fake/offline, no key) and changes only the
>    client naming.
> 10. **Honesty of the demo claim.** After this change, is it fair to say the offline demo shows *derived*
>     behavior? If any path still hardcodes the child's reaction on the demo surface, report it as a blocker.
>
> Report any scope creep (fixture regeneration, `modelClient.ts` edits, new flags, generator changes, examples
> churn) as a blocker.
