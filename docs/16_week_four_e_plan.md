# W4-E Plan — Real-Provider Structured Tool-Use / Fork Proof

**Status:** E1, E2, and E3 all **PASSED** (2026-07-06). Full live loop proven; W4-E in closeout.
**Predecessor:** `week-four-structured-transcript-migration` (`33329ab`).
**Mode:** narrow, opt-in, live-gated. Exactly one purpose: answer one empirical question.

> **Full-loop result (2026-07-06):** E2/E3 (`example:real-fork-proof`, script `d4d01f8`) PASSED — a fresh `AnthropicModelClient` continued from a mutated structured v2 fork point using only cassette data; the live API accepted it, and the diff/prefix-identity invariants held on a real parent/child pair. The complete active-debugging loop **record → replay → fork → mutate → continue → diff** is proven against the live provider. See `docs/17_week_four_e2e3_plan.md`.

> **E1 result (2026-07-06):** the with-key proof (`npm run example:real-tooluse-proof`, commit `ed1628a`) **PASSED**. The real Anthropic Messages API (`claude-haiku-4-5-20251001`) accepted Blackbox's synthetic `call-0` as the turn-2 `tool_use.id` and `tool_result.tool_use_id`; the run completed to a final answer and the saved v2 cassette replayed offline, neutrality-clean. The core §2 assumption is proven for a single real record. **Real fork continuation (E2/E3) is now also proven** — see the full-loop result below.

---

## 1. Thesis

W4-D proved, against a **mocked** client, that a fresh `AnthropicModelClient` can translate a structured v2 cassette into a self-consistent Anthropic request using Blackbox's provider-neutral `toolCallId` as both `tool_use.id` and `tool_result.tool_use_id`. W4-E asks whether the **real Anthropic Messages API accepts that synthetic, request-local `toolCallId`** — and, if so, demonstrates the full active-debugging loop end-to-end against the live provider:

> **record (real tool-use) → replay (offline) → fork at a tool_result → mutate → continue (fresh real adapter) → diff.**

If the API accepts `call-0`, structured v2 cassettes are sufficient for real-provider fork/continue, and the W4-D deferral is discharged. If it rejects them, we learn the precise constraint cheaply and apply a bounded, neutrality-preserving contingency (§9) — or hard-stop — without ever storing provider-native ids in traces.

---

## 2. The exact Anthropic API assumption to verify

**Within a single request, does the Anthropic Messages API accept a client-constructed assistant `tool_use` block whose `id` is an arbitrary synthetic string (`"call-0"`), correlated by a following user `tool_result` block whose `tool_use_id` equals that same string — even though the API originally issued a different `toolu_…` id that Blackbox never persisted in the cassette?**

Critical insight from tracing the flow: this substitution is exercised **on the second turn of any real multi-turn tool run**, not only on fork. During record:

1. **Turn 1 request:** user prompt + tool definitions → API responds `stop_reason: "tool_use"` with a `tool_use` block carrying a server-issued `id: "toolu_…"`, `name`, `input`.
2. The adapter's `translateResponse` **discards** `toolu_…` and returns a provider-neutral `{ type: "tool_call", toolName, toolInput }`; `agentLoop` assigns its own `call-0`.
3. `agentLoop` executes the fixture tool and records structured messages using `call-0`.
4. **Turn 2 request:** the reconstructed conversation now contains an assistant `[{ type: "tool_use", id: "call-0", … }]` and a user `[{ type: "tool_result", tool_use_id: "call-0", … }]` → sent to the API.

So a plain real tool-use **record** already substitutes `call-0` for the server's `toolu_…` on turn 2. That makes a single real tool-use record the natural **go/no-go gate** (E1, §5) — the assumption is settled before any fork/replay/diff logic is built. Fork/continue (E3) is a stronger instance of the identical mechanism, driven by a **fresh** adapter with no shared state.

---

## 3. Installed SDK type finding

Verified directly against the installed `@anthropic-ai/sdk` (`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`):

- `ToolUseBlockParam.id: string` — the request-side assistant `tool_use` id is a plain, client-supplied `string`.
- `ToolResultBlockParam.tool_use_id: string` — the request-side correlation id is a plain `string`.
- `ToolResultBlockParam.is_error?: boolean` and `content?: string | Array<…>` — already used by the structured adapter path.

**Conclusion:** the type system **permits** `"call-0"` as both `id` and `tool_use_id` — there is no compile-time obstacle. But types describe *shape*, not *runtime acceptance*: they do **not** prove that the live endpoint accepts a synthetic request-local id (no charset/length/prefix validation is expressible in the type). That residual is precisely why a live proof is required.

---

## 4. Context7 requirement before any live call

Before spending a single live call, the first implementation step (inside E0/E1) is a **Context7** fetch of the current Anthropic Messages API documentation for `tool_use` / `tool_result` id-correlation semantics:

- Confirm the docs characterize `tool_use_id` as **request-local** correlation (matched within one request), not a server-issued token that must be echoed.
- Confirm that constructed / prefilled assistant turns supply their own `tool_use.id`.
- Summarize the verified assumption in the E1 commit message per `AGENTS.md` rules 5 and 7 (SDK-boundary documentation rule).

Context7 + installed types raise confidence but **cannot** close the assumption; only E1's live call does. Do not skip Context7, and do not treat it as a substitute for the live proof.

---

## 5. E1 — go/no-go proof (one real tool-use record only) — ✅ PASSED

**Result (2026-07-06, commit `ed1628a`):** run against `claude-haiku-4-5-20251001` — 2 requests sent, 1 tool round; the turn-2 request carried `tool_use.id="call-0"` and `tool_result.tool_use_id="call-0"`; the API accepted it and the run completed; the 7-step v2 cassette (`traces/anthropic-tooluse-parent.json`, git-ignored) validated, replayed offline (`success`), and passed the neutrality audit (no `toolu_`/`msg_`/`usage`/`stop_reason`/`stop_sequence`/key). **Gate passed → proceed to E2/E3.**

E1 is the hard gate. It builds the minimum needed to answer §2 and nothing more.

- **New script:** `src/examples/realToolUseProof.ts` (separate from the frozen W4-C3 `realRunProof.ts`).
- **npm script:** `example:real-tooluse-proof` — **opt-in**, **not** in `npm test`, **no** CLI wiring.
- **Model:** `claude-haiku-4-5-20251001` (cheap), real key, small `maxSteps`.
- **Tools:** existing deterministic fixture tools via `defaultToolExecutor()` (real code, no network).
- **Scenario:** a prompt that naturally induces exactly one `search` tool_use; the fixture returns a deterministic result; the model then concludes.
- **Assertion (the gate):** the **turn-2 request** carried `call-0` as `tool_use.id` and `tool_use_id`, and the API returned a normal completion (no `invalid_request` / id rejection).
- **Save:** `traces/anthropic-tooluse-parent.json` (git-ignored).
- **Neutrality audit:** serialized parent trace contains no `toolu_`, `usage`, `msg_`/`message_id`, `stop_reason`, or the key.

**If E1 fails, stop.** Do not build E2/E3; invoke the rollback plan (§9).

---

## 6. E2 / E3 — only after E1 passes

- **E2 — offline replay:** `loadTrace` + `validateTrace` + `replayTrace` on the parent cassette. Zero provider calls (the `replayTrace(trace)` Trace-only signature is unchanged; offline replay stays structural).
- **E3 — fork → mutate → continue → diff (live):**
  - `forkRun` at the parent's `tool_result` step, injecting a different result (e.g. "no availability").
  - Continue with a **newly constructed** `AnthropicModelClient` — proving no shared in-memory pending state is needed to correlate from the cassette.
  - Save `traces/anthropic-tooluse-fork.json` (git-ignored).
  - `diffTraces(parent, child)` → assert first divergence exactly at the mutated `tool_result` index, with a hash-identical prefix before it.

E3 demonstrates the full **record → replay → fork → mutate → continue → diff** loop against the live provider — the active-debugging value proposition.

---

## 7. Safe failure with a missing key

Same discipline as `realRunProof.ts`:

- Check `ANTHROPIC_API_KEY` **before** constructing any client or creating any file.
- If absent: print a clear message → `exit 1` → **write no trace**.
- If a live call throws (including a synthetic-id rejection): catch, print the classified `ModelCallError` (kind + message) so an id-rejection surfaces as a **diagnostic negative result**, not a stack trace; write no partial cassette; `exit 1`.

The failure path distinguishes "no key" from "API rejected the synthetic id" so the go/no-go outcome is unambiguous.

---

## 8. Neutrality invariant — data that must never enter traces

Never store, in any `TraceStep.payload` or trace metadata:

- provider-native `tool_use.id` (`toolu_…`),
- `message.id`,
- `usage` token counts,
- the `model` identifier as a stored payload field,
- `stop_reason` / `stop_sequence`,
- raw provider content-block arrays,
- system fingerprint or any other provider metadata,
- the API key (never anywhere — payload, log, or file).

Only neutral `call-N` ids and neutral `MessagePart[]` / step payloads are permitted. This is already enforced by the adapter (`translateResponse` returns neutral output); E1's neutrality audit (§5) re-asserts it on real cassettes, and E3 re-asserts it on the child.

---

## 9. Failure / rollback plan if Anthropic rejects `call-0`

A rejection is almost certainly a **format constraint** (charset / length / prefix) on a *request-local* id — not a provenance requirement, because the assistant turn is client-constructed and correlation is validated within the request.

- **Contingency A — on-wire id reshape (preferred):** inside the adapter's `translatePart`, derive a provider-acceptable **request-local** id from the neutral `toolCallId` via a pure function (e.g. `toolu_` + a deterministic encode of `call-N`), applied identically to the paired `tool_use.id` and `tool_result.tool_use_id` within the same request. **Traces still store only `call-N`;** only the on-wire id is reshaped inside the adapter. The neutrality invariant (§8) is preserved. Re-run E1.
- **Contingency B — hard stop:** if the rejection is deeper than format (e.g. the endpoint requires server-issued ids even on client-constructed turns — considered very unlikely), document that real-provider structured continuation is not viable with Anthropic as-is; Blackbox real-fork remains fake-only; open a separate design decision outside W4-E scope. **No neutrality-violating workaround is permitted.**

Either way: record the empirical result (pass or fail) in the build log, and **do not tag a "proof" on failure.**

---

## 10. Acceptance criteria

1. `npm test -- --run` stays green (**274/274** after E1 + E2/E3 added offline helper/integration tests), with **zero live calls** — `npm test` remains fully offline; only mocked/pure unit tests were added, no live/key-gated tests.
2. With key: real record where the turn-2 request sends `call-0` as `tool_use.id` / `tool_use_id` and the API **accepts** it (run completes). ← core assumption proven.
3. Parent cassette validates (hash chain) and replays fully offline (no provider calls in replay).
4. Fork + mutate continues with a **fresh** adapter (no shared state); continuation call succeeds.
5. `diffTraces(parent, child)` reports first divergence exactly at the mutated `tool_result`; prefix before it is hash-identical.
6. Neutrality audit passes on both parent and child cassettes (§8).
7. Without key: exit 1, clear message, no trace written.
8. On synthetic-id rejection: graceful diagnostic exit 1 (negative result captured, not a crash).

---

## 11. Implementation slices (E0–E4)

- **E0 — research (no code):** ✅ Context7 confirmation (§4) + record the verified assumption. Installed types confirmed (§3).
- **E1 — go/no-go record proof:** ✅ **PASSED** (commit `ed1628a`; live run 2026-07-06). Synthetic `call-0` accepted by the real API; parent cassette saved; neutrality clean.
- **E2 — offline replay phase** of the parent cassette. *(✅ done — in `example:real-fork-proof`, commit `d4d01f8`)*
- **E3 — fork → mutate → fresh-adapter continue → diff phase**; save child; assert first divergence at the mutation step. *(✅ PASSED live — `example:real-fork-proof`, 2026-07-06)*
- **E4 — docs + build log + tag decision** (§13, §16). *(✅ done — E1 + E2/E3 docs recorded; E3 PASSED; closeout audit completed and tagged `week-four-real-fork-proof`)*

---

## 12. Tests

- **No live tests in `npm test`** (guardrail). The live proof script is the manual, gated test of the runtime assumption.
- Offline additions (mocked; add only if not already covered by W4-D4):
  - a structured multi-tool mocked cassette serialized → assert no `toolu_` / `usage` / `msg_` / `stop_reason`;
  - `forkRun` on a structured multi-tool cassette + a fresh **mocked** adapter continuation round-trips and diffs at the mutation step.
- These lock the loop logic without the network; the live script proves only the runtime-acceptance residual.

---

## 13. Docs plan

- `docs/16_week_four_e_plan.md` — this plan (created now).
- On **PASS**: `docs/13_adapter_contract.md` — replace the "deferred to W4-E" language with "verified live (proof: `example:real-tooluse-proof`, commit X): Anthropic accepts a request-local synthetic `toolCallId` as `tool_use.id`; traces still store only neutral ids." Add a one-line note in `docs/03_trace_schema.md`.
- `docs/08_build_log.md` — W4-E entry with the empirical result (pass or fail).
- `AGENTS.md` — milestone → W4-E; update the "do not claim Anthropic accepts synthetic id" rule to the proven (or re-deferred) outcome.
- `README.md` / `DEMO.md` — only if the opt-in command is worth listing; mark it opt-in, non-CLI, non-`npm test`.

(These downstream doc edits are **not** made by this planning artifact; they land with their respective slices.)

---

## 14. Explicit non-goals

- No UI / dashboard / observability.
- No default CLI Anthropic wiring (proof-script only — see §15 recommendation below).
- No live tests in `npm test`.
- No provider-native ids / usage / message-ids / content-arrays / `stop_reason` in payloads.
- No change to `replayTrace`'s Trace-only signature; offline replay stays structural.
- No multi-provider abstraction (Anthropic only).
- No streaming.
- No packaging / productization.
- No committing real model outputs as fixtures (cassettes stay git-ignored).

---

## 15. CLI wiring & tag recommendations

- **CLI wiring:** remain **proof-script only**. CLI wiring is productization, expands surface, and risks accidental live calls; it is not needed to answer the core question. Defer any `--adapter anthropic` flag to a later, explicitly-scoped milestone contingent on E1 passing.
- **Tag:** create a new tag **only on a clean PASS + Codex acceptance**, e.g. `week-four-real-fork-proof`. E1 and E2/E3 PASSED, the closeout audit completed, and the tag `week-four-real-fork-proof` was created. On failure, no proof tag — document the negative result and the chosen contingency in the build log.

---

## 16. Recommended first prompts

**Claude (E1 only):**

> Implement W4-E slice E1 only. Do not build fork/replay phases. First run a Context7 check of the Anthropic Messages API `tool_use` / `tool_result` id-correlation semantics and summarize the verified assumption. Then add opt-in `src/examples/realToolUseProof.ts` + `example:real-tooluse-proof` (not in `npm test`, no CLI wiring): key-gated (exit 1, no trace if absent); record ONE real `search` tool-use round with `defaultToolExecutor()`; assert the turn-2 request carried `call-0` as `tool_use.id` / `tool_use_id` and the API accepted it; save `traces/anthropic-tooluse-parent.json`; assert the serialized trace contains no `toolu_` / `usage` / `msg_` / `stop_reason` / key. On API rejection, exit 1 with a diagnostic message. Stop; report PASS/FAIL of the acceptance assumption. Do not proceed to E2/E3.

**Codex (plan audit):**

> Audit `docs/16_week_four_e_plan.md` before implementation. Confirm: the go/no-go gate (E1) genuinely isolates the synthetic-id acceptance question; the neutrality invariant is preserved in both PASS and rollback paths; no live tests enter `npm test`; offline replay stays Trace-only; the contingency (on-wire id reshape) does not leak provider ids into traces. Return verdict + any required plan revisions.

---

## 17. Change / safety statement

*(Original planning-artifact statement — superseded by the results above.)* As of W4-E closeout: E1 shipped in `ed1628a` and E2/E3 in `d4d01f8`; both authorized live runs were performed manually and passed. The saved cassettes are git-ignored and not committed. The full loop (fork → mutate → continue → diff) is proven live — see `docs/17_week_four_e2e3_plan.md`.

---

## Verdict

**W4-E PASSED (E1 + E2/E3) — full live loop proven.** The real Anthropic API accepts Blackbox's synthetic request-local `call-0` as `tool_use.id` / `tool_result.tool_use_id` (E1), and a fresh, stateless adapter continues from a mutated structured v2 fork point using only cassette data (E2/E3). The complete active-debugging loop — record → replay → fork → mutate → continue → diff — is proven against the live provider. The §9 rollback path was not needed. Closeout audit completed and tagged `week-four-real-fork-proof`.
