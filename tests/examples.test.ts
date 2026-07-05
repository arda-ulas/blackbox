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
import { defaultFixtureTools } from "../src/agent/fixtureTools.ts";
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

beforeAll(async () => {
  // Mirror the same setup used by example:record.
  const recorder = new TraceRecorder("example-test-run", { createdAt: 0 });
  const model = new FakeDeterministicModelClient([
    { type: "tool_call", toolName: "search",   toolInput: { query: "test" } },
    { type: "tool_call", toolName: "calendar", toolInput: { date: "2024-01-01" } },
    { type: "final_answer", text: "Done." },
  ]);
  const result = await runAgentLoop({
    model,
    tools: defaultFixtureTools(),
    recorder,
    prompt: "Book something.",
  });
  recordedTrace = result.trace;

  await mkdir(tempDir, { recursive: true });
  await saveTrace(recordedTrace, tempPath);
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

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

describe("example:replay path", () => {
  it("replays the cassette offline — no model or tools required", async () => {
    const loaded = await loadTrace(tempPath);
    // replayTrace(trace: Trace): ReplaySummary — no ModelClient or FixtureTool param.
    const summary = replayTrace(loaded);
    expect(summary.status).toBe("success");
    expect(summary.result).toBe("Done.");
    expect(summary.stepCount).toBe(loaded.steps.length);
    expect(summary.events.some((e) => e.type === "tool_call")).toBe(true);
    expect(summary.events.some((e) => e.type === "tool_result")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// example:fork path
//
// The test trace (search + calendar + final_answer) has 11 steps:
//   0  model_input   4  model_input   8  model_input
//   1  model_output  5  model_output  9  model_output
//   2  tool_call     6  tool_call    10  metadata
//   3  tool_result   7  tool_result
//
// Fork at index 8 — the third model_input, after both tool rounds.
// ---------------------------------------------------------------------------

const FORK_INDEX = 8;
const forkPath   = join(tempDir, "example-trace-fork.json");

let childTrace: Trace;

describe("example:fork path", () => {
  beforeAll(async () => {
    const { childTrace: ct } = await forkRun({
      parentTrace:    recordedTrace,
      forkIndex:      FORK_INDEX,
      childId:        "example-test-run-fork",
      promptMutation: "Skip the hotel — find train tickets instead.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Trains fully booked." },
      ]),
      tools: defaultFixtureTools(),
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

  it("child trace has forkedFromStepId set", () => {
    expect(typeof childTrace.forkedFromStepId).toBe("string");
    expect(childTrace.forkedFromStepId).toBe(recordedTrace.steps[FORK_INDEX].id);
  });

  it("parent and child share identical hashes for all steps index < forkIndex", () => {
    for (let i = 0; i < FORK_INDEX; i++) {
      expect(childTrace.steps[i].hash).toBe(recordedTrace.steps[i].hash);
    }
  });

  it("diffTraces reports first divergence exactly at forkIndex", () => {
    const diff = diffTraces(recordedTrace, childTrace);
    expect(diff.hasDivergence).toBe(true);
    expect(diff.firstDivergenceIndex).toBe(FORK_INDEX);
    expect(diff.sharedPrefixLength).toBe(FORK_INDEX);
  });

  it("formatFirstDivergence output includes 'First divergence' and the divergent index", () => {
    const diff   = diffTraces(recordedTrace, childTrace);
    const output = formatFirstDivergence(diff);
    expect(output).toContain("First divergence");
    expect(output).toContain(String(FORK_INDEX));
  });
});
