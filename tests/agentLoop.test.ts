import { describe, it, expect } from "vitest";
import { runAgentLoop } from "../src/agent/agentLoop.ts";
import {
  FakeDeterministicModelClient,
  ModelCallError,
  type ModelClient,
} from "../src/agent/modelClient.ts";
import { defaultToolExecutor } from "../src/agent/fixtureTools.ts";
import { TraceRecorder } from "../src/trace/TraceRecorder.ts";
import { validateTrace } from "../src/replay/CassetteReplay.ts";

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
      toolExecutor: defaultToolExecutor(),
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
      toolExecutor: defaultToolExecutor(),
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
      toolExecutor: defaultToolExecutor(),
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
      toolExecutor: defaultToolExecutor(),
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
      toolExecutor: defaultToolExecutor(),
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
      toolExecutor: defaultToolExecutor(),
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

describe("agentLoop — tool definitions in model input", () => {
  it("passes tool definitions from ToolExecutor into the model_input step payload", async () => {
    const model = new FakeDeterministicModelClient([
      { type: "final_answer", text: "Done." },
    ]);
    const recorder = makeRecorder();
    await runAgentLoop({
      model,
      toolExecutor: defaultToolExecutor(),
      recorder,
      prompt: "Go.",
    });
    const firstInput = recorder.getTrace().steps.find((s) => s.type === "model_input");
    const tools = (firstInput?.payload as { tools?: unknown[] }).tools;
    expect(Array.isArray(tools)).toBe(true);
    expect((tools as unknown[]).length).toBeGreaterThan(0);
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

    const opts = { toolExecutor: defaultToolExecutor(), prompt: "search for test", maxSteps: 10 };

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
        toolExecutor: defaultToolExecutor(),
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
        toolExecutor: defaultToolExecutor(),
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

// ---------------------------------------------------------------------------
// W4-B slice 2: model-call error metadata recording
// ---------------------------------------------------------------------------

describe("agentLoop — model-call error recording", () => {
  it("records a terminal metadata step when model.complete() throws", async () => {
    const throwingModel: ModelClient = {
      async complete() {
        throw new Error("network timeout");
      },
    };
    const recorder = makeRecorder("run-model-error");

    await expect(
      runAgentLoop({
        model: throwingModel,
        toolExecutor: defaultToolExecutor(),
        recorder,
        prompt: "do something",
      }),
    ).rejects.toThrow();

    const trace = recorder.getTrace();
    const terminal = trace.steps.at(-1);
    expect(terminal?.type).toBe("metadata");
    // Hash chain must remain valid even after an aborted run.
    expect(() => validateTrace(trace)).not.toThrow();
  });

  it("terminal metadata has event, status, reason, errorKind, and message fields", async () => {
    const throwingModel: ModelClient = {
      async complete() {
        throw new Error("connection refused");
      },
    };
    const recorder = makeRecorder("run-payload-shape");

    await expect(
      runAgentLoop({
        model: throwingModel,
        toolExecutor: defaultToolExecutor(),
        recorder,
        prompt: "do something",
      }),
    ).rejects.toThrow();

    const terminal = recorder.getTrace().steps.at(-1);
    const payload = terminal?.payload as Record<string, unknown>;
    expect(payload.event).toBe("run_failed");
    expect(payload.status).toBe("error");
    expect(payload.reason).toBe("model_error");
    expect(typeof payload.errorKind).toBe("string");
    expect(typeof payload.message).toBe("string");
  });

  it("plain Error thrown by model maps to errorKind 'unknown'", async () => {
    const throwingModel: ModelClient = {
      async complete() {
        throw new Error("something unexpected");
      },
    };
    const recorder = makeRecorder("run-unknown-kind");

    await expect(
      runAgentLoop({
        model: throwingModel,
        toolExecutor: defaultToolExecutor(),
        recorder,
        prompt: "do something",
      }),
    ).rejects.toThrow();

    const terminal = recorder.getTrace().steps.at(-1);
    const payload = terminal?.payload as { errorKind: string };
    expect(payload.errorKind).toBe("unknown");
  });

  it("ModelCallError with classified kind propagates errorKind into the metadata step", async () => {
    const throwingModel: ModelClient = {
      async complete() {
        throw new ModelCallError("401 Unauthorized", "provider_auth_error");
      },
    };
    const recorder = makeRecorder("run-auth-error");

    await expect(
      runAgentLoop({
        model: throwingModel,
        toolExecutor: defaultToolExecutor(),
        recorder,
        prompt: "do something",
      }),
    ).rejects.toThrow();

    const terminal = recorder.getTrace().steps.at(-1);
    const payload = terminal?.payload as { errorKind: string; message: string };
    expect(payload.errorKind).toBe("provider_auth_error");
    expect(payload.message).toBe("401 Unauthorized");
  });

  it("non-Error thrown value is sanitized to a safe generic message", async () => {
    const throwingModel: ModelClient = {
      async complete() {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "just a raw string, not an Error object";
      },
    };
    const recorder = makeRecorder("run-non-error-throw");

    await expect(
      runAgentLoop({
        model: throwingModel,
        toolExecutor: defaultToolExecutor(),
        recorder,
        prompt: "do something",
      }),
    ).rejects.toBeDefined();

    const terminal = recorder.getTrace().steps.at(-1);
    const payload = terminal?.payload as { message: string; errorKind: string };
    // message must be a safe string, not the raw thrown value
    expect(typeof payload.message).toBe("string");
    expect(payload.message.length).toBeGreaterThan(0);
    expect(payload.errorKind).toBe("unknown");
  });

  it("raw error object is not stored in the trace payload — only a string message", async () => {
    const throwingModel: ModelClient = {
      async complete() {
        const err = new Error("classified error") as Error & { secretData: string };
        err.secretData = "DO_NOT_STORE_THIS";
        throw err;
      },
    };
    const recorder = makeRecorder("run-no-raw-object");

    await expect(
      runAgentLoop({
        model: throwingModel,
        toolExecutor: defaultToolExecutor(),
        recorder,
        prompt: "do something",
      }),
    ).rejects.toThrow();

    const terminal = recorder.getTrace().steps.at(-1);
    const payloadStr = JSON.stringify(terminal?.payload);
    // Raw Error fields (secretData) must not appear in the serialised payload
    expect(payloadStr).not.toContain("DO_NOT_STORE_THIS");
    // message must be a plain string in the payload
    const payload = terminal?.payload as { message: string };
    expect(typeof payload.message).toBe("string");
  });

  it("no tool execution occurs after a model-call failure", async () => {
    const throwingModel: ModelClient = {
      async complete() {
        throw new Error("model down");
      },
    };
    const recorder = makeRecorder("run-no-tool-after-failure");

    await expect(
      runAgentLoop({
        model: throwingModel,
        toolExecutor: defaultToolExecutor(),
        recorder,
        prompt: "do something",
      }),
    ).rejects.toThrow();

    const steps = recorder.getTrace().steps;
    // tool_call and tool_result steps must be absent — the executor was never reached
    expect(steps.some((s) => s.type === "tool_call")).toBe(false);
    expect(steps.some((s) => s.type === "tool_result")).toBe(false);
  });
});
