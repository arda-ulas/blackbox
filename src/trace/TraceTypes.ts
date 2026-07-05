// Core trace data model for Blackbox.
//
// A Trace is an append-only sequence of TraceSteps. Each step is chained to the
// previous one by hash (prevHash -> hash), which lets us verify that two traces
// share an identical prefix before a fork point.

// ---------------------------------------------------------------------------
// JSON-safe value types
//
// Payloads must be serializable to canonical JSON so they can be hashed and
// replayed deterministically. These types make "JSON-safe" explicit.
// ---------------------------------------------------------------------------

export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

// ---------------------------------------------------------------------------
// Step types
//
// The kinds of events we record in a single agent run. Named for the later
// record -> replay -> fork -> mutate -> continue -> diff loop.
// ---------------------------------------------------------------------------

export type TraceStepType =
  | "model_input" // prompt / request sent to the model client
  | "model_output" // response returned by the model client
  | "tool_call" // agent's request to invoke a fixture tool
  | "tool_result" // result returned by a fixture tool
  | "metadata"; // run-level notes, state snapshots, markers

// ---------------------------------------------------------------------------
// Trace step
// ---------------------------------------------------------------------------

export interface TraceStep {
  /** Stable identifier for this step, e.g. `${traceId}:${index}`. */
  id: string;
  /** Zero-based position within the trace. */
  index: number;
  type: TraceStepType;
  /** Milliseconds since epoch when the step was recorded. */
  timestamp: number;
  /** JSON-safe payload for this step. */
  payload: JsonValue;
  /** Hash of the previous step, or null for the first step. */
  prevHash: string | null;
  /** Canonical hash of this step's input fields (never includes itself). */
  hash: string;
}

/**
 * The canonical fields hashed to produce a step's `hash`.
 *
 * Deliberately excludes `id` and `hash` itself: the hash must be reproducible
 * from content and chain position alone.
 */
export interface TraceStepHashInput {
  index: number;
  type: TraceStepType;
  timestamp: number;
  payload: JsonValue;
  prevHash: string | null;
}

// ---------------------------------------------------------------------------
// Trace
// ---------------------------------------------------------------------------

/**
 * Cassette schema version written to every saved trace.
 * loadTrace rejects cassettes whose version is absent or not equal to this value.
 * Bump when the Trace shape changes in a way that makes old cassettes unreadable.
 */
export const CURRENT_TRACE_VERSION = 1;

export interface Trace {
  /** Schema version — must equal CURRENT_TRACE_VERSION. Set by TraceRecorder. */
  version: number;
  id: string;
  /** Set when this trace was forked from another run. */
  parentId?: string;
  /** The parent step id this trace was forked from. */
  forkedFromStepId?: string;
  /** Milliseconds since epoch when the trace was created. */
  createdAt: number;
  steps: TraceStep[];
}
