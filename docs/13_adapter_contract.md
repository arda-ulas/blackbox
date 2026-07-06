# Real Adapter Contract

## Goal

Add a real-agent adapter boundary to Blackbox without weakening the cassette model. The core invariant stays identical: **replay reads cassette payloads only — it never calls a model provider or executes a tool**. This constraint is already structurally enforced; all adapter work must preserve it.

Real providers may be called during:
- `record` — initial run that produces a parent cassette
- `continue` / fork child run — new agent steps generated after the fork point

Real providers must never be called during:
- `replayTrace` — cassette-only playback
- `validateTrace` — hash-chain verification
- `diffTraces` / `formatFirstDivergence` — post-hoc analysis
- any operation that only reads an existing trace

---

## Non-Goals for W4-A

- No code changes in this phase — this document is the only deliverable
- No web UI, dashboard, or graph view
- No hosted backend, remote cassette storage, or sharing
- No LangChain, LlamaIndex, MCP, or agent framework integration
- No generic observability platform or OTEL export
- No broad multi-provider abstraction layer (one concrete adapter is the target)
- No secrets, API keys, or credentials committed to the repo
- No real-provider calls in the default test suite

---

## Structured Transcript Migration — Status (W4-D, implemented)

**Path B (structured transcript) is implemented for the fake/local v2 core.** The transcript encoding no longer blocks reconstruction:

- `agentLoop` emits structured `MessagePart[]` tool rounds; `Message.content` is `string | MessagePart[]`; every tool round carries a deterministic, provider-neutral `toolCallId` in the transcript and in the `tool_call`/`tool_result` step payloads (schema v2 — see `docs/03_trace_schema.md`).
- `forkRun` reconstructs structured `MessagePart[]` histories, preserves `toolCallId` through tool-result mutation, and seeds continued-run ids so `call-0` is never reused.
- `AnthropicModelClient.translateMessages` consumes structured parts (`text` → text block; `tool_use` → tool_use block with `id = toolCallId`; `tool_result` → tool_result block with `tool_use_id = toolCallId`, `is_error: true` on the error variant). **Verified with a mocked client only.**
- A **fresh** adapter instance translates a cassette-derived multi-turn structured history into a self-consistent request **with no `#pendingToolCalls` state**. The legacy `[tool_call:<name>]` / pending path is retained only as a **narrow fallback for pre-v2 plain-string content**; the structured path never consults it.

**Still deferred to W4-E (NOT proven here):** that a live Anthropic API **accepts a synthetic Blackbox `toolCallId` as a provider `tool_use.id`**, and any real-provider tool-use / fork-continuation run. W4-D proves neutral reconstruction against a mocked client only; live acceptance must be established with Context7 + installed types + a live proof before it is claimed.

The historical encoding tables below are retained for context; the "legacy" shape is now superseded by the structured `MessagePart[]` model above.

---

## Adapter Boundary

### Provider-neutral `ModelClient` contract

The existing `ModelClient` interface in `src/agent/modelClient.ts` already defines the Blackbox-side contract. The single method is:

```typescript
complete(input: ModelInput): Promise<ModelOutput>
```

Any real provider adapter must be a class that implements `ModelClient`. The method signature must not change; the adapter seam is the implementation, not the interface shape. `ModelInput` is a single JSON-safe input object; if W4-B needs to extend it, new optional fields are added to `ModelInput` rather than adding positional arguments.

**Current `ModelInput` shape (already in `src/agent/modelClient.ts`):**

```typescript
interface ModelInput {
  systemPrompt?: string;
  messages:      Message[];      // conversation history
  tools?:        ToolDefinition[]; // available tools
}
```

**Current `Message` shape:**

```typescript
interface Message {
  role:    "user" | "assistant";
  content: string;               // JSON-encoded for tool calls/results
}
```

The current `Message.content` is always a `string`. For the fake adapter this is sufficient; scripted responses do not inspect message content at all. For a real adapter, the content encoding must be precisely defined so the adapter can translate it into provider-native API calls.

**Current / legacy transcript encoding (what `agentLoop.ts` produces today):**

| Turn | Role | `content` value |
|---|---|---|
| Initial prompt | `user` | plain string — the user's prompt |
| Model tool call | `assistant` | `"[tool_call:<toolName>]"` — label string only; `toolInput` is **not** included in the transcript message |
| Tool result | `user` | `JSON.stringify(toolResult)` — the raw result value only; no `toolName` or error wrapper |

This is the encoding currently stored in `TraceStep.payload` for `model_input` steps. It is sufficient for `FakeDeterministicModelClient` because the fake adapter ignores message content entirely. It is **not** sufficient for a real provider adapter, which needs `toolInput` to reconstruct the conversation and `toolName` to correlate results to calls.

**Preferred future structured encoding (target for W4-B or W4-C):**

The following encoding is provider-neutral and carries all information a real adapter needs:

| Turn | Role | `content` value |
|---|---|---|
| Initial prompt | `user` | plain string |
| Model tool call | `assistant` | `JSON.stringify({ toolName, toolInput })` |
| Tool result | `user` | `JSON.stringify({ toolName, result, error? })` |

Provider-specific fields (e.g., Anthropic `tool_use_id`) must be added inside the real adapter layer only — they must not appear in `ModelInput.messages`, `Message.content`, or `TraceStep.payload`.

**W4-B implementation paths for transcript encoding:**

W4-B has two acceptable approaches. Pick one explicitly before implementation begins:

- **Path A (smaller scope — recommended for W4-B):** Preserve the current `[tool_call:<toolName>]` / raw-result encoding. Add `ToolExecutor` boundary and model-call error recording only. Migrate to structured encoding in a separate step (W4-C or between W4-B and W4-C), with explicit tests updating `model_input` payload expectations. No existing test payloads change in W4-B.

- **Path B (migrate in W4-B):** Change `agentLoop.ts` to emit the structured encoding in W4-B itself. All tests that assert `model_input` step payloads must be updated. This is a larger diff but gets the cleaner encoding in place before the real adapter is written.

**Recommendation: Path A.** Migrate encoding only when necessary — i.e., when W4-C requires it to construct provider API calls correctly. Keep W4-B to the ToolExecutor refactor and model-call error recording.

**Current `ToolDefinition` shape (already in `src/agent/modelClient.ts`):**

```typescript
interface ToolDefinition {
  name:        string;
  description: string;
}
```

`inputSchema?: JsonObject` was added to `ToolDefinition` in W4-C1 for provider schema conversion (additive, backward-compatible). The Anthropic adapter uses `{ type: "object", ...(def.inputSchema ?? {}) }` as the `input_schema` fallback when `inputSchema` is absent.

**`ModelOutput` (already in `src/agent/modelClient.ts`):**

```typescript
type ModelOutput =
  | { type: "tool_call";    toolName: string; toolInput: JsonValue }
  | { type: "final_answer"; text: string };
```

No new variants are needed for the first adapter spike. Provider-specific stop reasons (content filter, max tokens, stop sequence) must be caught inside the adapter and surfaced as thrown errors to `agentLoop`, not as new `ModelOutput` variants.

**How this maps to the fake adapter:**

`FakeDeterministicModelClient` plays back a scripted `ModelOutput[]` array in order. It already satisfies `ModelClient`. Any real provider adapter is a drop-in replacement — `agentLoop` never distinguishes between fake and real. This is the entire point of the interface.

---

## Trace and Cassette Invariants

These invariants must hold regardless of which adapter is in use.

1. **Recording** — `agentLoop` calls `model.complete(input)` where `input` is a `ModelInput`. The response is a `ModelOutput`. The output, along with the corresponding model input, is recorded in `TraceStep` entries by the `TraceRecorder`. The hash chain is computed over the recorded payloads, not over any provider-native object.

   **W4-B completed:** `agentLoop` wraps `model.complete(input)` in a try/catch. On failure it records a terminal `metadata` step (see Failure Modes) and re-throws. Model-call failures are now traceable in the cassette.

2. **Replay** — `replayTrace(trace: Trace)` takes no `ModelClient` parameter. It cannot call a provider by construction. It reads `TraceStep.payload` entries and reconstructs a `ReplaySummary`. This invariant must not change.

3. **Fork prefix** — Steps in the copied prefix are taken verbatim from the parent cassette. Their `payload`, `hash`, and `prevHash` fields are not recomputed. The fork point (and any mutation step) is where the new adapter call first occurs.

4. **Fork continuation** — After the fork point, the agent loop calls the adapter for each new model turn. These new steps are recorded and hash-chained from the last prefix step. The child cassette is fully self-consistent.

5. **Payload serialization** — `TraceStep.payload` is typed as `JsonValue`. No SDK-native object, no class instance, no non-serializable field may be stored directly. The adapter is responsible for extracting the relevant fields and producing a plain `JsonObject`. Round-tripping through `JSON.parse(JSON.stringify(...))` must be lossless.

6. **No provider metadata in traces** — Provider-specific IDs (e.g., Anthropic `message.id`, `usage` token counts, `model` name) must not appear in `TraceStep.payload` unless explicitly added by a future design decision. Traces must be provider-agnostic. A trace recorded with a real adapter must be indistinguishable from one recorded with the fake adapter at the schema level.

---

## Tool-Use Mapping

### `ToolDefinition` — provider-neutral tool schema

Tool definitions are passed to the model on every `complete()` call so it knows what tools are available. They must be JSON-safe and provider-neutral. The real adapter is responsible for converting `ToolDefinition` into whatever schema the provider requires (e.g., Anthropic `input_schema`, OpenAI `parameters`). That conversion happens inside the adapter and does not touch `TraceStep.payload`.

```
{
  name:        string,      // e.g. "search"
  description: string,      // human-readable purpose
  inputSchema: JsonObject   // JSON Schema describing tool inputs (provider-agnostic)
}
```

### `ToolExecutor` — provider-neutral execution boundary

```
interface ToolExecutor {
  definitions(): ToolDefinition[];
  execute(name: string, input: JsonValue): Promise<JsonValue>;
}
```

`agentLoop` calls `toolExecutor.definitions()` once per run to snapshot the available tool list, then passes it in every `model.complete()` call. It calls `toolExecutor.execute(name, input)` after each `tool_call` response. For the current static fixture tools, snapshotting once per run is equivalent to calling before each model call; a future dynamic executor (tools added/removed mid-run) could call `definitions()` before each `model.complete()` instead.

**W4-B slice 1 implementation note:** `defaultFixtureTools()` returns a `FixtureTool[]` (raw deterministic fixture tools). `defaultToolExecutor()` wraps that array in a `FixtureToolExecutor` and returns the provider-neutral `ToolExecutor`. `agentLoop` and `forkRun` now accept `toolExecutor: ToolExecutor` and no longer import from `fixtureTools.ts` directly.

### Provider-neutral tool call shape (Blackbox internal)

```
{
  toolName: string,
  toolInput: Record<string, unknown>
}
```

### Provider-neutral tool result shape (Blackbox internal)

```
{
  toolName: string,
  result: JsonValue,      // success case
  error?: string          // if tool execution failed
}
```

An optional `providerCallId` field may be added to both shapes if the provider requires it for matching tool results to tool calls. This is implementation-specific and should not appear in `TraceStep.payload` directly; it is only used during the live call/response cycle.

### Anthropic candidate mapping (non-streaming)

When `message.stop_reason === "tool_use"`:
- Locate content blocks with `type === "tool_use"`
- Extract `block.name` → `toolName`
- Extract `block.input` → `toolInput` (already a plain object)
- Retain `block.id` as `providerCallId` in memory (needed when sending `tool_result` back)

When sending tool results back to Anthropic:
- Add a `tool_result` content block in the next user message
- Set `tool_use_id` to the retained `block.id`
- Set `content` to the JSON-serialized tool output

When `message.stop_reason === "end_turn"` and content is non-empty text:
- Treat as `{ type: "final_answer", text: message.content[0].text }`

When `message.stop_reason` is `"max_tokens"`, `"stop_sequence"`, or an unrecognized value:
- Treat as an error; surface via the failure path (see Failure Modes below)

**What to store in `TraceStep.payload`** for a `model_output` step:

```json
{
  "type": "tool_call",
  "toolName": "<name>",
  "toolInput": { ... }
}
```

The `block.id` / `providerCallId` is **not** stored in the payload. It is only needed in-memory during the current call cycle. Replay reconstructs the conversation from stored payloads, not from provider-native IDs.

---

## Credential Policy

- API keys come from environment variables only — never from source code, config files committed to the repo, or command-line arguments.
- For the Anthropic candidate adapter: read `process.env.ANTHROPIC_API_KEY`. If absent when the adapter is instantiated in a live context, throw a clear error immediately rather than failing silently at call time.
- No key, token, or credential may appear in `TraceStep.payload`, trace metadata, log output, or any file written to disk.
- `.env` files must not be committed. `.gitignore` now includes `.env` and `*.env` (added in the W4-A audit patch).
- The proof script (`realRunProof.ts`) must print a clear "ANTHROPIC_API_KEY not set" error and exit 1 if the key is absent, before making any network call.

---

## Test Policy

- `npm test -- --run` must pass with zero real provider calls. The default test suite is fake/deterministic and always will be.
- Any test that instantiates a real provider adapter must be guarded by an environment check at the top of the test (e.g., `if (!process.env.ANTHROPIC_API_KEY) { it.skip(...) }`). Skipped tests must not fail.
- CI must not require a real API key. All CI-required tests must pass with the key absent.
- Replay tests must structurally prove no provider calls occur — the cleanest proof is that `replayTrace` takes no `ModelClient` parameter (already true; verify this remains true after W4-B).
- The proof script (`realRunProof.ts`) is not in `npm test`. It is invoked manually.

---

## Failure Modes

Each failure mode must be representable in the trace without adding new step types or breaking the existing schema. The `metadata` step with `event: "run_failed"` is the existing mechanism.

**Status: completed in W4-B slice 2.** `agentLoop` wraps `model.complete(input)` in a try/catch. On error it appends the terminal `metadata` step shown below, then re-throws. 181 tests passed at W4-B slice 2 acceptance; 216 tests pass after W4-C1 and W4-C2.

**Stable terminal metadata shape for model-call failures (W4-B deliverable):**

All model-call errors — regardless of provider — collapse into the same outer `reason: "model_error"` field on the terminal `metadata` step. Provider-specific error detail goes into a nested `errorKind` field. This keeps the schema stable even if the set of provider errors grows.

```json
{
  "event":     "run_failed",
  "status":    "error",
  "reason":    "model_error",
  "errorKind": "provider_auth_error | provider_timeout | provider_refusal | provider_malformed_response | unknown",
  "message":   "<human-readable description, no raw SDK error objects>"
}
```

The raw SDK error object, stack trace, and any provider-native error code must not appear in `TraceStep.payload`. Extract only the `errorKind` and a plain string message inside the adapter before re-throwing to `agentLoop`.

| Failure | Where caught | `errorKind` value |
|---|---|---|
| Missing API key | Adapter constructor or proof script preamble | Not recorded — throw before any call; process exits with a clear message |
| Provider authentication error (401/403) | Inside adapter `complete()` | `"provider_auth_error"` |
| Provider timeout | Inside adapter `complete()` | `"provider_timeout"` |
| Provider refusal (safety filter, content policy) | Inside adapter `complete()` | `"provider_refusal"` |
| Malformed / unrecognized response | Inside adapter `complete()` | `"provider_malformed_response"` |
| Unsupported stop reason | Inside adapter `complete()` | `"provider_malformed_response"` |
| Unexpected / uncategorized error | `agentLoop` catch (fallback) | `"unknown"` |
| Tool execution error | Inside `ToolExecutor.execute()` | Not a model error — existing mechanism: recorded in `tool_result` payload; run may continue |

Do not add new `TraceStepType` values for error cases. The `metadata` terminal step with `reason: "model_error"` and `errorKind` is sufficient for the W4-C spike. Richer error representation is a future decision.

**W4-B completed.** Model-call error recording is tested with inline throwing `ModelClient` implementations. No real SDK is used.

---

## Proposed W4-B / W4-C / W4-D / W4-E Sequence

### W4-B: Provider-neutral adapter boundary + model-call error hardening

W4-B is a refactor plus a targeted behavior addition. The non-error path is unchanged; the new behavior is model-call error recording.

**Refactor (no behavior change to the non-error path):**

- Verify `ModelClient` method signature matches current code: `complete(input: ModelInput): Promise<ModelOutput>`. Do not change this signature.
- Added `inputSchema?: JsonObject` to `ToolDefinition` in W4-C1 (additive, backward-compatible).
- Extract `ToolExecutor` as an explicit interface (now in `src/agent/modelClient.ts`):
  ```typescript
  interface ToolExecutor {
    definitions(): ToolDefinition[];                              // snapshot tool list; passed into every model.complete()
    execute(name: string, input: JsonValue): Promise<JsonValue>;  // called after each tool_call response
  }
  ```
- `agentLoop` accepts `toolExecutor: ToolExecutor` as a parameter instead of importing fixture tools directly.
- `defaultFixtureTools()` returns a raw `FixtureTool[]`; `defaultToolExecutor()` wraps it and returns the `ToolExecutor`.
- **Completed in W4-B slice 1.** 174 tests pass (12 new ToolExecutor tests added).

**Behavior addition (model-call error recording):**

- Wrap `model.complete(input)` in a try/catch inside `agentLoop`.
- On error, classify the error as `errorKind` (see Failure Modes section), append a terminal `metadata` step with the stable payload shape defined above, then re-throw so callers know the run failed.
- **Test with a fake throwing `ModelClient`**, not a real SDK. `FakeDeterministicModelClient` that throws on call N is sufficient.
- New tests must prove the terminal `metadata` step is present after a model-call error.

**Codex audit after W4-B before proceeding to W4-C. ✓ W4-B accepted.**

### W4-C: Optional Anthropic adapter behind env flag

- Add `src/agent/anthropicModelClient.ts` implementing `ModelClient`
- Non-streaming (`messages.create()` — omit `stream`; SDK non-streaming overload is the default)
- Reads `ANTHROPIC_API_KEY` from `process.env`; throws if absent
- Translates Anthropic response to `ModelOutput`
- `providerCallId` retained in memory only; not stored in trace
- Guarded tests in `tests/anthropicModelClient.test.ts`
- No changes to CLI default behavior; fake adapter remains the default

**Error sanitization requirement for W4-C adapters:** inside `complete()`, catch all SDK/provider-native errors and normalize them into a `ModelCallError` (from `src/agent/modelClient.ts`) before re-throwing. The `errorKind` field carries the semantic classification (see failure modes table above). Raw SDK error objects, stack traces, and provider-native codes must never reach `agentLoop` or appear in `TraceStep.payload`. This normalization is the adapter's responsibility — `agentLoop` only distinguishes `ModelCallError` from generic `Error` to set `errorKind`; it never inspects provider-specific fields.

### W4-D: Cassette round-trip proof script

**Implemented as W4-C3.** `src/examples/realRunProof.ts` — explicit opt-in, run with `npm run example:real-proof`.

- Requires `ANTHROPIC_API_KEY`; exits 1 with clear message if absent — no trace written
- Records one real run using a **final-text-only prompt** (no tool calls); saves to `traces/anthropic-proof-trace.json`
- Replays the saved trace fully offline via `loadTrace` + `replayTrace`; no provider calls during replay
- Validates hash chain with `validateTrace`; prints `PASS` or `FAIL`; exits with appropriate code
- Not in `npm test`

**Tool-use proof deferred:** The legacy transcript encoding does not persist `tool_use_id` or full content arrays. Real-provider fork/tool-use correctness requires structured transcript migration (Path B). W4-C3 proves record → offline replay only.

### W4-E: Codex audit and decision

- Codex reviews adapter boundary, real adapter implementation, and proof script
- Human decides: keep behind env flag / promote / revert
- Outcome documented in `docs/08_build_log.md`
- Tag `week-four-real-adapter` if accepted

---

## Open Decisions

These questions are deferred until W4-C begins. They should not block W4-B.

1. **Anthropic model name.** Which model to use in `AnthropicModelClient`? Options include `claude-haiku-4-5-20251001` (cheapest, fastest for a proof script), `claude-sonnet-4-6` (same as the project assistant), or a configurable env var. Decision: defer to W4-C; default to a fast/cheap model for the proof script.

2. **Streaming.** The non-streaming path is sufficient for the W4-C spike. Streaming may be needed for long runs or for future real-time output display. Decision: non-streaming first; streaming is a separate feature if needed.

3. **Tool support in real adapter.** W4-C3 uses a final-text-only proof (no tool calls). Tool-use proof is explicitly deferred: the legacy transcript encoding cannot persist `tool_use_id`, so real-provider tool-use correctness belongs with structured transcript migration (Path B). Decision: W4-C3 proves record → offline replay with final-text-only; tool-use proof is out of scope for W4-C.

4. **Real-provider demo entry point.** Should the real adapter be wirable via the CLI (`npm run cli -- record --adapter anthropic`) or only via the proof script? CLI wiring adds complexity and a new flag. Decision: proof script only for W4-D; CLI wiring is deferred.

5. **`.env` file loading.** Should the project add `dotenv` (or similar) so `ANTHROPIC_API_KEY` can be loaded from a local `.env` file automatically, or should users export the key in their shell? Decision: shell export is sufficient for the proof script; no new dependency needed for W4-C.
