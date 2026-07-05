import { describe, it, expect } from "vitest";
import { runAgentLoop } from "../src/agent/agentLoop.ts";
import { FakeDeterministicModelClient } from "../src/agent/modelClient.ts";
import { defaultFixtureTools } from "../src/agent/fixtureTools.ts";
import { TraceRecorder } from "../src/trace/TraceRecorder.ts";

function makeRecorder(id = "run-test") {
  return new TraceRecorder(id, { createdAt: 0 });
}

describe("agentLoop — final answer", () => {
  it("completes a simple run and returns the final answer", async () => {
    const model = new FakeDeterministicModelClient([
      { type: "final_answer", text: "All done." },
    ]);
    const result = await runAgentLoop({
      model,
      tools: defaultFixtureTools(),
      recorder: makeRecorder(),
      prompt: "Summarise something.",
    });
    expect(result.finalAnswer).toBe("All done.");
    expect(result.stepCount).toBe(1);
  });

  it("records model_input and model_output steps", async () => {
    const model = new FakeDeterministicModelClient([
      { type: "final_answer", text: "Done." },
    ]);
    const recorder = makeRecorder();
    await runAgentLoop({
      model,
      tools: defaultFixtureTools(),
      recorder,
      prompt: "Go.",
    });
    const types = recorder.getTrace().steps.map((s) => s.type);
    expect(types).toContain("model_input");
    expect(types).toContain("model_output");
  });

  it("records a terminal success metadata step on completion", async () => {
    const model = new FakeDeterministicModelClient([
      { type: "final_answer", text: "The answer is 42." },
    ]);
    const recorder = makeRecorder();
    await runAgentLoop({
      model,
      tools: defaultFixtureTools(),
      recorder,
      prompt: "What is the answer?",
    });

    const terminal = recorder.getTrace().steps.at(-1);
    expect(terminal?.type).toBe("metadata");
    const payload = terminal?.payload as {
      event: string;
      status: string;
      result: string;
    };
    expect(payload.event).toBe("run_completed");
    expect(payload.status).toBe("success");
    expect(payload.result).toBe("The answer is 42.");
  });
});

describe("agentLoop — tool call", () => {
  it("records tool_call and tool_result steps when a tool is requested", async () => {
    const model = new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "search", toolInput: { query: "best hotels" } },
      { type: "final_answer", text: "Here are the results." },
    ]);
    const recorder = makeRecorder();
    await runAgentLoop({
      model,
      tools: defaultFixtureTools(),
      recorder,
      prompt: "Find hotels.",
    });
    const types = recorder.getTrace().steps.map((s) => s.type);
    expect(types).toContain("tool_call");
    expect(types).toContain("tool_result");
  });

  it("feeds the tool result back into the next model input", async () => {
    const model = new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "search", toolInput: { query: "flights" } },
      { type: "final_answer", text: "Got results." },
    ]);
    const recorder = makeRecorder();
    await runAgentLoop({
      model,
      tools: defaultFixtureTools(),
      recorder,
      prompt: "Find flights.",
    });

    const modelInputSteps = recorder
      .getTrace()
      .steps.filter((s) => s.type === "model_input");

    // Two model_input steps: initial and after tool result.
    expect(modelInputSteps).toHaveLength(2);

    const firstMessages = (modelInputSteps[0].payload as { messages: unknown[] }).messages;
    const secondMessages = (modelInputSteps[1].payload as { messages: unknown[] }).messages;

    // The second call must have more messages (tool-call ack + tool result were appended).
    expect(secondMessages.length).toBeGreaterThan(firstMessages.length);
  });

  it("records the expected step type sequence for a one-tool run", async () => {
    const model = new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "calendar", toolInput: { date: "2024-01-01" } },
      { type: "final_answer", text: "Booked." },
    ]);
    const recorder = makeRecorder();
    await runAgentLoop({
      model,
      tools: defaultFixtureTools(),
      recorder,
      prompt: "Check calendar.",
    });
    expect(recorder.getTrace().steps.map((s) => s.type)).toEqual([
      "model_input",
      "model_output",
      "tool_call",
      "tool_result",
      "model_input",
      "model_output",
      "metadata",
    ]);
  });
});

describe("agentLoop — determinism", () => {
  it("produces identical step type sequences for the same script on repeated runs", async () => {
    const script = () =>
      new FakeDeterministicModelClient([
        { type: "tool_call", toolName: "search", toolInput: { query: "test" } },
        { type: "final_answer", text: "Result" },
      ]);

    const runA = new TraceRecorder("run-a", { createdAt: 1000 });
    const runB = new TraceRecorder("run-b", { createdAt: 1000 });

    const opts = { tools: defaultFixtureTools(), prompt: "search for test", maxSteps: 10 };

    await runAgentLoop({ ...opts, model: script(), recorder: runA });
    await runAgentLoop({ ...opts, model: script(), recorder: runB });

    const typesA = runA.getTrace().steps.map((s) => s.type);
    const typesB = runB.getTrace().steps.map((s) => s.type);
    expect(typesA).toEqual(typesB);

    // Tool payloads must also match exactly (no timestamp or hash involved).
    const toolCallA = runA.getTrace().steps.find((s) => s.type === "tool_call");
    const toolCallB = runB.getTrace().steps.find((s) => s.type === "tool_call");
    expect(toolCallA?.payload).toEqual(toolCallB?.payload);

    const toolResultA = runA.getTrace().steps.find((s) => s.type === "tool_result");
    const toolResultB = runB.getTrace().steps.find((s) => s.type === "tool_result");
    expect(toolResultA?.payload).toEqual(toolResultB?.payload);
  });
});

describe("agentLoop — error cases", () => {
  it("fails clearly and records an error step for an unknown tool name", async () => {
    const model = new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "nonexistent_tool", toolInput: {} },
    ]);
    const recorder = makeRecorder();

    await expect(
      runAgentLoop({
        model,
        tools: defaultFixtureTools(),
        recorder,
        prompt: "use a bad tool",
      }),
    ).rejects.toThrow("nonexistent_tool");

    // The failed tool_result must be in the trace.
    const toolResultStep = recorder
      .getTrace()
      .steps.find((s) => s.type === "tool_result");
    expect(toolResultStep).toBeDefined();
    expect(
      (toolResultStep!.payload as { error: string }).error,
    ).toMatch("nonexistent_tool");
  });

  it("records a terminal error metadata step then throws when max steps are exceeded", async () => {
    // Two scripted tool_calls so FakeDeterministicModelClient does not overrun before the
    // loop exit — only the first call fires before maxSteps=1 halts the loop.
    const recorder = makeRecorder("run-maxsteps");
    const model = new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "search", toolInput: { query: "a" } },
      { type: "tool_call", toolName: "search", toolInput: { query: "b" } },
    ]);

    await expect(
      runAgentLoop({
        model,
        tools: defaultFixtureTools(),
        recorder,
        prompt: "loop forever",
        maxSteps: 1,
      }),
    ).rejects.toThrow("exceeded max steps");

    const terminal = recorder.getTrace().steps.at(-1);
    expect(terminal?.type).toBe("metadata");
    const payload = terminal?.payload as { event: string; reason: string; maxSteps: number };
    expect(payload.event).toBe("run_failed");
    expect(payload.reason).toBe("max_steps_exceeded");
    expect(payload.maxSteps).toBe(1);
  });
});
