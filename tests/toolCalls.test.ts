// Offline tests for the multi-call `tool_calls` model_output shape (schema v2,
// additive) and the neutrality audit rules that recorded agents rely on.

import { describe, it, expect } from "vitest";
import { TraceRecorder } from "../src/trace/TraceRecorder.ts";
import { toolCallsOf, modelOutputText } from "../src/trace/payloads.ts";
import { describeStep, describeDivergenceField } from "../src/trace/stepLabels.ts";
import { auditTraceNeutrality } from "../src/trace/neutrality.ts";
import { findCredentials, maskSecrets } from "../src/trace/secrets.ts";
import { verifyTrace } from "../src/trace/verifyTrace.ts";
import { replayTrace } from "../src/replay/CassetteReplay.ts";
import { forkRun } from "../src/fork/forkRun.ts";
import { diffTraces } from "../src/fork/diffTraces.ts";
import {
  FakeDeterministicModelClient,
  type ModelClient,
  type ModelInput,
  type ModelOutput,
} from "../src/agent/modelClient.ts";
import { defaultToolExecutor } from "../src/agent/fixtureTools.ts";
import type { JsonValue, Trace } from "../src/trace/TraceTypes.ts";

// A parallel round recorded the way the SDK wrappers write it: one model turn
// with narration text and two calls, then both tool steps, then a final answer.
function parallelTrace(systemPrompt?: string): Trace {
  const r = new TraceRecorder("parallel-run", { createdAt: 1000 });
  const firstInput: Record<string, JsonValue> = {
    messages: [{ role: "user", content: "Weather in Paris and Rome?" }],
    tools: [{ name: "weather", description: "Get weather" }],
  };
  if (systemPrompt !== undefined) firstInput["systemPrompt"] = systemPrompt;
  r.append("model_input", firstInput, 1001);
  r.append(
    "model_output",
    {
      type: "tool_calls",
      text: "Checking both cities.",
      calls: [
        { toolCallId: "call-0", toolName: "weather", toolInput: { city: "Paris" } },
        { toolCallId: "call-1", toolName: "weather", toolInput: { city: "Rome" } },
      ],
    },
    1002,
  );
  r.append("tool_call", { toolCallId: "call-0", toolName: "weather", toolInput: { city: "Paris" } }, 1003);
  r.append("tool_result", { toolCallId: "call-0", toolName: "weather", result: { temp: 18 } }, 1004);
  r.append("tool_call", { toolCallId: "call-1", toolName: "weather", toolInput: { city: "Rome" } }, 1005);
  r.append("tool_result", { toolCallId: "call-1", toolName: "weather", result: { temp: 24 } }, 1006);
  const secondInput: Record<string, JsonValue> = {
    messages: [
      { role: "user", content: "Weather in Paris and Rome?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking both cities." },
          { type: "tool_use", toolCallId: "call-0", toolName: "weather", toolInput: { city: "Paris" } },
          { type: "tool_use", toolCallId: "call-1", toolName: "weather", toolInput: { city: "Rome" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", toolCallId: "call-0", toolName: "weather", result: { temp: 18 } },
          { type: "tool_result", toolCallId: "call-1", toolName: "weather", result: { temp: 24 } },
        ],
      },
    ],
    tools: [{ name: "weather", description: "Get weather" }],
  };
  if (systemPrompt !== undefined) secondInput["systemPrompt"] = systemPrompt;
  r.append("model_input", secondInput, 1007);
  r.append("model_output", { type: "final_answer", text: "Rome is warmer." }, 1008);
  r.append("metadata", { event: "run_completed", status: "success", result: "Rome is warmer." }, 1009);
  return r.getTrace();
}

/** Records every ModelInput it receives, then answers with a fixed final answer. */
class CapturingModel implements ModelClient {
  readonly inputs: ModelInput[] = [];
  async complete(input: ModelInput): Promise<ModelOutput> {
    this.inputs.push(structuredClone(input));
    return { type: "final_answer", text: "continued" };
  }
}

describe("toolCallsOf / modelOutputText", () => {
  it("reads the single-call shape as one ref", () => {
    expect(toolCallsOf({ type: "tool_call", toolCallId: "call-0", toolName: "search", toolInput: { q: 1 } })).toEqual([
      { toolCallId: "call-0", toolName: "search", toolInput: { q: 1 } },
    ]);
  });

  it("reads every call of the multi-call shape in order", () => {
    const refs = toolCallsOf(parallelTrace().steps[1].payload);
    expect(refs.map((ref) => ref.toolCallId)).toEqual(["call-0", "call-1"]);
  });

  it("returns no calls for a final answer or a non-object payload", () => {
    expect(toolCallsOf({ type: "final_answer", text: "done" })).toEqual([]);
    expect(toolCallsOf(null)).toEqual([]);
    expect(toolCallsOf("x")).toEqual([]);
  });

  it("returns narration text and final-answer text", () => {
    expect(modelOutputText(parallelTrace().steps[1].payload)).toBe("Checking both cities.");
    expect(modelOutputText({ type: "final_answer", text: "done" })).toBe("done");
    expect(modelOutputText({ type: "tool_call", toolCallId: "call-0", toolName: "a", toolInput: null })).toBeUndefined();
  });
});

describe("tool_calls rendering", () => {
  it("describes a multi-call turn with its tool names and a text marker", () => {
    expect(describeStep(parallelTrace().steps[1])).toBe("Model → tool_calls: weather, weather (with text)");
  });

  it("diffs a multi-call turn on its calls rather than its narration", () => {
    const parent = parallelTrace().steps[1];
    const child = structuredClone(parent);
    (child.payload as { calls: Array<{ toolInput: JsonValue }> }).calls[1].toolInput = { city: "Milan" };
    const lines = describeDivergenceField(parent, child);
    expect(lines[0]).toBe("  changed value (calls):");
    expect(lines[2]).toContain("Milan");
  });

  it("replays and verifies a cassette with a parallel round", () => {
    const trace = parallelTrace();
    expect(verifyTrace(trace).pass).toBe(true);
    const summary = replayTrace(trace);
    expect(summary.status).toBe("success");
    expect(summary.events[1].summary).toContain("tool_calls");
  });
});

describe("forkRun over a parallel round", () => {
  it("rebuilds one assistant turn with every tool_use and one user turn with every result", async () => {
    const model = new CapturingModel();
    const parent = parallelTrace();
    const fork = await forkRun({
      parentTrace: parent,
      forkIndex: 6,
      childId: "parallel-fork",
      promptMutation: "",
      model,
      toolExecutor: defaultToolExecutor(),
      toolResultMutations: { 3: { temp: -5, conditions: "snow" } },
    });

    const messages = model.inputs[0].messages;
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Checking both cities." },
        { type: "tool_use", toolCallId: "call-0", toolName: "weather", toolInput: { city: "Paris" } },
        { type: "tool_use", toolCallId: "call-1", toolName: "weather", toolInput: { city: "Rome" } },
      ],
    });
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", toolCallId: "call-0", toolName: "weather", result: { temp: -5, conditions: "snow" } },
        { type: "tool_result", toolCallId: "call-1", toolName: "weather", result: { temp: 24 } },
      ],
    });

    const diff = diffTraces(parent, fork.childTrace);
    expect(diff.firstDivergenceIndex).toBe(3);
    expect(verifyTrace(fork.childTrace).pass).toBe(true);
  });

  it("rejects a fork point that splits a parallel round", async () => {
    await expect(
      forkRun({
        parentTrace: parallelTrace(),
        forkIndex: 4,
        childId: "split",
        promptMutation: "",
        model: new CapturingModel(),
        toolExecutor: defaultToolExecutor(),
        toolResultMutations: { 3: { temp: -5 } },
      }),
    ).rejects.toThrow(/splits a tool round.*call-1/);
  });

  it("carries the recorded system prompt into the continuation", async () => {
    const model = new CapturingModel();
    await forkRun({
      parentTrace: parallelTrace("You are terse."),
      forkIndex: 6,
      childId: "system-fork",
      promptMutation: "",
      model,
      toolExecutor: defaultToolExecutor(),
      toolResultMutations: { 3: { temp: 0 } },
    });
    expect(model.inputs[0].systemPrompt).toBe("You are terse.");
  });

  it("seeds new tool-call ids past the ids inside a tool_calls payload", async () => {
    const model = new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "search", toolInput: { query: "x" } },
      { type: "final_answer", text: "done" },
    ]);
    const fork = await forkRun({
      parentTrace: parallelTrace(),
      forkIndex: 2,
      childId: "seed",
      promptMutation: "again",
      model,
      toolExecutor: defaultToolExecutor(),
    });
    const newCall = fork.childTrace.steps.find((s, i) => i >= 2 && s.type === "tool_call");
    expect((newCall?.payload as { toolCallId: string }).toolCallId).toBe("call-2");
  });
});

describe("neutrality audit for recorded agents", () => {
  function traceWith(payload: JsonValue): Trace {
    const r = new TraceRecorder("audit", { createdAt: 0 });
    r.append("tool_result", payload, 0);
    return r.getTrace();
  }

  it("does not flag identifiers that merely contain a provider prefix", () => {
    const trace = traceWith({ toolCallId: "call-0", toolName: "send_msg_to_user", result: "msg_to_user ok" });
    expect(auditTraceNeutrality(trace)).toEqual({ ok: true, found: [] });
  });

  it("does not flag provider-looking keys inside tool results or tool inputs", () => {
    const trace = traceWith({
      toolCallId: "call-0",
      toolName: "disk",
      result: { usage: 42, finish_reason: "n/a" },
    });
    expect(auditTraceNeutrality(trace).ok).toBe(true);
  });

  it("still flags provider keys at structural positions", () => {
    const trace = traceWith({ toolCallId: "call-0", toolName: "x", result: 1, finish_reason: "stop" });
    expect(auditTraceNeutrality(trace).found).toContain("finish_reason");
  });

  it("flags OpenAI provider ids at structural positions", () => {
    const trace = traceWith({ toolCallId: "call_abcdefghijklmnopqrstuvwx", toolName: "x", result: 1 });
    expect(auditTraceNeutrality(trace).found).toContain("call_");
    const leaked = traceWith({ id: "chatcmpl-AbC123xyz", toolName: "x" });
    expect(auditTraceNeutrality(leaked).found).toContain("chatcmpl-");
  });

  it("treats provider ids and env-var names inside tool results as the user's content", () => {
    const trace = traceWith({
      toolCallId: "call-0",
      toolName: "read_file",
      result: 'const id = "toolu_01ABC"; process.env.ANTHROPIC_API_KEY; "sk-ant"',
    });
    expect(auditTraceNeutrality(trace)).toEqual({ ok: true, found: [] });
  });

  it("flags credentials inside user data", () => {
    const trace = traceWith({ toolCallId: "call-0", toolName: "x", result: "Authorization: Bearer abcdefghijklmnopqrstu" });
    expect(auditTraceNeutrality(trace).found).toContain("bearer-token");
    const key = traceWith({ toolCallId: "call-0", toolName: "x", result: { env: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz" } });
    expect(auditTraceNeutrality(key).found).toContain("sk-ant");
  });
});

describe("secrets", () => {
  it("finds and masks known credential shapes and caller-supplied literals", () => {
    const text = "key sk-ant-api03-abcdef and custom-secret-123 and sk-proj-zzz";
    expect(findCredentials(text, ["custom-secret-123"]).sort()).toEqual(
      ["<api-key-value>", "sk-ant", "sk-proj"].sort(),
    );
    const masked = maskSecrets(text, ["custom-secret-123"]);
    expect(masked).not.toContain("sk-ant-api03");
    expect(masked).not.toContain("custom-secret-123");
    expect(masked).not.toContain("sk-proj-zzz");
  });

  it("never masks env-var names, which are not secrets", () => {
    expect(maskSecrets("set ANTHROPIC_API_KEY first")).toBe("set ANTHROPIC_API_KEY first");
  });
});
