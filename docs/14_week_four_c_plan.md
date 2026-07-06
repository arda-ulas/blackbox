# W4-C Plan: Anthropic Adapter Spike

## Goal

Add a minimal, opt-in Anthropic adapter so Blackbox can record one real multi-step model run, then replay it entirely offline from cassette. Proving that the replay/fork/diff loop holds against actual model output is the only deliverable.

---

## Non-Goals

- No web UI, dashboard, or any browser-based interface
- No hosted backend, remote cassette storage, or sharing
- No streaming response support (non-streaming only)
- No retry logic, rate limiting, or backoff
- No prompt management or template system
- No metrics, telemetry, or observability features
- No second provider (OpenAI, Gemini, Cohere) — one adapter proves the loop
- No real fixture tools making network calls — fixture tools stay deterministic
- No CLI wiring by default — fake adapter remains the global default

---

## Guardrails

These constraints are non-negotiable and must be verified before any implementation step proceeds:

| Constraint | Requirement |
|---|---|
| Default adapter | `FakeDeterministicModelClient` remains the default in all tests and CLI commands |
| Opt-in only | Anthropic adapter only activates via explicit CLI flag (`--adapter anthropic`) or isolated proof script |
| Replay isolation | `replayTrace` takes no `ModelClient` parameter — structurally impossible to call Anthropic during replay |
| Fork/diff | Recorded traces (real or fake) fork and diff identically — no adapter-specific logic in `forkRun` or `diffTraces` |
| API key source | `process.env.ANTHROPIC_API_KEY` only — never hardcoded, never in config files, never in traces or logs |
| API key never stored | No field in `TraceStep.payload`, `Trace` metadata, log output, or any written file may contain the key |
| Error sanitization | All Anthropic SDK errors caught inside `complete()`, normalized to `ModelCallError`, re-thrown — raw SDK objects never reach `agentLoop` |
| Provider-neutral payloads | `TraceStep.payload` contains no Anthropic-native fields (`message.id`, `usage`, `model`, `stop_sequence`) |
| Test suite | `npm test -- --run` passes with 182+ tests and zero real provider calls — all Anthropic tests skipped when key absent |

---

## Proposed Implementation Slices

### W4-C1: Package install + adapter skeleton

**What:**
- Install `@anthropic-ai/sdk` as a dev/optional dependency
- Create `src/agent/anthropicModelClient.ts` implementing `ModelClient`
- Skeleton: constructor reads `ANTHROPIC_API_KEY` from env, throws clearly if absent
- `complete()` method stubbed (throws `"not yet implemented"` or returns a hardcoded response)
- Guarded test file `tests/anthropicModelClient.test.ts` — all tests skip if key absent
- No CLI exposure in this slice

**Files to touch:**
- `package.json` — add `@anthropic-ai/sdk`
- `src/agent/anthropicModelClient.ts` (new)
- `tests/anthropicModelClient.test.ts` (new)

**Acceptance gate:** `npm test -- --run` still passes 182+ tests with no regressions; adapter file compiles.

---

### W4-C2: Full Anthropic adapter implementation

**What:**
- Implement `complete(input: ModelInput): Promise<ModelOutput>` using non-streaming `messages.create()`
- Translate `ModelInput.messages` (current legacy encoding) to Anthropic message format
- Translate `ModelInput.tools` (`ToolDefinition[]`) to Anthropic tool schema
- Translate Anthropic response to `ModelOutput`:
  - `stop_reason === "tool_use"` → `{ type: "tool_call", toolName, toolInput }`
  - `stop_reason === "end_turn"` with text content → `{ type: "final_answer", text }`
  - Any other stop reason → throw `ModelCallError` with `errorKind: "provider_malformed_response"`
- Catch all Anthropic SDK errors, classify into `ModelErrorKind`, re-throw as `ModelCallError`
- Retain `tool_use_id` in memory (needed for tool result correlation) — never stored in trace
- Add guarded tests: missing key, auth error simulation, response translation

**Open questions to resolve in W4-C2 (before writing code):**
1. What is the exact Anthropic SDK call signature for `messages.create()` non-streaming?
2. How does the SDK represent tool-use blocks? (`block.type === "tool_use"`, `block.name`, `block.input`, `block.id`)
3. Does the SDK provide a typed error hierarchy for auth/timeout/refusal classification?
4. Which model name to use? Candidates: `claude-haiku-4-5-20251001` (cheapest), `claude-sonnet-4-6` (same as assistant). **Recommendation: `claude-haiku-4-5-20251001`** for the proof script — minimal cost per run.
5. Does the current legacy transcript encoding (`[tool_call:<toolName>]` / `JSON.stringify(toolResult)`) give the adapter enough information to reconstruct tool-result messages? The adapter needs `toolName` when sending `tool_result` back to Anthropic (for `tool_use_id` correlation). **Likely answer: no — the adapter must maintain a local call map from tool name to tool_use_id within one complete() cycle.** This does not require transcript migration (Path A from the contract doc).

**Files to touch:**
- `src/agent/anthropicModelClient.ts` — full implementation
- `tests/anthropicModelClient.test.ts` — full guarded test suite

**Acceptance gate:** manually instantiating the adapter with a real key produces a `ModelOutput`; missing key throws clearly; all guarded tests pass or skip correctly.

---

### W4-C3: Proof script — record/replay/fork real cassette

**What:**
- Create `src/examples/realRunProof.ts`
- Script preamble: check `ANTHROPIC_API_KEY` present, exit 1 with clear message if absent
- Record one real multi-step run (prompt → tool call → tool result → final answer) using `AnthropicModelClient` and fixture tools
- Save trace to `traces/real-run-proof.json`
- Replay the saved trace offline — `replayTrace(trace)` — assert `status === "success"`
- Fork from the cassette at the tool-result step with a mutation — `forkRun(...)` — assert child trace validates
- Run `diffTraces(parent, child)` — assert `hasDivergence === true` at the mutation step
- Validate all traces with `validateTrace`
- Print `PASS` / `FAIL` with details; exit with appropriate code
- Not in `npm test`; run manually with `npx tsx src/examples/realRunProof.ts`

**Files to touch:**
- `src/examples/realRunProof.ts` (new)

**Acceptance gate:** manual run with a real key prints `PASS`; trace file on disk validates; replay/fork/diff produce correct results without re-calling Anthropic.

---

### W4-C4: Safety checks and docs

**What:**
- Add `traces/real-run-proof.json` to `.gitignore` (real model output; not committed)
- Verify `.env` and `*.env` already in `.gitignore` (already done in W4-A)
- Secret-scan check: `git grep -r "ANTHROPIC_API_KEY\s*=" src/` must return nothing (key appears only as `process.env.ANTHROPIC_API_KEY`)
- Update `docs/08_build_log.md` with W4-C completion entry
- Brief DEMO.md addendum (optional) noting the real-adapter proof script exists

**Files to touch:**
- `.gitignore` — add `traces/real-run-proof.json`
- `docs/08_build_log.md` — W4-C completion note

**Acceptance gate:** Codex scan finds no hardcoded key references; `npm test -- --run` still passes unchanged.

---

## Tests

### Default test suite (always runs — no key required)

All 182 existing tests continue passing. No new test in the default suite requires a real provider call.

### Guarded Anthropic tests (`tests/anthropicModelClient.test.ts`)

Each test begins with:
```typescript
if (!process.env.ANTHROPIC_API_KEY) {
  it.skip("ANTHROPIC_API_KEY not set — skipping real provider tests");
  // remaining tests are not registered
}
```

Guarded tests to add (all require key to run; all skip cleanly without it):

| Test | What it proves |
|---|---|
| Missing key throws on instantiation | Adapter fails fast, not silently at call time |
| Provider auth error → `ModelCallError` with `provider_auth_error` | Error sanitization works |
| Successful non-streaming call returns valid `ModelOutput` | Happy path translation |
| Tool-use response maps to `{ type: "tool_call", toolName, toolInput }` | Tool call translation correct |
| `tool_use_id` not present in returned `ModelOutput` | Provider-native field stripped |
| Trace recorded via `AnthropicModelClient` passes `validateTrace` | Payload is JSON-safe and chain is intact |
| Trace payload contains no `ANTHROPIC_API_KEY` substring | Key never stored |
| Replay of real-provider trace returns `status: "success"` without calling Anthropic | Cassette isolation holds |

---

## Open Questions

These must be resolved by reading Anthropic SDK types and docs **before writing W4-C2 code**, not after:

1. **Non-streaming call signature.** Is `client.messages.create({ stream: false, ... })` the correct form? Does it return a typed `Message` object synchronously from the promise?

2. **Tool-use block shape.** Confirm `block.type === "tool_use"`, `block.name` (not `block.tool_name`), `block.input` (already parsed object, not a string), `block.id` (for tool_use_id).

3. **SDK error hierarchy.** Does `@anthropic-ai/sdk` export typed error classes (e.g., `Anthropic.AuthenticationError`, `Anthropic.RateLimitError`)? If so, map them directly to `ModelErrorKind` values in the adapter.

4. **Model name.** Confirm `claude-haiku-4-5-20251001` is valid and available before hardcoding it. Consider making it a constructor parameter with a sensible default.

5. **Tool call ↔ tool result correlation.** The Anthropic API requires `tool_use_id` on the `tool_result` content block. The current `agentLoop` transcript encodes tool-call turns as `[tool_call:<toolName>]` (no id). The adapter must maintain a local `Map<toolName, tool_use_id>` within a single multi-turn call cycle. This is internal to the adapter and does not affect the trace schema.

6. **Tool support required in W4-C2?** If the proof script requires a tool call (to exercise the full record → fork → diff path), then yes — tool support must be implemented in W4-C2 before W4-C3 can run. **Recommendation: implement tool support in W4-C2 from the start.** A final-answer-only adapter cannot demonstrate fork/diff.

---

## Recommended Implementation Order

1. **Resolve open questions first** — read `@anthropic-ai/sdk` TypeScript types in `node_modules` after install; check Anthropic API reference. Time-box to 30 minutes before writing any adapter code.
2. **W4-C1** — install package, skeleton compiles, guarded test file exists, 182 tests still pass.
3. **Codex audit of W4-C1** before proceeding to W4-C2.
4. **W4-C2** — full adapter, guarded tests.
5. **W4-C3** — proof script, manual run with real key.
6. **W4-C4** — safety checks, docs, gitignore.
7. **Codex final audit** — confirm no key leakage, payload purity, replay isolation.
8. **Human decision** — promote, keep behind flag, or revert (per W4-E).

---

## What Not to Build in W4-C

- A second provider adapter (OpenAI, Gemini, Cohere) — not until the Anthropic loop is proven
- Streaming responses — adds significant complexity; non-streaming is sufficient for the proof
- Rate-limit retry logic — handle in W4-D or later if needed
- CLI flag wiring (`--adapter anthropic`) — proof script only; CLI default stays fake
- Session or conversation management beyond a single run
- Token usage tracking or cost reporting
- System prompt injection from CLI flags
- Any UI component, web server, or hosted endpoint
