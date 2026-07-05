// Cassette persistence, hash-chain validation, and offline replay.
//
// A cassette is a saved Trace (pretty JSON on disk). Replay reads the
// recorded steps verbatim — it never calls the model or executes tools.

import { readFile, writeFile } from "node:fs/promises";
import {
  type Trace,
  type TraceStep,
  type TraceStepType,
} from "../trace/TraceTypes.ts";
import { hashTraceStepInput } from "../trace/hash.ts";

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Write a trace to disk as pretty JSON. */
export async function saveTrace(trace: Trace, filePath: string): Promise<void> {
  await writeFile(filePath, JSON.stringify(trace, null, 2), "utf8");
}

/**
 * Read a trace from disk. Parses the JSON but does not validate the
 * hash-chain — call validateTrace() after loading if integrity matters.
 */
export async function loadTrace(filePath: string): Promise<Trace> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as Trace;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate the structural and cryptographic integrity of a trace.
 *
 * Checks (in order):
 * 1. Step indexes are sequential, starting at 0.
 * 2. The first step's prevHash is null.
 * 3. Each later step's prevHash equals the previous step's hash.
 * 4. Each step's stored hash matches the value recomputed from canonical fields.
 *
 * Throws a descriptive Error on the first violation found.
 */
export function validateTrace(trace: Trace): void {
  const { steps } = trace;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.index !== i) {
      throw new Error(
        `validateTrace: step at position ${i} has index ${step.index}; expected ${i}`,
      );
    }

    if (i === 0 && step.prevHash !== null) {
      throw new Error(
        `validateTrace: first step must have prevHash null; got "${step.prevHash}"`,
      );
    }

    if (i > 0 && step.prevHash !== steps[i - 1].hash) {
      throw new Error(
        `validateTrace: step ${i} prevHash "${step.prevHash}" does not match ` +
          `previous step hash "${steps[i - 1].hash}"`,
      );
    }

    const expected = hashTraceStepInput({
      index: step.index,
      type: step.type,
      timestamp: step.timestamp,
      payload: step.payload,
      prevHash: step.prevHash,
    });

    if (step.hash !== expected) {
      throw new Error(
        `validateTrace: step ${i} hash mismatch — ` +
          `stored "${step.hash}", recomputed "${expected}"`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Offline replay
// ---------------------------------------------------------------------------

export interface ReplayEvent {
  index: number;
  type: TraceStepType;
  summary: string;
}

export interface ReplaySummary {
  traceId: string;
  stepCount: number;
  events: ReplayEvent[];
  status: "success" | "error" | "incomplete";
  /** Final answer text, present when status is "success". */
  result?: string;
  /** Failure reason string, present when status is "error". */
  failureReason?: string;
}

/**
 * Reconstruct a human-readable summary of a recorded run.
 *
 * Replay is purely a read of stored steps — no model client or tool
 * implementations are required or called. The function signature accepts
 * only a Trace, making it structurally impossible to inject live behavior.
 */
export function replayTrace(trace: Trace): ReplaySummary {
  const events: ReplayEvent[] = trace.steps.map((step) => ({
    index: step.index,
    type: step.type,
    summary: summarizeStep(step),
  }));

  let status: ReplaySummary["status"] = "incomplete";
  let result: string | undefined;
  let failureReason: string | undefined;

  const last = trace.steps.at(-1);
  if (last?.type === "metadata") {
    const meta = last.payload as {
      event?: string;
      status?: string;
      result?: string;
      reason?: string;
    };
    if (meta.event === "run_completed" && meta.status === "success") {
      status = "success";
      result = meta.result;
    } else if (meta.event === "run_failed") {
      status = "error";
      failureReason = meta.reason;
    }
  }

  const summary: ReplaySummary = { traceId: trace.id, stepCount: trace.steps.length, events, status };
  if (result !== undefined) summary.result = result;
  if (failureReason !== undefined) summary.failureReason = failureReason;
  return summary;
}

function summarizeStep(step: TraceStep): string {
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
      return `Unknown step type: ${_exhaustive}`;
    }
  }
}
