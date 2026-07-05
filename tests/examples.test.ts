// Smoke tests for the example:record / example:replay paths.
// Full cassette behaviour is covered in tests/replay.test.ts.
// These tests verify that the same logic used by the example scripts
// produces a valid, replayable cassette file on disk.

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
