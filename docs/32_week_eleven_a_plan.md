# W11-A Plan — Fork Foreign Cassette Proof

**Status:** IMPLEMENTED (in closeout). This document is the accepted plan and historical record; the sections below
describe what was planned and were carried out in the implementation slice.
**Predecessor:** W10-A closed/tagged (`week-ten-foreign-transcript-adapter`). Tests: 559/559 offline. The committed
foreign-origin cassette `fixtures/external/chat-tool-use.converted.v2.json` passes verify/replay/assert.
**Mode:** **tests + docs only.** One new test file plus documentation. **Zero source changes, zero fixture changes,
zero CLI changes, zero dependencies.**
**Intended tag:** `week-eleven-foreign-fork-proof`.

---

## 1. Problem statement

W10-A proved a foreign-origin cassette can *passively* participate in Blackbox (verify / replay / assert). But
Blackbox's thesis is **active** debugging — `fork → mutate → continue → diff` — and nothing yet proves the adapted
cassette is first-class there. That is the next question a skeptical reviewer asks: *"fine, you can import it — can
you debug it?"*

Grounding before the plan was accepted established that the existing machinery already handles it, unchanged:

- The foreign cassette's geometry (mutate the `get_weather` `tool_result` at step 3, fork at index 4) satisfies every
  `forkRun` guard, and even matches the CLI `fork` defaults (`DEMO_MUTATION_STEP = 3`, `DEMO_FORK_INDEX = 4`).
- `reconstructMessages` seeds cleanly from the foreign step-0 `model_input` (user role, string content).
- `ReactiveDemoModelClient` needs no change: a mutated weather payload hits its rule-5 fallback, deterministically
  embedding the tool name and the canonical rendering of the mutated payload — so changing the mutation changes the
  answer, which is the derivation proof.
- The continuation model always returns `final_answer`, so no tool is ever executed; a `ToolExecutor` contributes
  only `definitions()` to the continuation `model_input` record.

So W11-A's job is not to build anything — it is to **freeze that claim under tests and put the commands in front of
reviewers**.

## 2. Scope

### 2.1 Tests — `tests/foreignFork.test.ts` (the only new file besides this plan)

**Library-level, primary geometry (mutate step 3, fork at 4, payload
`{"city":"Paris","temperature_c":-2,"condition":"Heavy snow"}`):** parent loads/validates/verifies; parent isolation
(deep-copy equality after fork); `prefixLength === 4`; child steps 0–2 verbatim hash-identical to the **committed**
parent bytes; child step 3 keeps `type: tool_result`, `call-0`, `get_weather`, and the parent timestamp while carrying
the injected result, a new hash, and `prevHash` = parent step 2's hash; `parentId` set and `forkedFromStepId ===
parent.steps[4].id` (no `forkReason` asserted or introduced); the continuation `model_input` reconstructs the mutated
structured history **and records the foreign tool definitions** (lifted from the parent's own recorded step-0 payload
by a test-local `ToolExecutor` whose `execute()` throws and is asserted never called); child validates, verifies 4/4,
replays to success, stays provider-neutral; the answer **derives** from the mutation (embeds `get_weather`,
`Heavy snow`, `-2`; two mutations → two answers; same mutation → same answer); the stale-`model_input` guard holds on
foreign geometry (mutate 3, fork 8 → rejected).

**Behavioral diff:** `diffTraces` → `sharedPrefixLength 3`, first divergence at 3; `diffOutcome` → both `success`,
`finalAnswerChanged === true`, `toolSequenceChanged === true`, parent tools `["get_weather","send_email"]` vs child
`["get_weather"]`; `formatDiffReport` shows the divergence index and both tool paths.

**Secondary geometry (mutate step 7, fork at 8):** divergence at 7 over a 7-step hash-identical prefix;
reconstruction spans both foreign tool rounds with the second result mutated; the answer changes while the tool
sequence stays `["get_weather","send_email"]`.

**CLI integration (spawned, temp-dir `--out` always explicit):** `fork --trace <foreign> --out <tmp>/… --mode
tool-result --fork-index 4 --mutation-step 3 --payload-json …` exits 0 and writes a valid derived child; `verify`
child exit 0; `diff` parent-vs-child exit 0 with `index 3` + `Outcome:`; `assert --expect-status success
--expect-tools get_weather` exit 0 and `--expect-tools get_weather,send_email` exit 1; **documented harness
behavior:** the CLI continuation injects `defaultToolExecutor()`, so the child's continuation `model_input` records
the fixture tool definitions (`search`/`calendar`/`booking`) — the CLI does **not** preserve foreign tool definitions,
and no doc claims it does; `fixtures/external/` still contains exactly the two committed W10-A files afterward.

**Deliberately NOT frozen:** full child bytes, full child hashes, continuation hashes, child timestamps
(continuation steps are stamped at run time). No committed child fixture.

### 2.2 Docs

This plan; a README extension of the "Adapt a foreign transcript" section with the fork/verify/diff/assert reviewer
commands (every fork command passes an explicit `--out traces/chat-tool-use-fork.json`; the child is described as a
git-ignored local artifact); a `docs/08_build_log.md` W11-A entry; `CLAUDE.md`/`AGENTS.md` current-state pointers.
**No `DEMO.md` change.**

## 3. File allowlist (exhaustive)

`tests/foreignFork.test.ts` (new), `docs/32_week_eleven_a_plan.md` (new), `README.md`, `docs/08_build_log.md`,
`CLAUDE.md`, `AGENTS.md`.

**Explicitly NOT touched:** anything under `src/` (including `src/ingest/`, `src/fork/`, `src/agent/`, `src/cli.ts`),
`fixtures/` (both `fixtures/external/` and `fixtures/traces/`), `scripts/`, every existing test file, `DEMO.md`,
`docs/11_cli_spec.md`, `package.json`, `package-lock.json`, `.gitignore`, `assets/brand/`.

**Explicitly NOT added:** a child fixture, a source module, a CLI command or flag, a model client, a dependency, any
schema/hash/canonicalization change, any W11-B work.

## 4. Acceptance criteria

1. Every assertion in §2.1 passes; all 559 pre-existing tests pass **unedited**.
2. `check` stdout/stderr byte-identical run-to-run; `fixtures:generate` in sync (5 fixtures); schema still v2.
3. The four reviewer commands run green against the committed parent (child written to git-ignored `traces/`).
4. `git diff` confined to the six allowlisted files; `fixtures/external/` exactly two files; no trace committed.

## 5. Failure conditions (stop and escalate)

Any need to modify a `src/` file, extend `ReactiveDemoModelClient`'s rule table, add a model client or executor to
`src/`, write into `fixtures/`, or add a CLI command/flag — stop and report instead of implementing.

## 6. Rollback

Delete `tests/foreignFork.test.ts` and `docs/32_week_eleven_a_plan.md`, revert the four edited docs. No runtime,
fixture, or core-test surface is touched, so rollback cannot affect any behavior or existing test outcome.
