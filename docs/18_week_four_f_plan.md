# W4-F Plan — Cassette Verification + Trace Hygiene

**Status:** PLANNED (not implemented). Plan-only deliverable.
**Predecessor:** W4-E complete, pushed, tagged `week-four-real-fork-proof`. Full live
record → replay → fork → mutate → continue → diff loop proven against Anthropic via opt-in
proof scripts (`d4d01f8`, closeout `38349cf`). Default CLI and `npm test` remain fake/offline.
**Mode:** local TypeScript core only. No live calls, no CLI Anthropic wiring, no new provider adapter.

> This document is the **only** W4-F deliverable produced in this step. No runtime, source, test,
> or `package.json` change is made here. Implementation is a separate, later step.

---

## 1. Problem statement

The cassette contract is already enforced, but the enforcement logic is **scattered across four call
sites and one proof helper**, and there is **no single reusable "verify this cassette" path** a user
(or a test, or a future tool) can call to answer *"is this trace file trustworthy?"*:

| Invariant | Where it lives today | Reusable? |
|---|---|---|
| Schema version present & supported | `loadTrace` (`src/replay/CassetteReplay.ts`) — throws on read | partial (couples version check to disk read) |
| Hash chain / index / prevHash integrity | `validateTrace` (`src/replay/CassetteReplay.ts`) — throws on first violation | yes, but throw-based (no structured report, no machine-readable first-failure) |
| Replayability offline | `replayTrace` (`src/replay/CassetteReplay.ts`) | yes, but returns a summary, not a pass/fail verdict |
| Provider-neutrality / key leakage | `auditNeutrality` + `NEUTRALITY_FORBIDDEN` (`src/examples/toolUseProofHelpers.ts`) | **no — lives under `src/examples/`, a proof helper, not core** |

Consequences:

1. **Neutrality auditing is not core.** The single most product-relevant hygiene check (no provider
   leakage, no key leakage) is only reachable by importing from a proof-example module. Nothing in the
   product runtime or CLI can call it.
2. **No unified verdict.** Each check throws or summarizes independently. There is no one function that
   runs all invariants in a defined order and reports **PASS/FAIL + the first failing invariant + the
   step index when relevant**.
3. **No standalone verification command.** A user cannot independently check a cassette
   (e.g. one received from elsewhere, or one whose provenance is unknown) without writing code. `list`
   and `inspect` load+validate but do not run neutrality, and do not emit a single machine-usable verdict.
4. **`sk-ant` is not in the forbidden set.** `NEUTRALITY_FORBIDDEN` covers `toolu_`, `msg_`, `usage`,
   `stop_reason`, `stop_sequence`, `ANTHROPIC_API_KEY`, and the literal key value — but not the
   `sk-ant` key prefix, which the W4-F acceptance criteria require.

**Thesis:** now that the full loop is proven, harden the local cassette contract into a **reusable
verification core** plus a **narrow `verify` CLI command**, so traces can be verified independently and
failures are easy to diagnose. No behavior change to `hash.ts`, `validateTrace`, `replayTrace`, or
`loadTrace` — W4-F *composes* them behind one verdict-producing function and *relocates* the neutrality
audit into core (with a back-compat re-export so proofs and existing tests are untouched).

---

## 2. W4-F acceptance criteria (exact)

1. `npm test -- --run` passes.
2. Existing CLI commands still pass:
   - `npm run cli -- record`
   - `npm run cli -- replay`
   - `npm run cli -- fork`
   - `npm run cli -- diff`
3. A cassette verification path exists and can check:
   - schema version
   - hash chain / load validation
   - replayability when applicable
   - provider-neutrality
   - forbidden markers: `toolu_`, `msg_`, `usage`, `stop_reason`, `stop_sequence`,
     `ANTHROPIC_API_KEY`, `sk-ant`, and raw provider content arrays / message ids
     (the latter proxied by the markers above, per `toolUseProofHelpers` rationale).
4. Verification output clearly reports:
   - PASS / FAIL
   - trace path
   - first failing invariant
   - step index when relevant
5. Tests cover both success and failure cases.
6. No live call is required or possible from `npm test`.
7. No trace artifacts are committed (`traces/` stays git-ignored).
8. Docs updated with the W4-F plan only (this file).

---

## 3. Design

### 3.1 New reusable core: `verifyTrace`

A single function that runs all invariants **in a fixed order**, stops at the first failure, and returns
a structured, machine-readable verdict (never throws for a *bad trace* — only for genuinely exceptional
input such as an unreadable argument). Ordering matters: cheaper/more-fundamental invariants first, so
the first-failure report is the most actionable.

**Invariant order (short-circuit at first FAIL):**

| # | Invariant name | Source composed | FAIL condition | `stepIndex`? |
|---|---|---|---|---|
| 1 | `schema_version` | `CURRENT_TRACE_VERSION` / `loadTrace` version gate | version field missing or `!== CURRENT_TRACE_VERSION` | no |
| 2 | `hash_chain` | `validateTrace` | index gap, first `prevHash !== null`, broken `prevHash`, or stored/recomputed hash mismatch | **yes** (offending step) |
| 3 | `provider_neutrality` | relocated `auditNeutrality` (+ `sk-ant`) | any forbidden marker or literal key value present in the serialized trace | optional (marker, not always a step) |
| 4 | `replayability` | `replayTrace` | replay throws, OR trace claims terminal `run_completed`/`status:success` but replay status is not `success` | optional (terminal step) |

**Proposed shape (illustrative — final types decided at implementation time):**

```ts
export type VerifyStatus = "pass" | "fail" | "skip";

export interface VerifyInvariant {
  name: "schema_version" | "hash_chain" | "provider_neutrality" | "replayability";
  status: VerifyStatus;
  detail: string;        // human-readable; no raw SDK objects, no key values
  stepIndex?: number;    // present when the failure is localized to a step
}

export interface VerifyReport {
  pass: boolean;
  invariants: VerifyInvariant[];
  firstFailure?: { name: VerifyInvariant["name"]; detail: string; stepIndex?: number };
}

export interface VerifyOptions {
  /** Live key value to also reject if it somehow reached the payload. Never logged. */
  apiKey?: string;
  /** Skip the replay invariant (e.g. for a partial/aborted trace). Default: run it. */
  skipReplay?: boolean;
}

export function verifyTrace(trace: Trace, opts?: VerifyOptions): VerifyReport;
```

- `verifyTrace` takes an **in-memory `Trace`** (already loaded) so it is pure and unit-testable, and so
  it *cannot* make a live call by construction (mirrors the `replayTrace(trace)` discipline).
- A thin `verifyTraceFile(path, opts)` wrapper does `loadTrace` → `verifyTrace`, catching `loadTrace`
  throws (missing/unsupported version, malformed JSON) and mapping them onto the `schema_version`
  invariant as a structured FAIL rather than an uncaught throw. This is what the CLI calls.

### 3.2 Relocate neutrality audit into core

Move `NEUTRALITY_FORBIDDEN` + `auditNeutrality` from `src/examples/toolUseProofHelpers.ts` into a new
core module `src/trace/neutrality.ts`, and:

- **Add `sk-ant`** to `NEUTRALITY_FORBIDDEN` (acceptance criterion 3).
- **Re-export** `NEUTRALITY_FORBIDDEN` and `auditNeutrality` from `toolUseProofHelpers.ts` (barrel
  re-export) so `realToolUseProof.ts`, `realForkProof.ts`, and `tests/toolUseProofHelpers.test.ts`
  continue to import from their current path unchanged. No proof-script or existing-test churn.
- `collectToolBlockIds` **stays** in `toolUseProofHelpers.ts` — it inspects live request params, which is
  proof-only concern, not a cassette-verification concern.

> Note: adding `sk-ant` will make the existing parametrized test
> `it.each(NEUTRALITY_FORBIDDEN)(...)` in `tests/toolUseProofHelpers.test.ts` automatically cover the new
> marker (it iterates the exported array), so no manual case is needed there — but a dedicated `sk-ant`
> assertion should still be added in `tests/verifyTrace.test.ts` for explicitness.

### 3.3 CLI command

Add a narrow `verify` subcommand consistent with the existing flag-based parser (`--trace`, like
`replay`/`inspect`), rather than a positional argument (the current `parseArgs` only understands `--`
flags; a positional form would require a parser change, which is out of scope and riskier).

```
npm run cli -- verify --trace <path>
```

Behavior:
- Calls `verifyTraceFile(path)`.
- Prints a compact report (see §4).
- Exit code `0` on PASS, `1` on FAIL — so it is scriptable.
- No default that silently verifies the demo trace *and* exits 0 for a missing file: a missing/unreadable
  file is a FAIL (schema_version / load), not a usage error, so the verdict stays honest.

`verify` is added to the usage text and the subcommand switch. No existing subcommand changes.

---

## 4. CLI / output shape

**PASS:**

```
[blackbox] --- verify ---
Path:            traces/example-trace.json
Result:          PASS

  schema_version    pass  version 2
  hash_chain        pass  8 step(s), chain intact
  provider_neutrality pass  no forbidden markers
  replayability     pass  status=success
```

**FAIL (hash mismatch at a step — note first failing invariant + step index):**

```
[blackbox] --- verify ---
Path:            traces/tampered.json
Result:          FAIL

  schema_version    pass  version 2
  hash_chain        FAIL  step 3 hash mismatch (stored vs recomputed)
  provider_neutrality skip
  replayability     skip

First failing invariant: hash_chain (step 3)
```

**FAIL (provider leakage):**

```
First failing invariant: provider_neutrality (markers: toolu_, usage)
```

- Later invariants after the first FAIL render as `skip` (short-circuit), keeping the "first failing
  invariant" unambiguous.
- The report never prints a key value; a leaked literal key surfaces as the `<api-key-value>` token
  already used by `auditNeutrality`.

---

## 5. Proposed file changes

**New:**
- `src/trace/neutrality.ts` — `NEUTRALITY_FORBIDDEN` (+ `sk-ant`) and `auditNeutrality`, relocated from
  the proof helper into core.
- `src/trace/verifyTrace.ts` — `verifyTrace(trace, opts)`, `verifyTraceFile(path, opts)`, and the
  `VerifyReport` / `VerifyInvariant` / `VerifyOptions` types.
- `tests/verifyTrace.test.ts` — success + failure coverage (see §6).

**Edited (small, additive):**
- `src/examples/toolUseProofHelpers.ts` — replace the local neutrality definitions with a re-export from
  `src/trace/neutrality.ts`; keep `collectToolBlockIds` in place. No signature changes.
- `src/cli.ts` — add `verify` subcommand (arg allow-list, `runVerify`, usage text, switch case). No
  change to `record` / `replay` / `fork` / `diff` / `list` / `inspect`.
- `tests/cli.test.ts` (or `tests/examples.test.ts`, whichever hosts CLI smoke tests) — add a `verify`
  PASS smoke and a FAIL exit-code assertion.
- `docs/08_build_log.md` — W4-F entry (at implementation time, not now).
- `docs/13_adapter_contract.md` — note that neutrality auditing is now core (at implementation time).

**Not touched (behavior unchanged):**
- `src/trace/hash.ts`, `src/trace/TraceTypes.ts`, `src/trace/TraceRecorder.ts`
- `src/replay/CassetteReplay.ts` (`loadTrace` / `validateTrace` / `replayTrace` reused as-is)
- `src/fork/*`, `src/agent/*` (including `AnthropicModelClient`)
- `package.json` (no new script needed — `verify` runs under the existing `cli` script; no new dep)

---

## 6. Test plan

All offline, fake/deterministic, zero live calls. New file `tests/verifyTrace.test.ts`:

**Success cases:**
- A freshly recorded valid trace (simple + tool-using) → `pass: true`, all four invariants `pass`.
- A valid trace with a terminal `run_failed` / `max_steps_exceeded` and `skipReplay` handling → the
  replay invariant behaves as specified (no false FAIL for a legitimately errored run).

**Failure cases (each asserts the correct `firstFailure.name` and, where relevant, `stepIndex`):**
- **Unsupported version** — `{ ...trace, version: 999 }` → `schema_version` FAIL.
- **Missing version** — version field stripped → `schema_version` FAIL.
- **Legacy v1** — `{ ...trace, version: 1 }` → `schema_version` FAIL (re-record message surfaced in detail).
- **Malformed JSON on disk** (via `verifyTraceFile`) → `schema_version` FAIL, not an uncaught throw.
- **Hash mismatch** — inject a field into a step payload, leave stored hash → `hash_chain` FAIL with the
  offending `stepIndex`.
- **Broken prevHash** — corrupt step 1 `prevHash` → `hash_chain` FAIL with `stepIndex: 1`.
- **Index gap** — set a step `index` wrong → `hash_chain` FAIL.
- **Provider-native leakage** — trace serialized with `toolu_` / `msg_` / `usage` / `stop_reason` /
  `stop_sequence` present → `provider_neutrality` FAIL listing the markers.
- **Key-name leakage** — `ANTHROPIC_API_KEY` string present → `provider_neutrality` FAIL.
- **Key-prefix leakage** — a `sk-ant-...` string present → `provider_neutrality` FAIL (new marker).
- **Literal key value** — pass `opts.apiKey` and embed it → FAIL surfaced as `<api-key-value>` (no key echoed).
- **Replay failure where applicable** — a trace whose terminal metadata claims `run_completed` /
  `status:success` but whose steps cannot replay to `success` → `replayability` FAIL. (Construct by
  tampering the terminal step consistently with the hash chain, or by asserting `replayability` runs only
  after `hash_chain` passes so an inconsistent trace fails earlier — decide the exact construction at
  implementation time; the invariant ordering guarantees a deterministic first-failure.)

**CLI smoke (in the CLI test file):**
- `verify --trace <valid>` prints `Result: PASS` and exits 0.
- `verify --trace <tampered>` prints `Result: FAIL` + first failing invariant and exits 1.

**Regression:** existing suites (`replay.test.ts`, `toolUseProofHelpers.test.ts`, `cli.test.ts`,
`examples.test.ts`) still pass; the neutrality re-export keeps proof imports green.

---

## 7. Non-goals

- No web UI, dashboard, React, or any frontend.
- No hosted backend, remote cassette storage, auth, or sharing.
- No LangChain / LlamaIndex / MCP / agent framework.
- No Anthropic CLI wiring; no live tests; no new provider adapter.
- No production SDK, metrics, or observability platform.
- No change to hashing, the trace schema, `validateTrace`, `replayTrace`, or `loadTrace` semantics.
- No positional-argument CLI parser rework (flag-based `--trace` only).
- No auto-repair / migration of malformed or legacy cassettes (verify **reports**; it never rewrites).
- No committing of any trace artifact.

---

## 8. Rollback plan

W4-F is **purely additive and composition-only**:

- Revert `src/trace/verifyTrace.ts`, `src/trace/neutrality.ts`, `tests/verifyTrace.test.ts`, and the
  `verify` subcommand block in `src/cli.ts`.
- Restore the inline neutrality definitions in `toolUseProofHelpers.ts` (or simply keep the re-export —
  it is harmless).
- Because `hash.ts`, `validateTrace`, `replayTrace`, and `loadTrace` are untouched, reverting `verify`
  cannot affect record/replay/fork/diff. No cassette on disk is changed by verification.
- If only the neutrality relocation is problematic, the minimal rollback is to keep `auditNeutrality` in
  its original location and have `verifyTrace` import from there — no functional difference.

---

## 9. First implementation prompt

> Implement W4-F (Cassette Verification + Trace Hygiene) per `docs/18_week_four_f_plan.md`. Local
> TypeScript core only. Do NOT add live calls, CLI Anthropic wiring, a new provider adapter, or any
> dependency.
>
> 1. Create `src/trace/neutrality.ts`: move `NEUTRALITY_FORBIDDEN` and `auditNeutrality` from
>    `src/examples/toolUseProofHelpers.ts` into it, and **add `sk-ant`** to the forbidden list. Re-export
>    both from `toolUseProofHelpers.ts` so existing proof/test imports are unchanged. Keep
>    `collectToolBlockIds` where it is.
> 2. Create `src/trace/verifyTrace.ts`: implement `verifyTrace(trace, opts?)` returning a `VerifyReport`
>    that runs invariants in order — `schema_version` → `hash_chain` → `provider_neutrality` →
>    `replayability` — short-circuiting at the first FAIL (later invariants become `skip`). Compose the
>    existing `CURRENT_TRACE_VERSION` check, `validateTrace` (catch its throw → structured FAIL with the
>    step index parsed/tracked), `auditNeutrality`, and `replayTrace`. Never throw for a bad trace; never
>    log or echo a key value. Add `verifyTraceFile(path, opts?)` that wraps `loadTrace` and maps load
>    throws onto a `schema_version` FAIL.
> 3. Add a `verify` subcommand to `src/cli.ts` (`--trace` flag, allow-list, usage text, switch case)
>    that calls `verifyTraceFile`, prints the §4 report (PASS/FAIL, path, per-invariant lines, first
>    failing invariant with step index when relevant), and exits 0 on PASS / 1 on FAIL. Do not change any
>    existing subcommand.
> 4. Add `tests/verifyTrace.test.ts` covering every success and failure case in §6, plus CLI PASS/FAIL
>    smokes in the CLI test file. Keep everything offline.
>
> Acceptance: `npm test -- --run` passes; `record`/`replay`/`fork`/`diff` still pass; no live call is
> possible from `npm test`; no trace artifact is committed. Then summarize per the CLAUDE.md response
> format (files changed / real / mocked / tests / next safest task).

## 10. Codex audit prompt

> Audit the W4-F implementation against `docs/18_week_four_f_plan.md` and `AGENTS.md`. Verify:
>
> 1. **No behavior change** to `src/trace/hash.ts`, `validateTrace`, `replayTrace`, or `loadTrace` —
>    `verifyTrace` only *composes* them. Confirm via diff that their logic is untouched.
> 2. **Neutrality is now core** (`src/trace/neutrality.ts`), `sk-ant` is in `NEUTRALITY_FORBIDDEN`, and
>    the re-export from `toolUseProofHelpers.ts` keeps proof/test imports working.
> 3. **`verifyTrace` cannot make a live call** — it takes an in-memory `Trace` (like `replayTrace`), and
>    `verifyTraceFile` only reads the filesystem. No `ModelClient`/provider import reachable from verify.
> 4. **Invariant ordering + short-circuit** match §3.1; the report exposes PASS/FAIL, the first failing
>    invariant, and a step index when the failure is step-localized.
> 5. **No key leakage in output** — a leaked literal key is reported as `<api-key-value>`, never echoed;
>    no `errorKind`/SDK object printed.
> 6. **Test coverage** includes valid traces, malformed/missing/legacy version, hash mismatch, provider
>    marker leakage, `ANTHROPIC_API_KEY` / `sk-ant` / literal-key leakage, and a replay-failure case;
>    CLI PASS exits 0 and FAIL exits 1.
> 7. **Guardrails held**: `npm test -- --run` passes with zero live calls; `record`/`replay`/`fork`/`diff`
>    unchanged; `package.json` gained no dependency; `traces/` stays git-ignored and no cassette is
>    committed.
>
> Report any drift between the plan, the docs, and the code before the milestone is tagged.
