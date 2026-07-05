# Trace Schema

## Goal

Capture all non-deterministic inputs needed to replay an agent run offline without calling the model or executing tools again.

## Trace Object

| Field | Type | Notes |
|---|---|---|
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

A forked trace shares a canonical-hash-identical prefix with its parent up to the fork point. This invariant is satisfied if and only if:

1. The child trace copies the parent's actual `TraceStep` objects for all steps before the fork point (index < fork point).
2. The child sets `parentId` to the parent's `id` and `forkedFromStepId` to the id of the step at the fork point.
3. From the fork point onward, the child records new steps (with new timestamps and new hashes).

The `prevHash` chain ensures the boundary is verifiable: the first child-only step's `prevHash` must equal the parent's step hash at index `fork_point - 1`.
