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

## Adapter Boundary

### Provider-neutral `ModelClient` contract

The existing `ModelClient` interface in `src/agent/modelClient.ts` already defines the Blackbox-side contract. The adapter seam is that interface: any real provider must be wrapped in a class that satisfies `ModelClient`. The single method is `complete(messages, tools)`. No changes to `ModelClient` are required to support a real provider; only the implementation changes.

**Minimum input `ModelClient.complete()` receives:**

```
messages: TranscriptMessage[]   // full conversation history up to this call
tools: ToolDefinition[]         // available tools with name, description, and schema
```

**Provider-neutral transcript message shape (`TranscriptMessage`):**

All message content must be JSON-safe. No SDK-native object, class instance, or non-serializable value may appear.

```
// Initial user prompt or tool-result carrier
{ role: "user";      content: string }

// Model produced a final answer
{ role: "assistant"; content: { type: "final_answer"; text: string } }

// Model requested a tool call
{ role: "assistant"; content: { type: "tool_call"; toolName: string; toolInput: JsonObject } }

// Tool result returned to the model (always a user-role message)
{ role: "user";      content: { type: "tool_result"; toolName: string; result: JsonValue; error?: string } }
```

This shape is compatible with the current `agentLoop.ts` message construction and extensible for real providers. Provider-specific fields (e.g., Anthropic `tool_use_id`) must be added by the real adapter layer only — they must not appear in `TraceStep.payload` or in the provider-neutral transcript type.

**Minimum output `ModelClient.complete()` returns (`ModelOutput`):**

One of:

```
{ type: "final_answer", text: string }
```
The model has produced a concluding response. The agent loop terminates.

```
{ type: "tool_call", toolName: string, toolInput: Record<string, unknown> }
```
The model has requested a tool invocation. The agent loop executes the tool and continues.

The existing `ModelOutput` union type covers both cases. No new variants are needed for the first adapter spike. Provider-specific stop reasons (content filter, max tokens, stop sequence) must be caught inside the adapter and surfaced as thrown errors to the agent loop, not as new `ModelOutput` variants.

**How this maps to the fake adapter:**

`FakeDeterministicModelClient` plays back a scripted `ModelOutput[]` array in order. It satisfies `ModelClient.complete()`. Any real provider adapter is a drop-in replacement — the agent loop never distinguishes between a fake and a real adapter. This is the entire point of the interface.

---

## Trace and Cassette Invariants

These invariants must hold regardless of which adapter is in use.

1. **Recording** — `agentLoop` calls the adapter via `ModelClient.complete()`. The response is a `ModelOutput`. The output, along with the corresponding model input, is recorded in `TraceStep` entries by the `TraceRecorder`. The hash chain is computed over the recorded payloads, not over any provider-native object.

   **Important:** the current `agentLoop` implementation does not wrap `model.complete()` in a try/catch and does not record a terminal `metadata` step on model-call failure. If the adapter throws, the run aborts with no trace of the error in the cassette. **W4-B must add model-call error recording** before a real adapter is introduced. See Failure Modes and the W4-B scope below.

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

`agentLoop` calls `toolExecutor.definitions()` before each `model.complete()` call and calls `toolExecutor.execute(name, input)` after each `tool_call` response. The fixture tool list currently used inline in `agentLoop` must be wrapped in a `ToolExecutor` implementation in W4-B.

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

**Pre-condition:** the failure modes below that require a terminal `metadata` step on model-call error depend on `agentLoop` wrapping `model.complete()` in a try/catch. **This does not exist yet.** It is a required deliverable of W4-B. Without it, model-call errors abort the run without writing any terminal step, leaving the cassette in an incomplete state. All adapter error-handling below assumes W4-B has been completed first.

| Failure | Where caught | Representation in trace |
|---|---|---|
| Missing API key | Adapter constructor or proof script preamble | Throw before first call; no trace steps recorded; process exits with a clear error message |
| Provider authentication error (401/403) | Inside adapter `complete()` | Re-throw to `agentLoop`; `agentLoop` catch (W4-B) appends terminal `metadata`: `event: "run_failed"`, `reason: "provider_auth_error"` |
| Provider timeout | Inside adapter `complete()` | Re-throw to `agentLoop`; terminal `metadata`: `reason: "provider_timeout"` |
| Provider refusal (safety filter, content policy) | Inside adapter `complete()` | Treat unrecognized stop reason as error; re-throw; terminal `metadata`: `reason: "provider_refusal"` |
| Malformed tool call (missing name or input) | Inside adapter `complete()` | Re-throw to `agentLoop`; terminal `metadata`: `reason: "malformed_tool_call"` |
| Unsupported stop reason | Inside adapter `complete()` | Re-throw with raw stop reason in message; terminal `metadata`: `reason: "unsupported_stop_reason"` |
| Tool execution error | Inside `ToolExecutor.execute()` | Existing mechanism: recorded in `tool_result` payload; run may continue if model can recover |

Do not add new `TraceStepType` values for error cases. The `metadata` terminal step with a `reason` field is sufficient for the W4-C spike. Richer error representation is a future decision.

---

## Proposed W4-B / W4-C / W4-D / W4-E Sequence

### W4-B: Provider-neutral adapter boundary (code refactor, no new adapters)

- Verify `ModelClient` interface is complete and matches this contract; ensure the method signature is `complete(messages: TranscriptMessage[], tools: ToolDefinition[]): Promise<ModelOutput>`
- Extract `ToolDefinition` as an explicit JSON-safe type:
  ```
  { name: string; description: string; inputSchema: JsonObject }
  ```
- Extract `ToolExecutor` as an explicit interface with two responsibilities:
  ```
  interface ToolExecutor {
    definitions(): ToolDefinition[];                              // for passing to model each call
    execute(name: string, input: JsonValue): Promise<JsonValue>;  // for running tools
  }
  ```
  This separation is important: `definitions()` is called before each `model.complete()` call so the model knows what tools are available; `execute()` is called after each `tool_call` response.
- `agentLoop` accepts `ToolExecutor` as a parameter instead of importing fixture tools directly
- `defaultFixtureTools()` returns a `ToolExecutor` implementation
- Add model-call error recording: wrap `model.complete()` in a try/catch; on error, append a terminal `metadata` step with `event: "run_failed"` and `reason: "model_error"` before re-throwing; this is fake-testable with a `FakeDeterministicModelClient` that throws
- No behavior change for the non-error path; all 162 existing tests pass unchanged
- Codex audit after W4-B before proceeding

### W4-C: Optional Anthropic adapter behind env flag

- Add `src/agent/anthropicModelClient.ts` implementing `ModelClient`
- Non-streaming (`messages.create()` with `stream: false`)
- Reads `ANTHROPIC_API_KEY` from `process.env`; throws if absent
- Translates Anthropic response to `ModelOutput`
- `providerCallId` retained in memory only; not stored in trace
- Guarded tests in `tests/anthropicModelClient.test.ts`
- No changes to CLI default behavior; fake adapter remains the default

### W4-D: Cassette round-trip proof script

- `src/examples/realRunProof.ts` — requires `ANTHROPIC_API_KEY`
- Records one real multi-step run (one tool call, then final answer — keep it short)
- Saves to `traces/real-run-proof.json`
- Replays the saved trace offline; asserts zero provider calls
- Forks from the cassette with a tool-result mutation; replays child offline
- Runs `diffTraces` on parent and child; prints first divergence
- Validates all traces with `validateTrace`
- Prints `PASS` or `FAIL` with details; exits with appropriate code
- Not in `npm test`; run manually

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

3. **Tool support in real adapter.** The Anthropic adapter must support tool calls to exercise the full record → fork → diff loop. `final_answer`-only is not enough for the W4-D proof (the demo scenario uses search → booking tools). Decision: tool-use support is required in W4-C from the start.

4. **Real-provider demo entry point.** Should the real adapter be wirable via the CLI (`npm run cli -- record --adapter anthropic`) or only via the proof script? CLI wiring adds complexity and a new flag. Decision: proof script only for W4-D; CLI wiring is deferred.

5. **`.env` file loading.** Should the project add `dotenv` (or similar) so `ANTHROPIC_API_KEY` can be loaded from a local `.env` file automatically, or should users export the key in their shell? Decision: shell export is sufficient for the proof script; no new dependency needed for W4-C.
