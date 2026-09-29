# W4-C Plan: Anthropic Adapter Spike

## Goal

Add a minimal, opt-in Anthropic adapter so Blackbox can record one real model run, then replay it entirely offline from cassette. Proving that **record → offline replay** holds against actual model output is the W4-C deliverable.

**Scope clarification:** W4-C does NOT claim that fork continuation works end-to-end with a real provider adapter. See the Tool-Use Continuation section for why and what is deferred.

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
- No CLI flag wiring (`--adapter anthropic`) — proof-script only; CLI default stays fake
- No fork continuation via real provider adapter (deferred — see Tool-Use Continuation)

---

## Guardrails

These constraints are non-negotiable and must be verified before any implementation step proceeds:

| Constraint | Requirement |
|---|---|
| Default adapter | `FakeDeterministicModelClient` remains the default in all tests and CLI commands |
| Opt-in only | Anthropic adapter only activates via isolated proof script — **no CLI flag in W4-C** |
| Replay isolation | `replayTrace` accepts a `Trace` as its execution input; the current replay module has no Anthropic, model, tool-execution, or network dependency |
| Fork/diff on recorded traces | `forkRun` and `diffTraces` work identically on any `Trace` — no adapter-specific logic |
| API key source | `process.env.ANTHROPIC_API_KEY` only — never hardcoded, never in config files, never in traces or logs |
| API key never stored | No field in `TraceStep.payload`, `Trace` metadata, log output, or any written file may contain the key |
| Error sanitization | All Anthropic SDK errors caught inside `complete()`, normalized to `ModelCallError`, re-thrown — raw SDK objects never reach `agentLoop` |
| Provider-neutral payloads | `TraceStep.payload` contains no Anthropic-native fields (`message.id`, `usage`, `model`, `stop_sequence`, `tool_use_id`) |
| Default test suite | `npm test -- --run` passes with 182+ tests and **zero real provider calls** — SDK interactions mocked in default tests |

---

## Tool-Use Continuation Strategy

**This is the most critical design constraint in W4-C and must be resolved before W4-C2.**

### The problem

When `agentLoop` sends a tool result back to Anthropic, it needs a `tool_use_id` matching the original tool-call response block. The current legacy transcript stores:

- Assistant turn: `[tool_call:<toolName>]` — label string only, no id
- User turn: `JSON.stringify(toolResult)` — bare value, no toolName wrapper

A fresh adapter instance cannot reconstruct `tool_use_id` from these messages. A `Map<toolName, toolUseId>` maintained across calls within one run instance works only if:
1. The same tool is never called twice in a single run
2. The adapter instance is the same object for the entire run (live runs only — not fork continuation)

For **fork continuation** from a cassette, the adapter instance is always fresh. It has no way to recover `tool_use_id` from the stored `[tool_call:<toolName>]` entries. Fork continuation with a real provider adapter is therefore **unsound with the current transcript encoding**.

### Recommended path: narrow W4-C scope

**Do not claim fork continuation works with the Anthropic adapter.** The W4-C proof script demonstrates:

- Record a real model run (final-text-only — see W4-C3 rationale below)
- Replay the saved cassette offline

Fork continuation using the Anthropic adapter (calling `forkRun` and then continuing with a real provider) is deferred until structured transcript migration is complete. That migration (Path B from `docs/13_adapter_contract.md`) changes the assistant turn to `JSON.stringify({ toolName, toolInput, toolCallId })` and the user turn to `JSON.stringify({ toolName, toolCallId, result })`. W4-C must not attempt this migration.

### Within-run tool_use_id correlation (single run, single tool call)

For the narrow W4-C proof, the adapter maintains a local map only within a single `complete()` call's response processing — not across calls. The flow for one complete multi-turn run:

1. First `complete()`: Anthropic returns `tool_use` block, `id: "toolu_abc"`, `name: "search"`. Adapter extracts `toolName: "search"`, `toolInput`. Returns `{ type: "tool_call", toolName: "search", toolInput }`. Stores `pendingId = "toolu_abc"` in adapter instance state.
2. `agentLoop` records tool call, executes tool, appends messages. Calls `complete()` again.
3. Second `complete()`: adapter sees messages include `[tool_call:search]` assistant turn followed by `JSON.stringify(result)` user turn. Adapter reconstructs the tool-result content block using the stored `pendingId = "toolu_abc"`. Sends to Anthropic. Returns `{ type: "final_answer", text }`.

**Constraint**: the proof script must use a scenario where each tool is called at most once. This avoids the repeated-tool-name collision in the pending map. If multiple tool calls appear in one run, `pendingId` must be a list (FIFO order), not a single value — document this in the adapter.

This approach is intentionally minimal and fragile. It is sufficient for the proof and explicitly does not generalize. Document its limitations in the adapter source.

---

## ToolDefinition Input Schema

**This must be addressed before W4-C2**, because Anthropic's tool API requires an `input_schema` (JSON Schema) for each tool definition.

**Proposed resolution (additive, backward-compatible):**

Add an optional field to `ToolDefinition` in `src/agent/modelClient.ts`:

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: JsonObject; // JSON Schema; required by real provider adapters
}
```

For fixture tools, provide a permissive fallback schema in `FixtureToolExecutor.definitions()`:

```typescript
{ type: "object" } // accepts any object input — sufficient for fixture tools
```

The Anthropic adapter converts `inputSchema ?? { type: "object" }` to the Anthropic-required `input_schema` field. This conversion happens inside the adapter — `ToolDefinition` stays provider-neutral.

This change is part of W4-C1 or W4-C2 pre-work. All existing tests are unaffected (the field is optional and ignored by the fake adapter).

---

## Proposed Implementation Slices

### W4-C1: Package install + adapter skeleton with injected client

**What:**
- Install `@anthropic-ai/sdk` as a dependency
- Add `inputSchema?: JsonObject` to `ToolDefinition` in `src/agent/modelClient.ts` (additive, backward-compatible)
- Create `src/agent/anthropicModelClient.ts` implementing `ModelClient`
- Constructor accepts an optional pre-built Anthropic client for test injection:
  ```typescript
  constructor(options?: { apiKey?: string; client?: Anthropic })
  ```
  When `client` is not provided, read `ANTHROPIC_API_KEY` from env and construct the real client; throw clearly if the key is absent. When `client` is provided (test injection), use it directly without reading env.
- `complete()` method stubbed: throws `"not yet implemented"` — sufficient to compile and run tests
- Create `tests/anthropicModelClient.test.ts` in the **default test suite** (not key-gated) with mocked SDK client tests (see Tests section)
- No CLI exposure in this slice

**Files to touch:**
- `package.json` — add `@anthropic-ai/sdk`
- `src/agent/modelClient.ts` — add `inputSchema?: JsonObject` to `ToolDefinition`
- `src/agent/anthropicModelClient.ts` (new)
- `tests/anthropicModelClient.test.ts` (new)

**Acceptance gate:** `npm test -- --run` still passes 182+ tests with no regressions; adapter file compiles; mocked tests pass without a key.

---

### W4-C2: Full Anthropic adapter implementation

**Pre-work before writing code:**
- Read `@anthropic-ai/sdk` TypeScript types in `node_modules` to confirm exact call shapes (see Open Questions)
- Confirm the tool-use continuation strategy above is sufficient for the proof scenario

**What:**
- Implement `complete(input: ModelInput): Promise<ModelOutput>` using non-streaming `messages.create()`
- **Request translation** — convert `ModelInput` to Anthropic API format:
  - Parse legacy transcript: `[tool_call:<toolName>]` assistant turns → reconstruct as Anthropic tool_use content block using pending `tool_use_id` (see Tool-Use Continuation section)
  - `JSON.stringify(toolResult)` user turns → reconstruct as Anthropic tool_result content block with matching `tool_use_id`
  - Plain string user/assistant turns pass through as-is
  - `ModelInput.tools` → Anthropic `tools` array with `name`, `description`, `input_schema: def.inputSchema ?? { type: "object" }`
- **Response translation** — convert Anthropic response to `ModelOutput`:
  - `stop_reason === "tool_use"` → `{ type: "tool_call", toolName: block.name, toolInput: block.input }`. Store `block.id` in adapter state for next call.
  - `stop_reason === "end_turn"` with text content → `{ type: "final_answer", text }`
  - Any other stop reason → throw `ModelCallError("unexpected stop_reason", "provider_malformed_response")`
- **Error normalization** — catch all Anthropic SDK errors inside `complete()`, classify into `ModelErrorKind`, throw `ModelCallError`. Raw SDK objects never escape.
- No provider-native fields (`message.id`, `usage`, `model`, `stop_sequence`, `tool_use_id`) in the returned `ModelOutput` or anywhere that reaches `agentLoop`
- Expand `tests/anthropicModelClient.test.ts` with full mocked-client test suite (see Tests section)

**Files to touch:**
- `src/agent/anthropicModelClient.ts` — full implementation
- `tests/anthropicModelClient.test.ts` — full test suite (mocked + optional live)

**Acceptance gate:** all mocked tests pass in default suite; optional live tests pass or skip cleanly.

---

### W4-C3: Proof script — record and offline replay

**What (implemented):**
- `src/examples/realRunProof.ts` — explicit opt-in script, not in `npm test`
- Script preamble: check `ANTHROPIC_API_KEY` present, exit 1 with clear message if absent — no trace written
- Record one real run using `AnthropicModelClient` with a **final-text-only prompt** (no tool calls, no `defaultToolExecutor`)
- Save trace to `traces/anthropic-proof-trace.json`
- **Replay**: load and replay the saved trace fully offline via `loadTrace` + `replayTrace`; assert `status === "success"` — proves cassette is sufficient, no Anthropic call made during replay
- **Validate**: call `validateTrace` before and after save; assert no throw — proves hash chain is intact
- Print `PASS` / `FAIL` with details; exit with appropriate code
- Run with: `npm run example:real-proof`

**Why final-text-only (no tools):**
Tool-use proof is explicitly deferred for W4-C3. The current legacy transcript encoding does not persist `tool_use_id` or full content arrays. A fresh adapter instance cannot reconstruct `tool_use_id` from stored `[tool_call:<toolName>]` messages, so real-provider tool-use correctness (fork/continue) belongs with structured transcript migration (Path B). W4-C3 proves the record → offline replay path only; that is sufficient to validate the cassette mechanism against real model output.

**Files touched:**
- `src/examples/realRunProof.ts` (new)
- `package.json` — added `example:real-proof` script

**Acceptance gate:** `npm run example:real-proof` with a real key prints `PASS`; trace on disk validates; replay produces correct result offline. `npm test -- --run` passes with no regressions and zero live calls.

---

### W4-C4: Safety checks and docs

**What:**
- Proof trace `traces/anthropic-proof-trace.json` is already git-ignored (the whole `traces/` directory is in `.gitignore`) — no new entry needed
- Secret-scan check: `git grep -rn "ANTHROPIC_API_KEY\s*=" src/` must return nothing
- Update `docs/08_build_log.md` with W4-C completion entry
- Annotate `src/agent/anthropicModelClient.ts` with a clear comment stating the fork-continuation limitation and why

**Files to touch:**
- `docs/08_build_log.md` — W4-C completion note

**Acceptance gate:** Codex scan finds no hardcoded key references; `npm test -- --run` still passes unchanged.

---

## Tests

### Mocked-client tests — default suite (no key required)

These tests run in `npm test -- --run`. They use an injected fake Anthropic client (matching the SDK's interface) to test translation and error handling without any network call.

| Test | What it proves |
|---|---|
| Missing key throws at instantiation (no injected client) | Fails fast before any call |
| Plain user message → correct Anthropic messages format | Request translation (happy path) |
| `[tool_call:search]` assistant + JSON result user → Anthropic tool_use/tool_result blocks | Legacy transcript → Anthropic format |
| Anthropic `tool_use` response block → `{ type: "tool_call", toolName, toolInput }` | Response translation |
| `tool_use_id` not present in returned `ModelOutput` | Provider-native field stripped |
| Anthropic `end_turn` text response → `{ type: "final_answer", text }` | Final answer translation |
| Unknown `stop_reason` → throws `ModelCallError` with `provider_malformed_response` | Error normalization |
| Anthropic SDK auth error → throws `ModelCallError` with `provider_auth_error` | Error sanitization |
| Anthropic SDK timeout error → throws `ModelCallError` with `provider_timeout` | Error sanitization |
| `ModelOutput` contains no `tool_use_id`, `usage`, `model`, `id` | Provider-native field stripping |

### Optional live tests (key-gated — skip without `ANTHROPIC_API_KEY`)

These are registered in `tests/anthropicModelClient.test.ts` under a guard:

```typescript
const RUN_LIVE = Boolean(process.env.ANTHROPIC_API_KEY);
describe.skipIf(!RUN_LIVE)("AnthropicModelClient — live integration", () => { ... });
```

| Test | What it proves |
|---|---|
| Full round-trip: call returns valid `ModelOutput` | Real API reachable and translates correctly |
| Tool-use round-trip: model returns tool call, then final answer | Tool-use path works end-to-end |
| Recorded trace passes `validateTrace` | Payload is JSON-safe and chain intact |
| Trace payload contains no `ANTHROPIC_API_KEY` substring | Key never stored |
| `replayTrace` of real trace returns `status: "success"` | Replay is offline |

---

## Open Questions

These must be resolved by reading `@anthropic-ai/sdk` TypeScript types after W4-C1 install, before writing W4-C2 adapter code:

1. **Non-streaming call signature.** Confirm `client.messages.create({ stream: false, ... })` or `client.messages.create({ ... })` (without stream field) returns a `Message` object from the promise. Check if `stream: false` is even a valid parameter or if non-streaming is the default.

2. **Tool-use block shape.** Confirm: `block.type === "tool_use"`, `block.name` (tool name), `block.input` (already a parsed `Record<string, unknown>`, not a JSON string), `block.id` (the `tool_use_id` to retain).

3. **SDK error hierarchy.** Check if `@anthropic-ai/sdk` exports named error classes (e.g., `APIError`, `AuthenticationError`) for classification into `ModelErrorKind` values without string-matching.

4. **Model name.** Confirm `claude-haiku-4-5-20251001` is a valid model ID for `messages.create`. Consider constructor parameter with default: `constructor(options?: { apiKey?: string; client?: Anthropic; model?: string })`.

5. **Tool-use continuation in multi-turn.** The current plan stores a single pending `tool_use_id` per adapter instance. If Anthropic can return multiple tool-use blocks in one response (parallel tool calls), the adapter must handle a list. Confirm whether the proof scenario (single tool call per turn) avoids this, or if the adapter must handle multiple from the start.

6. **`input_schema` required vs optional.** Confirm whether the Anthropic API rejects calls where any `tool` entry lacks `input_schema`, or whether it is optional. This determines whether the permissive fallback `{ type: "object" }` is sufficient.

---

## Recommended Implementation Order

1. **W4-C1** — install package, add `inputSchema` to `ToolDefinition`, skeleton + mocked tests, 182 tests still pass.
2. **Codex audit of W4-C1** — verify no regressions, mocked test pattern is sound.
3. **Resolve all open questions** — read SDK types; document answers inline in adapter before writing W4-C2 code.
4. **W4-C2** — full adapter, all mocked tests passing.
5. **Codex audit of W4-C2** — verify translation, error normalization, field stripping.
6. **W4-C3** — proof script, manual run with real key.
7. **W4-C4** — safety checks, gitignore, docs.
8. **Codex final audit** — key leakage scan, payload purity, replay isolation.
9. **Human decision** — promote, keep behind flag, or revert (per W4-E).

---

## What Not to Build in W4-C

- Fork continuation using `AnthropicModelClient` (deferred — requires structured transcript migration)
- A second provider adapter (OpenAI, Gemini, Cohere)
- Streaming responses
- Rate-limit retry logic
- CLI flag wiring (`--adapter anthropic`)
- Session or conversation management beyond a single run
- Token usage tracking or cost reporting
- System prompt injection from CLI flags
- Any UI component, web server, or hosted endpoint
- Structured transcript migration (Path B) — that is a separate decision, not part of W4-C
