// Smoke tests for the example:record / example:replay / example:fork paths.
// Full cassette behaviour is covered in tests/replay.test.ts.
// Full fork/diff behaviour is covered in tests/fork.test.ts / tests/diffTraces.test.ts.
// These tests verify that the same logic used by the example scripts
// produces valid cassette files on disk.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm, mkdir } from "node:fs/promises";
import { TraceRecorder } from "../src/trace/TraceRecorder.ts";
import { FakeDeterministicModelClient } from "../src/agent/modelClient.ts";
import { defaultToolExecutor } from "../src/agent/fixtureTools.ts";
import { runAgentLoop } from "../src/agent/agentLoop.ts";
import {
  saveTrace,
  loadTrace,
  validateTrace,
  replayTrace,
} from "../src/replay/CassetteReplay.ts";
import { forkRun } from "../src/fork/forkRun.ts";
import { diffTraces, formatFirstDivergence } from "../src/fork/diffTraces.ts";
import type { Trace } from "../src/trace/TraceTypes.ts";

const tempDir  = join(tmpdir(), `blackbox-examples-${Date.now()}`);
const tempPath = join(tempDir, "example-trace.json");

let recordedTrace: Trace;
let errorTrace: Trace;

beforeAll(async () => {
  await mkdir(tempDir, { recursive: true });

  // --- success trace (mirrors example:record demo 1) ---
  const successRecorder = new TraceRecorder("example-test-run", { createdAt: 0 });
  const successModel = new FakeDeterministicModelClient([
    { type: "tool_call", toolName: "search",   toolInput: { query: "test" } },
    { type: "tool_call", toolName: "calendar", toolInput: { date: "2024-01-01" } },
    { type: "final_answer", text: "Done." },
  ]);
  const successResult = await runAgentLoop({
    model:    successModel,
    toolExecutor: defaultToolExecutor(),
    recorder: successRecorder,
    prompt:   "Book something.",
  });
  recordedTrace = successResult.trace;
  await saveTrace(recordedTrace, tempPath);

  // --- error trace (mirrors example:record demo 2) ---
  // Model calls unknown tool "flights" → agent loop throws, trace is obtained
  // from the recorder which has captured all steps including the error metadata.
  const errorRecorder = new TraceRecorder("example-error-test-run", { createdAt: 0 });
  const errorModel = new FakeDeterministicModelClient([
    { type: "tool_call", toolName: "flights", toolInput: { destination: "Tokyo" } },
  ]);
  try {
    await runAgentLoop({
      model:    errorModel,
      toolExecutor: defaultToolExecutor(),
      recorder: errorRecorder,
      prompt:   "Find a flight to Tokyo.",
      maxSteps: 5,
    });
  } catch {
    // Expected: agent loop aborts on unknown tool "flights".
  }
  errorTrace = errorRecorder.getTrace();
  await saveTrace(errorTrace, join(tempDir, "example-error-trace.json"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// example:record success path
// ---------------------------------------------------------------------------

describe("example:record path", () => {
  it("creates a cassette file that can be loaded from disk", async () => {
    const loaded = await loadTrace(tempPath);
    expect(loaded.id).toBe("example-test-run");
    expect(loaded.steps.length).toBe(recordedTrace.steps.length);
  });

  it("created cassette passes validateTrace", async () => {
    const loaded = await loadTrace(tempPath);
    expect(() => validateTrace(loaded)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// example:record error path
// ---------------------------------------------------------------------------

describe("example:record error path", () => {
  it("creates an error cassette file that can be loaded from disk", async () => {
    const loaded = await loadTrace(join(tempDir, "example-error-trace.json"));
    expect(loaded.id).toBe("example-error-test-run");
  });

  it("error cassette passes validateTrace", () => {
    expect(() => validateTrace(errorTrace)).not.toThrow();
  });

  it("error trace terminal step is metadata with status: error", () => {
    const lastStep = errorTrace.steps.at(-1);
    expect(lastStep?.type).toBe("metadata");
    const payload = lastStep?.payload as { event?: string; status?: string };
    expect(payload?.event).toBe("run_failed");
    expect(payload?.status).toBe("error");
  });

  it("error trace failure reason is deterministic: unknown_tool", () => {
    const lastStep = errorTrace.steps.at(-1);
    const payload = lastStep?.payload as { reason?: string };
    expect(payload?.reason).toBe("unknown_tool");
  });

  it("error trace records which tool name caused the failure", () => {
    const lastStep = errorTrace.steps.at(-1);
    const payload = lastStep?.payload as { toolName?: string };
    expect(payload?.toolName).toBe("flights");
  });
});

// ---------------------------------------------------------------------------
// example:replay path
// ---------------------------------------------------------------------------

describe("example:replay path", () => {
  it("replays the cassette offline — no model or tools required", async () => {
    const loaded = await loadTrace(tempPath);
    const summary = replayTrace(loaded);
    expect(summary.status).toBe("success");
    expect(summary.result).toBe("Done.");
    expect(summary.stepCount).toBe(loaded.steps.length);
    expect(summary.events.some((e) => e.type === "tool_call")).toBe(true);
    expect(summary.events.some((e) => e.type === "tool_result")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// example:fork path — tool-result mutation demo
//
// Test trace (search + calendar + final_answer) step layout (11 steps):
//   0  model_input   4  model_input   8  model_input
//   1  model_output  5  model_output  9  model_output
//   2  tool_call     6  tool_call    10  metadata
//   3  tool_result   7  tool_result
//
// Mutation: step 3 (tool_result: search) → inject "no hotels available"
// Fork point: step 4 (second model_input — agent sees the mutated result)
// First divergence: step 3 (mutated tool_result has a new hash)
// ---------------------------------------------------------------------------

const MUTATION_INDEX = 3;
const FORK_INDEX     = 4;

const SEARCH_MUTATION = { available: false, message: "No hotels available." };

const forkPath = join(tempDir, "example-trace-fork.json");

let childTrace: Trace;

describe("example:fork path", () => {
  beforeAll(async () => {
    const { childTrace: ct } = await forkRun({
      parentTrace:         recordedTrace,
      forkIndex:           FORK_INDEX,
      childId:             "example-test-run-fork",
      promptMutation:      "(tool-result mutation — promptMutation unused)",
      toolResultMutations: { [MUTATION_INDEX]: SEARCH_MUTATION },
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "No availability found." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });
    childTrace = ct;
    await saveTrace(childTrace, forkPath);
  });

  it("creates the child cassette file on disk", async () => {
    const loaded = await loadTrace(forkPath);
    expect(loaded.id).toBe("example-test-run-fork");
  });

  it("child trace loaded from disk passes validateTrace", async () => {
    const loaded = await loadTrace(forkPath);
    expect(() => validateTrace(loaded)).not.toThrow();
  });

  it("child trace has parentId set to the parent trace id", () => {
    expect(childTrace.parentId).toBe(recordedTrace.id);
  });

  it("child trace has forkedFromStepId pointing at the fork-point step", () => {
    expect(typeof childTrace.forkedFromStepId).toBe("string");
    expect(childTrace.forkedFromStepId).toBe(recordedTrace.steps[FORK_INDEX].id);
  });

  it("steps before the mutation have identical hashes to parent", () => {
    for (let i = 0; i < MUTATION_INDEX; i++) {
      expect(childTrace.steps[i].hash).toBe(recordedTrace.steps[i].hash);
    }
  });

  it("the mutated step has a different hash than the parent", () => {
    expect(childTrace.steps[MUTATION_INDEX].hash).not.toBe(
      recordedTrace.steps[MUTATION_INDEX].hash,
    );
  });

  it("diffTraces reports first divergence at the mutation step", () => {
    const diff = diffTraces(recordedTrace, childTrace);
    expect(diff.hasDivergence).toBe(true);
    expect(diff.firstDivergenceIndex).toBe(MUTATION_INDEX);
    expect(diff.sharedPrefixLength).toBe(MUTATION_INDEX);
  });

  it("formatFirstDivergence output includes 'First divergence' and the divergent index", () => {
    const diff   = diffTraces(recordedTrace, childTrace);
    const output = formatFirstDivergence(diff);
    expect(output).toContain("First divergence");
    expect(output).toContain(String(MUTATION_INDEX));
  });
});
