# Trace Schema

## Goal

Capture all non-deterministic inputs needed to replay an agent run offline without calling the model or executing tools again.

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
| `model_input` | Before every call to the model client | `ModelInput` — messages and tool definitions |
| `model_output` | After the model client returns | `ModelOutput` — either `{ type: "tool_call", toolName, toolInput }` or `{ type: "final_answer", text }` |
| `tool_call` | When the model requests a tool | `{ toolName: string, toolInput: JsonValue }` |
| `tool_result` | After the tool executes (success or error) | `{ toolName, result: JsonValue }` or `{ toolName, error: string }` |
| `metadata` | Terminal events and run-level markers | See terminal event payloads below |

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

A forked child trace always satisfies:

1. `parentId` is set to the parent's `id`.
2. `forkedFromStepId` is set to the id of the parent step at `forkIndex`.
3. The first divergent step's `prevHash` equals the hash of the last shared step (verifiable via the hash chain).

The precise extent of the shared prefix depends on whether tool-result mutations are applied:

- **No mutations** — steps at index < `forkIndex` are copied verbatim from the parent. Their hashes are canonical-hash-identical to the parent. Divergence begins at `forkIndex`.
- **With mutations** — steps before the earliest mutation index are copied verbatim (hash-identical). Steps from the earliest mutation index up to (but not including) `forkIndex` are re-appended with the mutated payload; these steps receive new hashes even though they carry original timestamps. Divergence begins at the earliest mutation index, which is strictly less than `forkIndex`.

## Fork-Point Semantics by Step Type

The fork index may point to any step in the parent trace **except a `metadata` step**. The prefix copied into the child is always `steps[0, forkIndex)`.

| Fork-point step type | Prefix content | Child continuation |
|---|---|---|
| `model_input` | All steps before the model call | Agent loop starts from the mutated prompt — the most natural fork point |
| `model_output` | Includes the preceding `model_input` | Agent loop starts fresh; first new child step is a new `model_input` at `forkIndex` |
| `tool_call` | Includes the `model_input` and its `model_output` | Agent loop starts fresh with the prefix ending before tool execution |
| `tool_result` | Includes the full tool round up to and including the result | Agent loop starts fresh; use `toolResultMutations` to inject a different result value |
| `metadata` | **Not allowed** | `metadata` steps are terminal run markers; forking there has no meaningful continuation and is rejected |

### Tool-result mutation constraint

When `toolResultMutations` are provided, an additional constraint applies: no `model_input` step may exist between the earliest mutation index and `forkIndex`. Such a step would carry stale pre-mutation message history in its recorded payload, making the prefix internally inconsistent. `forkRun` rejects this case with a clear error.
