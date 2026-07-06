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

### Provider-neutral `ModelAdapter` contract

The existing `ModelClient` interface in `src/agent/modelClient.ts` already defines the Blackbox-side contract. The adapter seam is that interface: any real provider must be wrapped in a class that satisfies `ModelClient`. No changes to `ModelClient` are required to support a real provider; only the implementation changes.

**Minimum input Blackbox passes to the adapter:**

```
messages: Message[]   // full conversation history up to this call
tools: ToolDef[]      // list of available tools with name and description
```

`Message` is the existing Blackbox message type: `{ role: "user" | "assistant", content: string | ToolCall | ToolResult }`.

**Minimum output Blackbox expects from the adapter:**

One of:

```
{ type: "final_answer", text: string }
```
The model has produced a concluding response. The agent loop terminates.

```
{ type: "tool_call", toolName: string, toolInput: Record<string, unknown> }
```
The model has requested a tool invocation. The agent loop executes the tool and continues.

The existing `ModelOutput` union type covers both cases. No new variants are needed for the first adapter spike. Provider-specific stop reasons (content filter, max tokens) should be surfaced as errors rather than new output variants, at least for W4-C.

**How this maps to the fake adapter:**

`FakeDeterministicModelClient` plays back a scripted `ModelOutput[]` array in order. It already satisfies `ModelClient`. Any real provider adapter is a drop-in replacement — the agent loop never distinguishes between a fake and a real adapter. This is the entire point of the interface.

---

## Trace and Cassette Invariants

These invariants must hold regardless of which adapter is in use.

1. **Recording** — `agentLoop` calls the adapter via `ModelClient.call()`. The response is a `ModelOutput`. The output, along with the corresponding model input, is recorded in `TraceStep` entries by the `TraceRecorder`. The hash chain is computed over the recorded payloads, not over any provider-native object.

2. **Replay** — `replayTrace(trace: Trace)` takes no `ModelClient` parameter. It cannot call a provider by construction. It reads `TraceStep.payload` entries and reconstructs a `ReplaySummary`. This invariant must not change.

3. **Fork prefix** — Steps in the copied prefix are taken verbatim from the parent cassette. Their `payload`, `hash`, and `prevHash` fields are not recomputed. The fork point (and any mutation step) is where the new adapter call first occurs.

4. **Fork continuation** — After the fork point, the agent loop calls the adapter for each new model turn. These new steps are recorded and hash-chained from the last prefix step. The child cassette is fully self-consistent.

5. **Payload serialization** — `TraceStep.payload` is typed as `JsonValue`. No SDK-native object, no class instance, no non-serializable field may be stored directly. The adapter is responsible for extracting the relevant fields and producing a plain `JsonObject`. Round-tripping through `JSON.parse(JSON.stringify(...))` must be lossless.

6. **No provider metadata in traces** — Provider-specific IDs (e.g., Anthropic `message.id`, `usage` token counts, `model` name) must not appear in `TraceStep.payload` unless explicitly added by a future design decision. Traces must be provider-agnostic. A trace recorded with a real adapter must be indistinguishable from one recorded with the fake adapter at the schema level.

---

## Tool-Use Mapping

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
- `.env` files must not be committed. Verify `.gitignore` includes `.env` and `*.env` before W4-C begins.
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

| Failure | Representation |
|---|---|
| Missing API key | Throw before first call; no trace steps recorded; process exits with a clear error message |
| Provider authentication error (401/403) | Catch in adapter; throw to `agentLoop`; caught as unknown tool error; terminal `metadata` step with `event: "run_failed"`, `reason: "provider_auth_error"` |
| Provider timeout | Catch in adapter; throw to `agentLoop`; terminal `metadata` step with `event: "run_failed"`, `reason: "provider_timeout"` |
| Provider refusal (safety filter, content policy) | Treat as a non-`tool_call`/non-`final_answer` stop reason; throw to `agentLoop`; terminal `metadata` step with `event: "run_failed"`, `reason: "provider_refusal"` |
| Malformed tool call (missing name or input) | Adapter throws before recording; terminal `metadata` step with `reason: "malformed_tool_call"` |
| Unsupported stop reason | Adapter throws with the raw stop reason in the message; terminal `metadata` step with `reason: "unsupported_stop_reason"` |
| Tool execution error | Existing mechanism: agent loop records the error in the `tool_result` payload; run may continue if the model can recover |

Do not add new `TraceStepType` values for error cases. The `metadata` terminal step with a `reason` field is sufficient for the W4-C spike. Richer error representation is a future decision.

---

## Proposed W4-B / W4-C / W4-D / W4-E Sequence

### W4-B: Provider-neutral adapter boundary (code refactor, no new adapters)

- Verify `ModelClient` interface is complete and matches this contract
- Extract `ToolExecutor` as an explicit interface: `{ call(name: string, input: JsonValue): Promise<JsonValue> }`
- `agentLoop` accepts `ToolExecutor` as a parameter instead of importing fixture tools directly
- `defaultFixtureTools()` returns something satisfying `ToolExecutor`
- No behavior change; all 162 existing tests pass unchanged
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
