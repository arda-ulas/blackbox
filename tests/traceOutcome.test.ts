// Unit tests for terminal-outcome extraction (W7-B).
// Pure, offline, deterministic. Includes a parity check proving terminalOutcome
// agrees with replayTrace over the committed fixture corpus (so replay and the
// behavioral outcome diff share one source of truth).

import { describe, it, expect } from "vitest";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { terminalOutcome, toolCallSequence } from "../src/trace/traceOutcome.ts";
import { loadTrace, replayTrace } from "../src/replay/CassetteReplay.ts";
import { CURRENT_TRACE_VERSION, type Trace, type TraceStep, type JsonValue } from "../src/trace/TraceTypes.ts";

const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const FIXTURES_DIR = join(PROJECT_ROOT, "fixtures", "traces");

// ---------------------------------------------------------------------------
// Minimal in-memory trace builder. terminalOutcome / toolCallSequence read only
// step.type and step.payload, so fabricated hash/id/index fields are fine here.
// ---------------------------------------------------------------------------

function step(type: TraceStep["type"], payload: JsonValue): TraceStep {
  return { id: "s", index: 0, type, timestamp: 0, payload, prevHash: null, hash: "h" };
}

function trace(steps: TraceStep[]): Trace {
  return { version: CURRENT_TRACE_VERSION, id: "t", createdAt: 0, steps };
}

// ---------------------------------------------------------------------------
// terminalOutcome
// ---------------------------------------------------------------------------

describe("terminalOutcome", () => {
  it("success: reads status and finalAnswer from a run_completed metadata step", () => {
    const t = trace([
      step("model_input", { messages: [] }),
      step("metadata", { event: "run_completed", status: "success", result: "Booked." }),
    ]);
    expect(terminalOutcome(t)).toEqual({ status: "success", finalAnswer: "Booked." });
  });

  it("error: reads status and failureReason from a run_failed metadata step", () => {
    const t = trace([
      step("model_input", { messages: [] }),
      step("metadata", { event: "run_failed", status: "error", reason: "model_error" }),
    ]);
    expect(terminalOutcome(t)).toEqual({ status: "error", failureReason: "model_error" });
  });

  it("incomplete: last step is not metadata", () => {
    const t = trace([step("model_input", { messages: [] }), step("model_output", { type: "tool_call" })]);
    expect(terminalOutcome(t)).toEqual({ status: "incomplete" });
  });

  it("incomplete: empty trace does not throw", () => {
    expect(terminalOutcome(trace([]))).toEqual({ status: "incomplete" });
  });

  it("success with no recorded result omits finalAnswer (does not invent one)", () => {
    const t = trace([step("metadata", { event: "run_completed", status: "success" })]);
    const o = terminalOutcome(t);
    expect(o.status).toBe("success");
    expect(o.finalAnswer).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Parity with replayTrace over the committed fixture corpus
// ---------------------------------------------------------------------------

describe("terminalOutcome — parity with replayTrace (committed corpus)", () => {
  it("agrees with replayTrace status/result/failureReason for every fixture", async () => {
    const files = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const t = await loadTrace(join(FIXTURES_DIR, f));
      const outcome = terminalOutcome(t);
      const replay = replayTrace(t);
      expect(outcome.status, f).toBe(replay.status);
      expect(outcome.finalAnswer, f).toBe(replay.result);
      expect(outcome.failureReason, f).toBe(replay.failureReason);
    }
  });
});

// ---------------------------------------------------------------------------
// toolCallSequence
// ---------------------------------------------------------------------------

describe("toolCallSequence", () => {
  it("returns tool names in order from tool_call steps", () => {
    const t = trace([
      step("model_input", { messages: [] }),
      step("tool_call", { toolCallId: "call-0", toolName: "search", toolInput: {} }),
      step("tool_result", { toolCallId: "call-0", toolName: "search", result: {} }),
      step("tool_call", { toolCallId: "call-1", toolName: "booking", toolInput: {} }),
      step("tool_result", { toolCallId: "call-1", toolName: "booking", result: {} }),
      step("metadata", { event: "run_completed", status: "success", result: "done" }),
    ]);
    expect(toolCallSequence(t)).toEqual(["search", "booking"]);
  });

  it("reads tool_call steps, NOT tool_result steps (the locked source decision)", () => {
    // A trace with a tool_result whose toolName differs from its tool_call must
    // yield the tool_call name, proving tool_result is ignored for the sequence.
    const t = trace([
      step("tool_call", { toolCallId: "call-0", toolName: "search", toolInput: {} }),
      step("tool_result", { toolCallId: "call-0", toolName: "SHOULD_BE_IGNORED", result: {} }),
    ]);
    expect(toolCallSequence(t)).toEqual(["search"]);
  });

  it("returns an empty array for a final-answer-only run", () => {
    const t = trace([
      step("model_input", { messages: [] }),
      step("model_output", { type: "final_answer", text: "hi" }),
      step("metadata", { event: "run_completed", status: "success", result: "hi" }),
    ]);
    expect(toolCallSequence(t)).toEqual([]);
  });
});
