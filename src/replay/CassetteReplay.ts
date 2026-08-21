// Cassette persistence, hash-chain validation, and offline replay.
//
// A cassette is a saved Trace (pretty JSON on disk). Replay reads the
// recorded steps verbatim — it never calls the model or executes tools.

import { readFile, writeFile } from "node:fs/promises";
import {
  CURRENT_TRACE_VERSION,
  type Trace,
  type TraceStepType,
} from "../trace/TraceTypes.ts";
import { hashTraceStepInput } from "../trace/hash.ts";
import { describeStep } from "../trace/stepLabels.ts";
import { terminalOutcome } from "../trace/traceOutcome.ts";

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Write a trace to disk as pretty JSON. */
export async function saveTrace(trace: Trace, filePath: string): Promise<void> {
  await writeFile(filePath, JSON.stringify(trace, null, 2), "utf8");
}

/**
 * Read a trace from disk.
 *
 * Acts as the deserialization gate: rejects cassettes that have no version
 * field (written by a pre-versioning build) or an unsupported version number.
 * Does not validate the hash-chain — call validateTrace() after loading if
 * integrity matters.
 */
export async function loadTrace(filePath: string): Promise<Trace> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  if (typeof parsed["version"] !== "number") {
    throw new Error(
      `loadTrace: cassette at "${filePath}" has no version field — ` +
        `it may have been written by a pre-versioning build of Blackbox. ` +
        `Re-run example:record to regenerate it.`,
    );
  }

  if (parsed["version"] !== CURRENT_TRACE_VERSION) {
    throw new Error(
      `loadTrace: cassette version ${parsed["version"]} is not supported — ` +
        `this build of Blackbox expects schema version ${CURRENT_TRACE_VERSION}. ` +
        `Older cassettes (e.g. v1) are not migrated; re-record with \`npm run cli -- record\`.`,
    );
  }

  return parsed as unknown as Trace;
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
 * implementations are required or called. The function accepts a Trace as
 * its execution input, and the current module has no model, tool-execution,
 * or network dependency.
 */
export function replayTrace(trace: Trace): ReplaySummary {
  const events: ReplayEvent[] = trace.steps.map((step) => ({
    index: step.index,
    type: step.type,
    summary: describeStep(step),
  }));

  // Terminal status/result parsing lives in one place (terminalOutcome); this
  // maps its fields onto ReplaySummary with byte-identical results to the prior
  // inline parse. replayTrace's Trace-only signature and offline guarantee are
  // unchanged, and it still writes no stdout (the CLI's runReplay renders this).
  const outcome = terminalOutcome(trace);

  const summary: ReplaySummary = {
    traceId: trace.id,
    stepCount: trace.steps.length,
    events,
    status: outcome.status,
  };
  if (outcome.finalAnswer !== undefined) summary.result = outcome.finalAnswer;
  if (outcome.failureReason !== undefined) summary.failureReason = outcome.failureReason;
  return summary;
}
