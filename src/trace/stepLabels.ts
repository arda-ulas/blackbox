// Pure presentation helpers for rendering trace steps in the terminal.
//
// This module is presentation-only: it never hashes, never mutates a step,
// never touches disk, and never calls a model or tool. It takes already-recorded
// `TraceStep` facts and returns human-readable strings. It is the single source
// of truth for how a step is worded, imported by the CLI render sites (`diff`,
// `fork`, `inspect`) and by offline replay — so the same step reads the same way
// everywhere.

import type {
  JsonObject,
  JsonValue,
  TraceStep,
  TraceStepType,
} from "./TraceTypes.ts";

// ---------------------------------------------------------------------------
// Step-type labels
// ---------------------------------------------------------------------------

/**
 * Human-readable label for an internal `TraceStepType` enum value.
 *
 * This is the single source of truth for step-type wording. It is applied at
 * the `diff` / `fork` render sites (and may be adopted by `inspect`); it is
 * deliberately NOT applied at the `replay` render site, whose output stays
 * byte-identical to its historical form.
 */
export function stepTypeLabel(type: TraceStepType): string {
  switch (type) {
    case "model_input":
      return "model input";
    case "model_output":
      return "model output";
    case "tool_call":
      return "tool call";
    case "tool_result":
      return "tool result";
    case "metadata":
      return "metadata";
    default: {
      const _exhaustive: never = type;
      return `unknown (${String(_exhaustive)})`;
    }
  }
}

// ---------------------------------------------------------------------------
// Step summary
//
// `describeStep` is the humanized one-liner. Its logic is lifted verbatim from
// the former `CassetteReplay.summarizeStep` so that offline replay output is
// unchanged; `diff` now shares the identical function instead of dumping raw
// JSON.
// ---------------------------------------------------------------------------

/** One-line human summary of a recorded step (verbatim replay wording). */
export function describeStep(step: TraceStep): string {
  const p = step.payload;
  switch (step.type) {
    case "model_input": {
      const msgs = (p as { messages?: unknown[] }).messages;
      const count = Array.isArray(msgs) ? msgs.length : "?";
      return `Model called with ${count} message(s)`;
    }
    case "model_output": {
      const out = p as { type?: string; toolName?: string; text?: string };
      if (out.type === "tool_call") return `Model → tool_call: ${out.toolName}`;
      if (out.type === "final_answer") return `Model → final_answer: "${out.text}"`;
      return "Model → unknown output";
    }
    case "tool_call": {
      const tc = p as { toolName?: string };
      return `Tool called: ${tc.toolName}`;
    }
    case "tool_result": {
      const tr = p as { toolName?: string; error?: string };
      if (tr.error !== undefined) return `Tool result: ${tr.toolName} → ERROR: ${tr.error}`;
      return `Tool result: ${tr.toolName} → ok`;
    }
    case "metadata": {
      const m = p as { event?: string; result?: string; reason?: string };
      if (m.event === "run_completed") return `Run completed: "${m.result}"`;
      if (m.event === "run_failed") return `Run failed: ${m.reason}`;
      return `Metadata: ${JSON.stringify(p)}`;
    }
    default: {
      const _exhaustive: never = step.type;
      return `Unknown step type: ${String(_exhaustive)}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Divergence field rendering
//
// The one genuinely new rendering: given the two steps at a first divergence,
// surface the value that actually changed so it is readable — rather than a
// raw JSON dump truncated mid-key before the difference appears.
// ---------------------------------------------------------------------------

/** Character budget for a rendered divergent value before it is elided. */
const VALUE_BUDGET = 240;

/**
 * The field within a step's payload that carries the interesting content for a
 * human diff: a tool result's `result`, a tool call's `toolInput`, a model
 * output's `text`. Returns null when no such well-known field is present, in
 * which case the whole payload is the salient value.
 */
function salientField(step: TraceStep): string | null {
  const p = step.payload;
  if (p !== null && typeof p === "object" && !Array.isArray(p)) {
    const obj = p as JsonObject;
    if ("result" in obj) return "result";
    if ("toolInput" in obj) return "toolInput";
    if ("text" in obj) return "text";
  }
  return null;
}

/** The value carried by a step's salient field, or the whole payload. */
function salientValue(step: TraceStep, field: string | null): JsonValue {
  if (field !== null) {
    return (step.payload as JsonObject)[field];
  }
  return step.payload;
}

/** Compact single-line JSON, elided (never mid-escape) past the budget. */
function compactJson(value: JsonValue, budget = VALUE_BUDGET): string {
  const raw = JSON.stringify(value) ?? "undefined";
  return raw.length > budget ? raw.slice(0, budget - 1) + "…" : raw;
}

/**
 * Render the changed value at a divergence so it is actually legible.
 *
 * Returns the lines of a "changed value" block naming the differing field (when
 * both sides share a well-known one) and showing the parent and child values
 * with a wide budget so the real difference is visible. Returns an empty array
 * for a strict-prefix divergence (one side absent) — the caller already prints
 * a `<no step>` marker there.
 */
export function describeDivergenceField(
  parent: TraceStep | null,
  child: TraceStep | null,
): string[] {
  if (parent === null || child === null) return [];

  const pField = salientField(parent);
  const cField = salientField(child);
  const sharedField = pField !== null && pField === cField ? pField : null;

  const header =
    sharedField !== null ? `  changed value (${sharedField}):` : "  changed value:";

  return [
    header,
    `    parent: ${compactJson(salientValue(parent, sharedField))}`,
    `    child:  ${compactJson(salientValue(child, sharedField))}`,
  ];
}
