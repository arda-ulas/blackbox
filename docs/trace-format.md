# Trace format

A cassette is one JSON file holding one run. It is plain data: you can read it, commit it, and diff it with any tool.

## Goal

Capture all non-deterministic inputs needed to replay an agent run offline without calling the model or executing tools again.

## Schema Version

`CURRENT_TRACE_VERSION` is **2**. Every saved trace carries `version: 2`.

- **v2 (current)** — tool rounds are recorded as structured, provider-neutral transcript parts (`MessagePart`, see below) carrying a deterministic `toolCallId`. The `model_output` (tool-call), `tool_call`, and `tool_result` step payloads all carry that same `toolCallId`.
- **v1 (unreadable)** — used the legacy `"[tool_call:<name>]"` / `JSON.stringify(result)` string encoding. `loadTrace` **rejects** v1 cassettes with a clear message: re-record the run. There is no v1 → v2 migration.

`toolCallId` is a Blackbox-generated correlation key (format `call-0`, `call-1`, …), a pure function of run-local position. It is **provider-neutral** — never a provider-native id such as Anthropic's `tool_use_id`. Provider-native ids, usage counts, message ids, and raw provider content arrays never enter any payload. Replay remains cassette-only regardless of version.

## Trace Object

| Field | Type | Notes |
|---|---|---|
| `version` | `number` | Cassette schema version — must equal `CURRENT_TRACE_VERSION`; `loadTrace` rejects absent or unsupported values |
| `id` | `string` | Unique run identifier |
| `parentId` | `string?` | Set when this trace was forked from another run |
| `forkedFromStepId` | `string?` | The parent step id the fork branched from |
| `createdAt` | `number` | Milliseconds since epoch when the trace was created |
| `steps` | `TraceStep[]` | Append-only ordered list of recorded steps |

## TraceStep Object

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `${traceId}:${index}` — stable, human-readable |
| `index` | `number` | Zero-based position within the trace |
| `type` | `TraceStepType` | See step types below |
| `timestamp` | `number` | Milliseconds since epoch when the step was recorded |
| `payload` | `JsonValue` | JSON-safe content for this step |
| `prevHash` | `string \| null` | Hash of the previous step; null for the first step |
| `hash` | `string` | SHA-256 of canonical step input fields (see below) |

## Step Types

| Type | When recorded | Payload shape |
|---|---|---|
| `model_input` | Before every call to the model client | `ModelInput` — `messages` (each `content` is a `string` or a `MessagePart[]`, see below), tool definitions, and optionally `systemPrompt`, `model`, and `params` (see below) |
| `model_output` | After the model client returns | One of three shapes — see "Model output shapes" below |
| `tool_call` | When the model requests a tool | `{ toolCallId: string, toolName: string, toolInput: JsonValue }` |
| `tool_result` | After the tool executes (success or error) | `{ toolCallId, toolName, result: JsonValue }` or `{ toolCallId, toolName, error: string }` |
| `metadata` | Terminal events and run-level markers | See terminal event payloads below |

### Model output shapes

| Shape | Written by | Payload |
|---|---|---|
| single tool call | the built-in agent loop | `{ type: "tool_call", toolCallId, toolName, toolInput }` |
| tool calls | recorded agents (SDK wrappers) and transcript importers | `{ type: "tool_calls", calls: [{ toolCallId, toolName, toolInput }, …], text? }` |
| final answer | everyone | `{ type: "final_answer", text }` |

`tool_calls` carries every call the model requested in one turn (parallel tool use), in the order the model emitted them, plus any `text` the model wrote alongside them. Recorders and importers always use `tool_calls`, even for a single call; the built-in loop keeps the single-call shape so existing cassettes and their hashes are unchanged. Readers go through `toolCallsOf()` (`src/trace/payloads.ts`), which accepts both.

After a `tool_calls` turn, each call's `tool_call` and `tool_result` steps follow in call order (`tool_call`, `tool_result`, `tool_call`, `tool_result`, …) regardless of the order the tools actually finished in. A recorded agent whose tools are not wrapped has no `tool_call`/`tool_result` steps; its tool results are visible only in the next `model_input`'s messages.

### Optional `model_input` fields (recorded agents)

| Field | Meaning |
|---|---|
| `systemPrompt` | The system prompt. For OpenAI, the leading `system`/`developer` messages joined in order. |
| `model` | The model name the request asked for. |
| `params` | Request controls that change behavior, in neutral names: `maxTokens`, `temperature`, `topP`, `toolChoice`, `responseFormat`, `stop`. Only those present in the request are recorded. |

A recorded `tool_result` part in `messages` keeps the content exactly as the agent sent it to the provider (a string stays a string).

The `toolCallId` is identical across the `model_output` (tool-call), `tool_call`, and `tool_result` steps of one tool round — that shared id is the whole correlation mechanism; nothing provider-native is stored.

## Structured Transcript (`MessagePart`)

`Message.content` is `string | MessagePart[]`. Plain text turns stay a `string`; a tool round is recorded as structured parts so tool-call correlation lives in cassette data (not adapter memory). The `MessagePart` union (`src/agent/modelClient.ts`):

| Variant | Shape |
|---|---|
| text | `{ type: "text", text: string }` |
| tool_use | `{ type: "tool_use", toolCallId, toolName, toolInput: JsonValue }` |
| tool_result (success) | `{ type: "tool_result", toolCallId, toolName, result: JsonValue }` |
| tool_result (error) | `{ type: "tool_result", toolCallId, toolName, error: string }` |

A tool round from the built-in loop appears in the following `model_input`'s `messages` as an assistant turn `content: [{ type: "tool_use", toolCallId, toolName, toolInput }]` followed by a user turn `content: [{ type: "tool_result", toolCallId, toolName, result }]` (or the `error` variant). The `toolCallId` in the `tool_use` part equals the one in its paired `tool_result` part — a fresh adapter can rebuild a correlated provider request from the cassette alone. A parallel round is one assistant turn holding every `tool_use` part (preceded by a `text` part when the model narrated), then one user turn holding every `tool_result` part, in call order.

## Terminal Metadata Payloads

**Successful completion**

```json
{
  "event": "run_completed",
  "status": "success",
  "result": "<final answer text>"
}
```

**Max steps exceeded**

```json
{
  "event": "run_failed",
  "status": "error",
  "reason": "max_steps_exceeded",
  "maxSteps": <number>
}
```

**Unknown tool name**

```json
{
  "event": "run_failed",
  "status": "error",
  "reason": "unknown_tool",
  "toolName": "<name>"
}
```

## Hash Input

The `hash` field of each step is a SHA-256 of the canonical JSON serialization of exactly these fields:

| Field | Included |
|---|---|
| `index` | Yes |
| `type` | Yes |
| `timestamp` | Yes |
| `payload` | Yes |
| `prevHash` | Yes |
| `id` | **No** — excluded so hash is reproducible without knowing the run id |
| `hash` | **No** — excluded to avoid circularity |

Canonical serialization: object keys sorted lexicographically, recursively. Array order preserved. No whitespace.

## Timestamp Policy

Timestamps are **included in the hash**. This means:

- Two traces recording the same logical events at different wall-clock times will produce different step hashes.
- Cassette replay must use the **stored** timestamps from the recorded trace, not `Date.now()`.
- The fork implementation must **copy** parent prefix steps verbatim (preserving original timestamps and hashes) up to the fork point — it must not re-record those steps, which would produce new timestamps and break hash equality.

## Fork Policy

### Forking a recorded agent (`blackbox fork <cassette> --at N ... -- <command>`)

The fork point `N` must be a `tool_result` step. The child cassette holds:

1. steps `0 … N-1` copied verbatim from the parent (same timestamps, same hashes), after your agent has
   re-run them and every request matched the recording;
2. at `N`, a `tool_result` with the same `toolCallId` and `toolName`, your replacement `result`, and the
   parent's timestamp;
3. after that, whatever the run did next: newly recorded model calls (live or scripted) and tool steps.

`diff` therefore reports the first divergence at exactly `N`, and `parentId` / `forkedFromStepId` point back at
the parent run and step.

### Built-in demo fork (`blackbox fork` without a command)

The built-in demo agent's fork (and the `forkRun` library function) follows these rules.

A forked child trace always satisfies:

1. `parentId` is set to the parent's `id`.
2. `forkedFromStepId` is set to the id of the parent step at `forkIndex`.
3. The first divergent step's `prevHash` equals the hash of the last shared step (verifiable via the hash chain).

The precise extent of the shared prefix depends on whether tool-result mutations are applied:

- **No mutations** — steps at index < `forkIndex` are copied verbatim from the parent. Their hashes are canonical-hash-identical to the parent. Divergence begins at `forkIndex`.
- **With mutations** — steps before the earliest mutation index are copied verbatim (hash-identical). Steps from the earliest mutation index up to (but not including) `forkIndex` are re-appended with the mutated payload; these steps receive new hashes even though they carry original timestamps. Divergence begins at the earliest mutation index, which is strictly less than `forkIndex`.

### Structured reconstruction (v2)

`forkRun` reconstructs the continued run's message history as structured `MessagePart[]`:

- A mutated `tool_result` step **preserves the original `toolCallId` and `toolName`**, replacing only the `result` value. Correlation survives mutation.
- The continued run **seeds its next `toolCallId`** past the ids already present in the copied prefix (derived from the prefix's `call-N` ids), so newly generated tool calls never reuse `call-0` and collide with the prefix.

## Fork-Point Semantics by Step Type

The fork index may point to any step in the parent trace **except a `metadata` step**. The prefix copied into the child is always `steps[0, forkIndex)`.

| Fork-point step type | Prefix content | Child continuation |
|---|---|---|
| `model_input` | All steps before the model call | Agent loop starts from the mutated prompt — the most natural fork point |
| `model_output` | Includes the preceding `model_input` | Agent loop starts fresh; first new child step is a new `model_input` at `forkIndex` |
| `tool_call` | Includes the `model_input` and its `model_output` | Agent loop starts fresh with the prefix ending before tool execution |
| `tool_result` | Includes the tool round up to its `tool_call` (the result itself is at `forkIndex` and is not copied) | Agent loop starts fresh; use `toolResultMutations` on an earlier `tool_result` to inject a different value |
| `metadata` | **Not allowed** | `metadata` steps are terminal run markers; forking there has no meaningful continuation and is rejected |

### Tool-result mutation constraint

When `toolResultMutations` are provided, an additional constraint applies: no `model_input` step may exist between the earliest mutation index and `forkIndex`. Such a step would carry stale pre-mutation message history in its recorded payload, making the prefix internally inconsistent. `forkRun` rejects this case with a clear error.

## What `verify` checks for provider neutrality

A cassette must not contain provider-native objects or credentials. `verify` applies two levels of strictness:

- **Structure** (ids, types, keys, metadata): no provider ids (`toolu_…`, `msg_…`, `call_…`, `chatcmpl-…`,
  `resp_…`), no provider response keys (`usage`, `stop_reason`, `finish_reason`, `system_fingerprint`, …), and
  no API keys or key environment-variable names.
- **Your data** (`toolInput`, `result`, `error`, `inputSchema`, message `text`/`content`, `systemPrompt`): only
  realistic credentials are flagged (`sk-ant-…`, `sk-proj-…`, bearer tokens). Tool inputs and results are
  whatever your tools produced; a coding agent that reads source code mentioning `toolu_` or a tool that
  returns `{ "usage": 42 }` is not a leak.

Recording additionally refuses to write a cassette containing the literal API key it saw in the environment or
in the intercepted request headers.
