# W4-E E2/E3 Plan — Real Fork Continuation Proof

**Status:** E2/E3 **PASSED** (2026-07-06). Full live loop proven.
**Predecessor:** W4-E slice E1 PASSED (`ed1628a`); E1 closeout pushed (`f062ffc`).
**Mode:** narrow, opt-in, live-gated. Proves the full active-debugging loop against the real provider.

> **E2/E3 result (2026-07-06):** the with-key proof (`npm run example:real-fork-proof`, script committed in `d4d01f8`) **PASSED**. A **fresh** `AnthropicModelClient` continued from a mutated structured v2 fork point using only cassette data: the continuation request carried `call-0` as `tool_use.id` / `tool_result.tool_use_id` plus the mutated result, the real API accepted it, and the child (v2, 7 steps) diffed with first divergence at the mutated `tool_result` (index 3) over a hash-identical 3-step prefix — neutrality-clean, replays offline. The full live **record → replay → fork → mutate → continue → diff** loop is proven. The §9 rollback was not needed.

---

## 1. Thesis

E1 proved the real Anthropic Messages API accepts Blackbox's synthetic `call-0` as `tool_use.id` / `tool_result.tool_use_id` on turn 2 of a single real tool-use record. E2/E3 proves the **full active-debugging loop against the live provider**:

> load the recorded parent cassette → replay it offline → **fork at the `tool_result`** → **mutate** the result → **continue with a *fresh* `AnthropicModelClient`** (no shared state; request built purely from cassette data) → **diff** parent vs child.

**Core question:** can a fresh Anthropic adapter continue from a *mutated* structured v2 fork point using only cassette data and neutral `toolCallId` correlation?

E3's continuation request is structurally the same shape E1 already validated (assistant `tool_use` `call-0` + user `tool_result` `call-0`), so live acceptance is *likely*. What is genuinely new and unproven is that **`forkRun`'s structured reconstruction plus a stateless fresh adapter** produce a live-accepted request, and that **prefix-hash-identity and first-divergence** hold on a real parent/child pair.

**Key scoping fact:** E2/E3 needs **no product-runtime change**. `forkRun` already accepts any `ModelClient` and reconstructs structured histories (W4-D3); `AnthropicModelClient` already translates structured parts statelessly (W4-D4). E2/E3 is a **proof script + one offline test + docs** only.

---

## 2. E1 result (proven)

- The real Anthropic Messages API (`claude-haiku-4-5-20251001`) accepted Blackbox's synthetic `call-0` as the request-local `tool_use.id` and matching `tool_result.tool_use_id` on **one real tool-use record**.
- Proof: `npm run example:real-tooluse-proof`, commit `ed1628a`; 2 requests, 1 tool round; saved v2 cassette (7 steps) replayed offline, neutrality-clean.

## 3. What remains unproven (the E2/E3 target)

- **Live fork continuation with a fresh adapter after mutation.** A newly constructed `AnthropicModelClient` (empty pending state) continuing from a *mutated* fork point, with the continuation request assembled entirely from cassette data, has not been run against the live API. E3 settles this.

---

## 4. Parent artifact

- `traces/anthropic-tooluse-parent.json` — the E1 output. **git-ignored** (never committed).
- Confirmed on-disk structure (7 steps, version 2):

  | idx | type | note |
  |---|---|---|
  | 0 | `model_input` | 1 message, string content (the prompt) |
  | 1 | `model_output` | `tool_call`, `toolCallId="call-0"` |
  | 2 | `tool_call` | `search`, `call-0` |
  | 3 | `tool_result` | `search`, `call-0`, result `{ results: [...] }` ← **mutation target** |
  | 4 | `model_input` | 3 messages ← **fork index** |
  | 5 | `model_output` | `final_answer` |
  | 6 | `metadata` | `run_completed` |

---

## 5. Fork geometry

- **Dynamically locate** the first `tool_result` step index (`trIdx`). On the current local parent, `trIdx = 3`.
- **`forkIndex = trIdx + 1`** (= 4 here). **Assert** that step is a `model_input`; safe-fail otherwise.
- This is the **only** valid fork point for mutating the `tool_result`: `forkRun`'s stale-`model_input` guard forbids a `model_input` between the earliest mutation index and `forkIndex`, so `forkIndex` must be exactly `trIdx + 1`.
- Verbatim prefix = steps `[0, trIdx)` (copied with identical hashes); the mutated `tool_result` at `trIdx` is re-appended with a new hash.

---

## 6. Mutation

- Target: step `trIdx` `tool_result` (`search`, `call-0`), currently a non-empty fixture result `{ results: [ { fixture… } ] }`.
- Mutation value: a **meaningfully different** no-availability result, e.g.:

  ```json
  { "results": [], "available": false, "message": "No hotels available for that date." }
  ```

- Defensive assert: mutation value differs from the parent's step-`trIdx` result (guarantees hash divergence at `trIdx`).
- `forkRun` preserves `toolCallId: "call-0"` and `toolName: "search"` through the mutation (W4-D3), replacing only `result`.

---

## 7. Fresh adapter (continuation)

- Pass `model: new AnthropicModelClient({ client: <capturing wrapper around a fresh real Anthropic client>, model: "claude-haiku-4-5-20251001" })` to `forkRun`. **Fresh** = newly constructed instance with an empty `#pendingToolCalls`, so correlation must come from cassette data alone.
- `forkRun` builds `initialMessages = [ user prompt, assistant [tool_use call-0], user [tool_result call-0 = MUTATION] ]` and seeds `initialToolCallIndex = 1` (any new tool call becomes `call-1`, never reusing `call-0`).
- The fresh adapter's structured translation path builds the live request purely from the reconstructed messages — the exact "no adapter memory" claim, now exercised live.
- `maxSteps` small (e.g. 4); the "no availability" mutation naturally yields a final answer.

---

## 8. Child artifact

- `traces/anthropic-tooluse-fork.json` (git-ignored), `childId = "${parent.id}-fork"`.
- **Save only after** all gate assertions pass: the child is validated (`validateTrace`), confirmed `version === 2`, and neutrality-audited **in memory first**, and the live continuation completed. A rejected or partial run **never** writes a child.

---

## 9. Diff expectation

`diffTraces(parent, child)` must report:

- `hasDivergence === true`
- `firstDivergenceIndex === trIdx` (the mutated `tool_result`, = 3)
- `sharedPrefixLength === trIdx` (= 3)
- steps `[0, trIdx)` are **canonical-hash-identical** (verbatim `loadPrefix`).

First divergence stays at `trIdx` regardless of how many continuation steps the real model produces.

---

## 10. Neutrality checks

Run `auditNeutrality(JSON.stringify(trace), apiKey)` on **both** parent and child. Neither may contain:

- `toolu_` (provider tool_use ids), `msg_` (message ids), `usage`, `stop_reason`, `stop_sequence`, `ANTHROPIC_API_KEY`, the literal key value, or raw provider content arrays.

Only neutral `call-N` ids and neutral `MessagePart[]` / step payloads are permitted. The child is built from a real continuation, so its audit is the load-bearing new check.

---

## 11. Failure handling

- **Missing key:** exit 1 before constructing any client or file; no child written.
- **Missing parent** (git-ignored → absent on fresh clones): record a fresh parent via the E1 scenario (the sanctioned "necessary" re-record), logged clearly, then proceed — keeping E3 self-contained. (A stricter alternative is to exit 1 instructing the user to run `example:real-tooluse-proof` first.)
- **Provider rejection of the continuation** (the negative result): `forkRun` throws a normalized `ModelCallError` → catch → **no child saved** → exit 1 with a diagnostic → triggers the §9 rollback of `docs/16` (on-wire id reshape; traces still store `call-N`).
- **Unexpected shape:** no `tool_result` step, or `forkIndex` step is not a `model_input`, or the continuation returns an unmappable stop reason → assert/catch → safe-fail, no partial child.
- **All-or-nothing save:** gate-check the child in memory before writing; never leave a partial child on disk.

---

## 12. Tests (offline / mocked only — no live tests)

- **No live/key-gated tests in `npm test`** (guardrail).
- Add **one** focused offline integration test, `tests/forkAnthropicContinuation.test.ts`:
  - Build a structured v2 parent via `runAgentLoop` + `FakeDeterministicModelClient` (one search round + final answer).
  - `forkRun` at the `tool_result` with a **mocked** `AnthropicModelClient` (injected capturing client returning a scripted `final_answer`), mutating the result.
  - Assert: child validates and is `version === 2`; `diffTraces` first divergence at the `tool_result`; prefix hash-identical; `auditNeutrality` clean; and the **captured continuation request** carried `call-0` as `tool_use.id` and `tool_result.tool_use_id` with the **mutated** result content, from a fresh (stateless) adapter.
- This is the offline analog of E3 — it locks the mechanism without a network call. Much is already covered by W4-D3/D4; this single test ties fork + real-adapter request shape together.

---

## 13. Docs plan (after E3 passes)

- `docs/16_week_four_e_plan.md` — mark E2/E3 result (PASS): the full live loop is proven.
- `docs/08_build_log.md` — W4-E E2/E3 entry with the empirical result.
- `docs/13_adapter_contract.md` — flip "real fork continuation … not yet proven" → **proven** (cite `example:real-fork-proof`, commit).
- `AGENTS.md` — milestone → W4-E complete (E1 + E2/E3 passed).
- `README.md` / `DEMO.md` — the full live `record → replay → fork → mutate → continue → diff` loop is now proven; list `example:real-fork-proof` as opt-in, non-CLI, non-`npm test`.

---

## 14. Acceptance criteria

1. `npm test -- --run` stays green (offline; +1 mocked integration test; zero live calls).
2. With key: E3 forks at the `tool_result`, mutates, continues with a **fresh** adapter, and the API **accepts** the cassette-built continuation (run completes).
3. Child validates (hash chain), `version === 2`.
4. `diffTraces`: first divergence at the mutated `tool_result` (index `trIdx`); canonical-hash-identical prefix before it.
5. Neutrality audit passes on **both** parent and child.
6. Child replays offline (`success`, no provider calls).
7. Missing key → exit 1, no child written.
8. Missing parent → self-contained record (logged) or clean exit 1; never a partial child.
9. Provider rejection / unexpected shape → caught, no partial child, exit 1 diagnostic.
10. Both cassettes remain git-ignored and uncommitted.

---

## 15. Non-goals

- No UI / dashboard / observability.
- No CLI Anthropic wiring.
- No live / key-gated tests in `npm test`.
- No product-runtime semantics drift — **no `forkRun` or adapter runtime change** (proof script + one offline test + docs only).
- No provider-native ids / usage / message-ids / content-arrays / `stop_reason` / `stop_sequence` / key in traces.
- No change to `replayTrace`'s Trace-only signature; offline replay stays structural.
- No multi-provider abstraction; no streaming; no packaging.
- No committing trace artifacts (both cassettes stay git-ignored).
- No new mutation semantics beyond `tool_result` result replacement.

---

## 16. Recommended first Sonnet implementation prompt

> Implement W4-E E2/E3 only. No product-runtime change; no CLI wiring; no live tests in `npm test`.
>
> (1) Add opt-in `src/examples/realForkProof.ts` + `example:real-fork-proof`, reusing `toolUseProofHelpers.ts`. Key-gated (exit 1, no trace if absent). Load `traces/anthropic-tooluse-parent.json` if present (validate + assert v2, locate first `tool_result` = `trIdx`, assert step `trIdx+1` is `model_input`); if absent, record a fresh parent via the E1 scenario and log it.
>
> E2: `validateTrace` + `replayTrace` the parent; assert `status === "success"`.
>
> E3: `forkRun({ parentTrace, forkIndex: trIdx+1, toolResultMutations: { [trIdx]: { results: [], available: false, message: "No hotels available for that date." } }, model: new AnthropicModelClient({ client: <capturing wrapper around a fresh real Anthropic client>, model: "claude-haiku-4-5-20251001" }), toolExecutor: defaultToolExecutor(), maxSteps: 4 })`. Assert the captured continuation request carried `tool_use.id="call-0"` and `tool_result.tool_use_id="call-0"` with the mutated result; gate-check the child (validate, v2, `auditNeutrality`) **before** saving to `traces/anthropic-tooluse-fork.json`; `diffTraces` → assert first divergence at `trIdx`, `sharedPrefixLength === trIdx`; offline-replay the child. On provider rejection or unexpected shape, exit 1 with a diagnostic and write no child.
>
> (2) Add offline mocked test `tests/forkAnthropicContinuation.test.ts` (fork + mocked `AnthropicModelClient` continuation; assert child validity, first divergence, prefix identity, neutrality, and captured `call-0` correlation with the mutated result).
>
> Do NOT run the with-key proof — stop and report; the human runs it manually. Do not tag.

---

## 17. Recommended Codex audit prompt

> Audit this E2/E3 plan and (after implementation) the diff. Confirm: E2/E3 add no product-runtime change; the fork geometry (`forkIndex = trIdx+1`) respects `forkRun`'s stale-`model_input` guard; the child is gate-checked before any save (no partial child on rejection); neutrality holds on parent AND child; `diffTraces` first divergence is at the mutated `tool_result` with a canonical-hash-identical prefix; no live tests enter `npm test`; both cassettes stay git-ignored; and the §9 rollback (on-wire id reshape) remains available and neutrality-safe if the live continuation is rejected. Return verdict + required revisions.

---

## 18. Tag recommendation

**Tag only after E3 live PASS + Codex closeout audit**, likely `week-four-real-fork-proof`. This completes W4-E: the full active-debugging loop proven live. On failure: no tag — apply the §9 rollback (on-wire id reshape) and re-run.

---

## Verdict

**E2/E3 PASSED — full live loop proven.** A fresh, stateless `AnthropicModelClient` continued from a mutated structured v2 fork point using only cassette data and neutral `call-0` correlation; the real API accepted it, and the diff/prefix-identity invariants held on a real parent/child pair. This completes the W4-E thesis: `record → replay → fork → mutate → continue → diff` works end-to-end against the live provider. Remaining W4-E closeout: docs (this slice) + Codex closeout audit, then tag `week-four-real-fork-proof`.
