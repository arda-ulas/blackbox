// Append-only, in-memory trace recorder.
//
// Steps can only be appended, never mutated in place. Each appended step is
// chained to the previous one by hash, forming a verifiable prefix.

import type {
  JsonValue,
  Trace,
  TraceStep,
  TraceStepType,
} from "./TraceTypes.ts";
import { hashTraceStepInput } from "./hash.ts";

export interface RecorderOptions {
  /** Parent run id, set when this recorder is capturing a forked run. */
  parentId?: string;
  /** The parent step id this run was forked from. */
  forkedFromStepId?: string;
  /** Override the creation timestamp (defaults to Date.now()). */
  createdAt?: number;
}

export class TraceRecorder {
  private readonly id: string;
  private readonly parentId?: string;
  private readonly forkedFromStepId?: string;
  private readonly createdAt: number;
  private readonly steps: TraceStep[] = [];

  constructor(id: string, options: RecorderOptions = {}) {
    this.id = id;
    this.parentId = options.parentId;
    this.forkedFromStepId = options.forkedFromStepId;
    this.createdAt = options.createdAt ?? Date.now();
  }

  /**
   * Append a new step. The index is assigned automatically (starting at 0),
   * prevHash is null for the first step and the previous step's hash after
   * that, and hash is computed from the canonical step input.
   *
   * Returns a copy of the created step; the recorder's internal array is not
   * exposed.
   */
  append(type: TraceStepType, payload: JsonValue, timestamp?: number): TraceStep {
    const index = this.steps.length;
    const prevHash = index === 0 ? null : this.steps[index - 1].hash;
    const ts = timestamp ?? Date.now();
    const hash = hashTraceStepInput({ index, type, timestamp: ts, payload, prevHash });

    const step: TraceStep = {
      id: `${this.id}:${index}`,
      index,
      type,
      timestamp: ts,
      payload: structuredClone(payload), // isolate internal copy from caller's object
      prevHash,
      hash,
    };

    this.steps.push(step);
    return structuredClone(step);
  }

  /**
   * Pre-populate the recorder with steps copied verbatim from a parent trace
   * prefix. Must be called before any append(). The fork invariant requires
   * that child steps at index < forkIndex are identical (same hash) to the
   * parent's steps, which is only possible when the original step objects
   * (including their timestamps and computed hashes) are copied as-is.
   */
  loadPrefix(steps: ReadonlyArray<TraceStep>): void {
    if (this.steps.length > 0) {
      throw new Error("TraceRecorder.loadPrefix: recorder must be empty");
    }
    for (const step of steps) {
      this.steps.push(structuredClone(step));
    }
  }

  /** Number of steps recorded so far. */
  size(): number {
    return this.steps.length;
  }

  /**
   * Return the trace as a plain object. Steps are shallow-copied and returned
   * in a fresh array so callers cannot mutate the recorder's internals.
   */
  getTrace(): Trace {
    const trace: Trace = {
      id: this.id,
      createdAt: this.createdAt,
      steps: this.steps.map((step) => ({ ...step })),
    };
    if (this.parentId !== undefined) {
      trace.parentId = this.parentId;
    }
    if (this.forkedFromStepId !== undefined) {
      trace.forkedFromStepId = this.forkedFromStepId;
    }
    return structuredClone(trace);
  }
}
