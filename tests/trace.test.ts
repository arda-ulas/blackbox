import { describe, it, expect } from "vitest";
import { canonicalize, hashCanonical, hashTraceStepInput } from "../src/trace/hash.ts";
import { TraceRecorder } from "../src/trace/TraceRecorder.ts";
import { CURRENT_TRACE_VERSION } from "../src/trace/TraceTypes.ts";
import type { TraceStepType } from "../src/trace/TraceTypes.ts";

describe("canonicalize", () => {
  it("sorts object keys recursively", () => {
    const input = { b: 1, a: { d: 2, c: 3 }, list: [{ y: 1, x: 2 }] };
    expect(canonicalize(input)).toBe(
      '{"a":{"c":3,"d":2},"b":1,"list":[{"x":2,"y":1}]}',
    );
  });

  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("hashCanonical", () => {
  it("returns the same hash for identical objects with different key insertion order", () => {
    const a = { a: 1, b: 2, nested: { x: 1, y: 2 } };
    const b = { nested: { y: 2, x: 1 }, b: 2, a: 1 };
    expect(hashCanonical(a)).toBe(hashCanonical(b));
  });

  it("returns different hashes when payload values differ", () => {
    expect(hashCanonical({ a: 1 })).not.toBe(hashCanonical({ a: 2 }));
  });
});

describe("hashTraceStepInput", () => {
  it("changes the hash when the same logical payload is mutated", () => {
    const base = {
      index: 0,
      type: "model_input" as TraceStepType,
      timestamp: 1000,
      prevHash: null,
    };
    const h1 = hashTraceStepInput({ ...base, payload: { value: 1 } });
    const h2 = hashTraceStepInput({ ...base, payload: { value: 2 } });
    expect(h1).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// Timestamp/hash policy
//
// Timestamps are included in the step hash. This is intentional: it means two
// runs recording the same events at different wall-clock times will produce
// different hashes. The fork implementation must therefore copy parent prefix
// steps VERBATIM (preserving original timestamps and hashes) rather than
// re-recording those steps with new timestamps.
// ---------------------------------------------------------------------------

describe("hashTraceStepInput — timestamp policy", () => {
  const type: TraceStepType = "model_input";
  const payload = { prompt: "hello" };
  const prevHash = null;
  const index = 0;

  it("hashes identically when all inputs including timestamp are the same", () => {
    const input = { index, type, timestamp: 1000, payload, prevHash };
    expect(hashTraceStepInput(input)).toBe(hashTraceStepInput(input));
  });

  it("hashes differently when only the timestamp differs", () => {
    const h1 = hashTraceStepInput({ index, type, timestamp: 1000, payload, prevHash });
    const h2 = hashTraceStepInput({ index, type, timestamp: 1001, payload, prevHash });
    expect(h1).not.toBe(h2);
  });
});

describe("hashTraceStepInput — fork policy implication", () => {
  it("re-recording a step with the same timestamp reproduces its hash", () => {
    // Proof that verbatim copy (same timestamp) preserves hash equality.
    // A fork implementation MUST copy parent prefix steps verbatim —
    // not re-record them — to satisfy canonical-hash-identical prefix.
    const recorder = new TraceRecorder("parent-run");
    const step = recorder.append("model_input", { prompt: "hello" }, 1000);

    const reproduced = hashTraceStepInput({
      index: step.index,
      type: step.type,
      timestamp: step.timestamp,
      payload: step.payload,
      prevHash: step.prevHash,
    });

    expect(reproduced).toBe(step.hash);
  });

  it("re-recording a step at a different timestamp breaks hash equality", () => {
    // Proof that even one-millisecond clock drift causes prefix mismatch
    // if steps are re-recorded rather than copied verbatim.
    const recorder = new TraceRecorder("parent-run");
    const step = recorder.append("model_input", { prompt: "hello" }, 1000);

    const drifted = hashTraceStepInput({
      index: step.index,
      type: step.type,
      timestamp: step.timestamp + 1,
      payload: step.payload,
      prevHash: step.prevHash,
    });

    expect(drifted).not.toBe(step.hash);
  });
});

describe("TraceRecorder", () => {
  it("starts with an empty trace", () => {
    const recorder = new TraceRecorder("run-1");
    const trace = recorder.getTrace();
    expect(trace.id).toBe("run-1");
    expect(trace.steps).toEqual([]);
  });

  it("getTrace includes version equal to CURRENT_TRACE_VERSION", () => {
    const recorder = new TraceRecorder("run-version");
    expect(recorder.getTrace().version).toBe(CURRENT_TRACE_VERSION);
  });

  it("CURRENT_TRACE_VERSION is 2 (structured transcript schema)", () => {
    expect(CURRENT_TRACE_VERSION).toBe(2);
  });

  it("gives the first step index 0 and a null prevHash", () => {
    const recorder = new TraceRecorder("run-1");
    const step = recorder.append("model_input", { prompt: "hello" }, 1000);
    expect(step.index).toBe(0);
    expect(step.prevHash).toBeNull();
    expect(typeof step.hash).toBe("string");
    expect(step.hash.length).toBeGreaterThan(0);
  });

  it("chains the second step's prevHash to the first step's hash", () => {
    const recorder = new TraceRecorder("run-1");
    const first = recorder.append("model_input", { prompt: "hello" }, 1000);
    const second = recorder.append("model_output", { text: "world" }, 2000);
    expect(second.index).toBe(1);
    expect(second.prevHash).toBe(first.hash);
  });

  it("produces a different step hash when the logical payload changes", () => {
    const a = new TraceRecorder("run-a");
    const b = new TraceRecorder("run-b");
    const stepA = a.append("tool_result", { ok: true }, 1000);
    const stepB = b.append("tool_result", { ok: false }, 1000);
    // Same index/type/timestamp/prevHash -> only the payload differs.
    expect(stepA.hash).not.toBe(stepB.hash);
  });

  it("does not allow external mutation of recorder internals via getTrace", () => {
    const recorder = new TraceRecorder("run-1");
    recorder.append("metadata", { note: "first" }, 1000);

    const trace = recorder.getTrace();
    trace.steps.push({
      id: "tampered",
      index: 99,
      type: "metadata",
      timestamp: 0,
      payload: null,
      prevHash: null,
      hash: "tampered",
    });
    trace.steps[0].hash = "tampered";

    const fresh = recorder.getTrace();
    expect(fresh.steps).toHaveLength(1);
    expect(fresh.steps[0].hash).not.toBe("tampered");
  });

  it("does not leak nested payload mutations from getTrace into recorder internals", () => {
    const recorder = new TraceRecorder("run-1");
    recorder.append("model_input", { nested: { value: 42 } }, 1000);

    const trace = recorder.getTrace();
    // Mutate a nested property on the returned copy.
    (trace.steps[0].payload as { nested: { value: number } }).nested.value = 999;

    // A fresh getTrace must still return the original recorded value.
    const fresh = recorder.getTrace();
    expect((fresh.steps[0].payload as { nested: { value: number } }).nested.value).toBe(42);
  });

  it("does not allow post-append mutation of the caller payload to corrupt the stored step", () => {
    const recorder = new TraceRecorder("run-1");
    const payload = { value: 1 };
    recorder.append("metadata", payload, 1000);

    // Mutate the original object after it has been appended.
    payload.value = 999;

    const trace = recorder.getTrace();
    expect((trace.steps[0].payload as { value: number }).value).toBe(1);
  });
});
