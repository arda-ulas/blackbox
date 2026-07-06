import { describe, it, expect, afterAll } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm, writeFile } from "node:fs/promises";
import {
  saveTrace,
  loadTrace,
  validateTrace,
  replayTrace,
} from "../src/replay/CassetteReplay.ts";
import { TraceRecorder } from "../src/trace/TraceRecorder.ts";
import { FakeDeterministicModelClient, type ModelClient } from "../src/agent/modelClient.ts";
import { defaultToolExecutor } from "../src/agent/fixtureTools.ts";
import { runAgentLoop } from "../src/agent/agentLoop.ts";
import { CURRENT_TRACE_VERSION } from "../src/trace/TraceTypes.ts";
import type { Trace } from "../src/trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempFiles: string[] = [];
let fileCounter = 0;

afterAll(async () => {
  await Promise.all(tempFiles.map((f) => rm(f, { force: true })));
});

function tmpPath(): string {
  fileCounter += 1;
  const p = join(tmpdir(), `blackbox-replay-test-${fileCounter}.json`);
  tempFiles.push(p);
  return p;
}

async function recordSimpleTrace(): Promise<Trace> {
  const recorder = new TraceRecorder("run-simple", { createdAt: 0 });
  const result = await runAgentLoop({
    model: new FakeDeterministicModelClient([
      { type: "final_answer", text: "Simple answer." },
    ]),
    toolExecutor: defaultToolExecutor(),
    recorder,
    prompt: "Simple question.",
  });
  return result.trace;
}

async function recordToolTrace(): Promise<Trace> {
  const recorder = new TraceRecorder("run-tool", { createdAt: 0 });
  const result = await runAgentLoop({
    model: new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "search", toolInput: { query: "test query" } },
      { type: "final_answer", text: "Found something." },
    ]),
    toolExecutor: defaultToolExecutor(),
    recorder,
    prompt: "Search for something.",
  });
  return result.trace;
}

// ---------------------------------------------------------------------------
// Persistence: saveTrace / loadTrace
// ---------------------------------------------------------------------------

describe("saveTrace / loadTrace", () => {
  it("round-trips a trace through disk without data loss", async () => {
    const trace = await recordSimpleTrace();
    const path = tmpPath();

    await saveTrace(trace, path);
    const loaded = await loadTrace(path);

    expect(loaded.id).toBe(trace.id);
    expect(loaded.createdAt).toBe(trace.createdAt);
    expect(loaded.steps).toHaveLength(trace.steps.length);

    for (let i = 0; i < trace.steps.length; i++) {
      expect(loaded.steps[i].hash).toBe(trace.steps[i].hash);
      expect(loaded.steps[i].prevHash).toBe(trace.steps[i].prevHash);
      expect(loaded.steps[i].type).toBe(trace.steps[i].type);
    }
  });

  it("round-tripped trace passes validateTrace without errors", async () => {
    const trace = await recordSimpleTrace();
    const path = tmpPath();

    await saveTrace(trace, path);
    const loaded = await loadTrace(path);

    expect(() => validateTrace(loaded)).not.toThrow();
  });

  it("round-trips a trace containing tool steps", async () => {
    const trace = await recordToolTrace();
    const path = tmpPath();

    await saveTrace(trace, path);
    const loaded = await loadTrace(path);

    expect(loaded.steps.map((s) => s.type)).toEqual(trace.steps.map((s) => s.type));
  });
});

// ---------------------------------------------------------------------------
// Hash-chain validation
// ---------------------------------------------------------------------------

describe("validateTrace", () => {
  it("accepts a valid trace produced by runAgentLoop", async () => {
    const trace = await recordSimpleTrace();
    expect(() => validateTrace(trace)).not.toThrow();
  });

  it("accepts a valid trace containing tool_call and tool_result steps", async () => {
    const trace = await recordToolTrace();
    expect(() => validateTrace(trace)).not.toThrow();
  });

  it("rejects a trace with a broken prevHash on step 1", async () => {
    const trace = await recordSimpleTrace();
    const broken = structuredClone(trace);
    // step 1's prevHash must equal step 0's hash; corrupt it.
    broken.steps[1].prevHash = "000000000000000000000000000000000000000000000000000000000000dead";
    expect(() => validateTrace(broken)).toThrow(/prevHash/);
  });

  it("rejects a trace where step 0 has a non-null prevHash", async () => {
    const trace = await recordSimpleTrace();
    const broken = structuredClone(trace);
    broken.steps[0].prevHash = "should-be-null";
    expect(() => validateTrace(broken)).toThrow(/prevHash null/);
  });

  it("rejects a trace with a modified payload but stale stored hash", async () => {
    const trace = await recordSimpleTrace();
    const tampered = structuredClone(trace);
    // Inject an extra field into step 0's payload — hash stays as-is.
    (tampered.steps[0].payload as Record<string, unknown>)["__evil"] = true;
    expect(() => validateTrace(tampered)).toThrow(/hash mismatch/);
  });

  it("rejects a trace with a sequencing gap in step indexes", async () => {
    const trace = await recordSimpleTrace();
    const broken = structuredClone(trace);
    // Manually set step 1's index to the wrong value.
    broken.steps[1].index = 99;
    expect(() => validateTrace(broken)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Offline replay
// ---------------------------------------------------------------------------

describe("replayTrace", () => {
  it("never calls the model or tools — accepts only a Trace, returns ReplaySummary", async () => {
    // replayTrace(trace: Trace): ReplaySummary — no ModelClient or FixtureTool
    // parameter exists. It is structurally impossible to inject live behavior.
    // Running it against a real trace and getting a result proves offline operation.
    const trace = await recordSimpleTrace();
    const summary = replayTrace(trace);
    expect(summary.traceId).toBe("run-simple");
    expect(summary.stepCount).toBe(trace.steps.length);
  });

  it("returns status:success and the final answer for a completed run", async () => {
    const trace = await recordSimpleTrace();
    const summary = replayTrace(trace);
    expect(summary.status).toBe("success");
    expect(summary.result).toBe("Simple answer.");
  });

  it("includes terminal success metadata event in the events list", async () => {
    const trace = await recordSimpleTrace();
    const summary = replayTrace(trace);
    const terminal = summary.events.at(-1);
    expect(terminal?.type).toBe("metadata");
    expect(terminal?.summary).toMatch(/run completed/i);
    expect(terminal?.summary).toContain("Simple answer.");
  });

  it("includes tool_call and tool_result events when the run used tools", async () => {
    const trace = await recordToolTrace();
    const summary = replayTrace(trace);
    expect(summary.events.some((e) => e.type === "tool_call")).toBe(true);
    expect(summary.events.some((e) => e.type === "tool_result")).toBe(true);
    expect(summary.status).toBe("success");
    expect(summary.result).toBe("Found something.");
  });

  it("produces one ReplayEvent per trace step", async () => {
    const trace = await recordToolTrace();
    const summary = replayTrace(trace);
    expect(summary.events).toHaveLength(trace.steps.length);
  });

  it("returns status:error and failureReason:model_error for a model-call-error trace", async () => {
    const recorder = new TraceRecorder("run-model-error-replay", { createdAt: 0 });
    const throwingModel: ModelClient = {
      async complete() {
        throw new Error("fake provider timeout");
      },
    };
    await expect(
      runAgentLoop({ model: throwingModel, toolExecutor: defaultToolExecutor(), recorder, prompt: "go" }),
    ).rejects.toThrow();

    const trace = recorder.getTrace();
    // Hash chain must be intact even though the run failed.
    expect(() => validateTrace(trace)).not.toThrow();
    // Replay reads cassette payloads only — no model or tool calls.
    const summary = replayTrace(trace);
    expect(summary.status).toBe("error");
    expect(summary.failureReason).toBe("model_error");
  });

  it("returns status:error and failureReason for a max-step-exceeded trace", async () => {
    const recorder = new TraceRecorder("run-failed", { createdAt: 0 });
    const model = new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "search", toolInput: { query: "a" } },
      { type: "tool_call", toolName: "search", toolInput: { query: "b" } },
    ]);
    // Expect the loop to throw, then inspect the partial trace.
    await expect(
      runAgentLoop({ model, toolExecutor: defaultToolExecutor(), recorder, prompt: "loop", maxSteps: 1 }),
    ).rejects.toThrow();

    const summary = replayTrace(recorder.getTrace());
    expect(summary.status).toBe("error");
    expect(summary.failureReason).toBe("max_steps_exceeded");
  });
});

// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

describe("cassette schema versioning", () => {
  it("saveTrace/loadTrace round-trip preserves version", async () => {
    const trace = await recordSimpleTrace();
    const path = tmpPath();

    expect(trace.version).toBe(CURRENT_TRACE_VERSION);
    await saveTrace(trace, path);
    const loaded = await loadTrace(path);
    expect(loaded.version).toBe(CURRENT_TRACE_VERSION);
  });

  it("loadTrace rejects a cassette with no version field", async () => {
    const trace = await recordSimpleTrace();
    const path = tmpPath();

    // Serialize without the version field to simulate a pre-versioning cassette.
    const { version: _stripped, ...withoutVersion } = trace;
    await writeFile(path, JSON.stringify(withoutVersion), "utf8");

    await expect(loadTrace(path)).rejects.toThrow(/version/);
  });

  it("loadTrace rejects a cassette with an unsupported version number", async () => {
    const trace = await recordSimpleTrace();
    const path = tmpPath();

    await writeFile(path, JSON.stringify({ ...trace, version: 999 }), "utf8");

    await expect(loadTrace(path)).rejects.toThrow(/999/);
  });

  it("loadTrace rejects a legacy v1 cassette with a clear re-record message", async () => {
    const trace = await recordSimpleTrace();
    const path = tmpPath();

    // Simulate a legacy v1 cassette (structured-transcript migration bumped to v2).
    await writeFile(path, JSON.stringify({ ...trace, version: 1 }), "utf8");

    await expect(loadTrace(path)).rejects.toThrow(/re-record/i);
  });
});
