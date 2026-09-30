// Record / replay / fork of user-owned agents through the real Anthropic and
// OpenAI SDKs. Every test injects a scripted fake upstream as the SDK's
// underlying fetch, so there is no network and no real API key.

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { blackbox, isBlackboxError, ReplayDivergenceError, BlackboxUnsupportedError } from "../src/index.ts";
import type { BlackboxSession } from "../src/session/session.ts";
import { diffTraces } from "../src/fork/diffTraces.ts";
import { verifyTrace } from "../src/trace/verifyTrace.ts";
import { replayTrace } from "../src/replay/CassetteReplay.ts";
import type { Trace } from "../src/trace/TraceTypes.ts";

const DIR = mkdtempSync(join(tmpdir(), "blackbox-session-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
let fileCounter = 0;
const tmp = (name: string): string => join(DIR, `${++fileCounter}-${name}.json`);
const readTrace = (path: string): Trace => JSON.parse(readFileSync(path, "utf8")) as Trace;

const API_KEY = "sk-test-not-a-real-key-000000";

// ---------------------------------------------------------------------------
// Fake upstreams
// ---------------------------------------------------------------------------

interface Upstream {
  fetch: typeof fetch;
  calls: number;
  bodies: Array<Record<string, unknown>>;
}

function upstream(responses: Array<object | Response>): Upstream {
  const state: Upstream = {
    calls: 0,
    bodies: [],
    fetch: async (_input, init) => {
      state.bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const next = responses[state.calls++];
      if (next === undefined) throw new Error("fake upstream: no scripted response");
      if (next instanceof Response) return next;
      return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
  return state;
}

const noNetwork: typeof fetch = async () => {
  throw new Error("network used during replay");
};

function anthropicMessage(content: object[], stopReason: string): object {
  return {
    id: `msg_01${Math.random().toString(36).slice(2, 12)}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 34 },
  };
}

const PARALLEL_WEATHER = anthropicMessage(
  [
    { type: "text", text: "Checking both." },
    { type: "tool_use", id: "toolu_01AAAAAAAAAAAAAAAAAAAAAA", name: "weather", input: { city: "Paris" } },
    { type: "tool_use", id: "toolu_01BBBBBBBBBBBBBBBBBBBBBB", name: "weather", input: { city: "Rome" } },
  ],
  "tool_use",
);
const FINAL = anthropicMessage([{ type: "text", text: "Rome is warmer." }], "end_turn");

// ---------------------------------------------------------------------------
// A user-owned agent loop (what a stranger already has)
// ---------------------------------------------------------------------------

type Weather = (input: { city: string }) => Promise<{ city: string; temp: number }>;

async function weatherAgent(
  client: Anthropic,
  tools: { weather: Weather },
  prompt = "Is Paris or Rome warmer today?",
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  for (let turn = 0; turn < 5; turn++) {
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 512,
      system: "Answer in one sentence.",
      tools: [{ name: "weather", description: "Current weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }],
      messages,
    });
    if (response.stop_reason !== "tool_use") {
      return response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    }
    messages.push({ role: "assistant", content: response.content });
    const toolUses = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    const results = await Promise.all(
      toolUses.map(async (block) => ({
        type: "tool_result" as const,
        tool_use_id: block.id,
        content: JSON.stringify(await tools.weather(block.input as { city: string })),
      })),
    );
    messages.push({ role: "user", content: results });
  }
  throw new Error("too many turns");
}

function weatherTool(temps: Record<string, number>, delays: Record<string, number> = {}): { fn: Weather; runs: string[] } {
  const runs: string[] = [];
  const fn: Weather = async ({ city }) => {
    runs.push(city);
    await new Promise((resolve) => setTimeout(resolve, delays[city] ?? 0));
    return { city, temp: temps[city] ?? 0 };
  };
  return { fn, runs };
}

function anthropicClient(bb: BlackboxSession): Anthropic {
  return new Anthropic({ apiKey: API_KEY, fetch: bb.fetch, maxRetries: 0 });
}

async function recordWeather(delays: Record<string, number> = {}): Promise<{ path: string; answer: string; upstream: Upstream }> {
  const path = tmp("weather");
  const up = upstream([PARALLEL_WEATHER, FINAL]);
  const bb = blackbox({ mode: "record", out: path, baseFetch: up.fetch, logErrors: false });
  const tool = weatherTool({ Paris: 18, Rome: 24 }, delays);
  const answer = await weatherAgent(anthropicClient(bb), bb.tools({ weather: tool.fn }));
  await bb.finish();
  return { path, answer, upstream: up };
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

describe("record (Anthropic SDK)", () => {
  it("writes a verified, provider-neutral cassette of the agent's own run", async () => {
    const { path, answer, upstream: up } = await recordWeather();
    expect(answer).toBe("Rome is warmer.");
    expect(up.calls).toBe(2);

    const trace = readTrace(path);
    expect(trace.steps.map((step) => step.type)).toEqual([
      "model_input", "model_output", "tool_call", "tool_result", "tool_call", "tool_result",
      "model_input", "model_output", "metadata",
    ]);
    expect(trace.steps[0].payload).toMatchObject({
      systemPrompt: "Answer in one sentence.",
      model: "claude-sonnet-5",
      params: { maxTokens: 512 },
      messages: [{ role: "user", content: "Is Paris or Rome warmer today?" }],
    });
    expect(trace.steps[1].payload).toEqual({
      type: "tool_calls",
      text: "Checking both.",
      calls: [
        { toolCallId: "call-0", toolName: "weather", toolInput: { city: "Paris" } },
        { toolCallId: "call-1", toolName: "weather", toolInput: { city: "Rome" } },
      ],
    });
    expect(trace.steps[3].payload).toEqual({ toolCallId: "call-0", toolName: "weather", result: { city: "Paris", temp: 18 } });
    expect(replayTrace(trace)).toMatchObject({ status: "success", result: "Rome is warmer." });
    expect(verifyTrace(trace).pass).toBe(true);

    const serialized = JSON.stringify(trace);
    for (const leaked of ["toolu_", "msg_01", "usage", "stop_reason", API_KEY]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("records concurrently run tools in call order, whatever order they finish in", async () => {
    const fast = readTrace((await recordWeather()).path);
    const reversed = readTrace((await recordWeather({ Paris: 30, Rome: 0 })).path);
    const ids = (trace: Trace) => trace.steps.filter((s) => s.type === "tool_result").map((s) => (s.payload as { toolCallId: string }).toolCallId);
    expect(ids(fast)).toEqual(["call-0", "call-1"]);
    expect(ids(reversed)).toEqual(["call-0", "call-1"]);
  });

  it("records a retried call once", async () => {
    const path = tmp("retry");
    const overloaded = new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } }), {
      status: 529,
      headers: { "content-type": "application/json", "retry-after-ms": "1" },
    });
    const up = upstream([overloaded, FINAL]);
    const bb = blackbox({ mode: "record", out: path, baseFetch: up.fetch, logErrors: false });
    const client = new Anthropic({ apiKey: API_KEY, fetch: bb.fetch, maxRetries: 1 });
    await weatherAgent(client, bb.tools({ weather: weatherTool({}).fn }));
    await bb.finish();
    expect(up.calls).toBe(2);
    expect(readTrace(path).steps.filter((s) => s.type === "model_input")).toHaveLength(1);
  });

  it("refuses to write a cassette that contains the API key", async () => {
    const path = tmp("leak");
    const bb = blackbox({ mode: "record", out: path, baseFetch: upstream([PARALLEL_WEATHER, FINAL]).fetch, logErrors: false });
    const leaky: Weather = async ({ city }) => ({ city, temp: 1, debug: `key=${API_KEY}` }) as unknown as { city: string; temp: number };
    await weatherAgent(anthropicClient(bb), bb.tools({ weather: leaky }));
    await expect(bb.finish()).rejects.toThrow(/contains your API key/);
    expect(() => readFileSync(path)).toThrow();
  });

  it("rejects streaming before any network call, with advice the agent can see", async () => {
    const up = upstream([]);
    const bb = blackbox({ mode: "record", out: tmp("stream"), baseFetch: up.fetch, logErrors: false });
    const client = anthropicClient(bb);
    const error = await client.messages
      .create({ model: "m", max_tokens: 10, messages: [{ role: "user", content: "hi" }], stream: true })
      .then(() => undefined, (e: unknown) => e);
    expect(isBlackboxError(error)).toBe(true);
    expect(String((error as Error).message)).toContain("use the non-streaming call");
    expect(up.calls).toBe(0);
    await expect(bb.finish()).rejects.toBeInstanceOf(BlackboxUnsupportedError);
  });

  it("fails loudly when a 2xx response body is not JSON", async () => {
    const bad = new Response("<html>proxy</html>", { status: 200, headers: { "content-type": "text/html" } });
    const bb = blackbox({ mode: "record", out: tmp("bad"), baseFetch: upstream([bad]).fetch, logErrors: false });
    await expect(weatherAgent(anthropicClient(bb), bb.tools({ weather: weatherTool({}).fn }))).rejects.toThrow();
    await expect(bb.finish()).rejects.toThrow(/not JSON/);
  });
});

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------

describe("finish", () => {
  it("records an agent error as run_failed, taking precedence over an earlier answer", async () => {
    const path = tmp("failed");
    const bb = blackbox({ mode: "record", out: path, baseFetch: upstream([FINAL]).fetch, logErrors: false });
    await weatherAgent(anthropicClient(bb), bb.tools({ weather: weatherTool({}).fn }));
    await bb.finish({ error: new Error("post-processing failed") });
    expect(readTrace(path).steps.at(-1)?.payload).toEqual({
      event: "run_failed", status: "error", reason: "agent_error", message: "post-processing failed",
    });
  });

  it("rejects a result and an error together", async () => {
    const bb = blackbox({ mode: "record", out: tmp("both"), baseFetch: upstream([]).fetch, logErrors: false });
    await expect(bb.finish({ result: "x", error: new Error("y") })).rejects.toThrow(/not both/);
  });

  it("leaves a run that stopped after a tool round incomplete", async () => {
    const path = tmp("incomplete");
    const bb = blackbox({ mode: "record", out: path, baseFetch: upstream([PARALLEL_WEATHER]).fetch, logErrors: false });
    const client = anthropicClient(bb);
    await client.messages.create({ model: "m", max_tokens: 10, messages: [{ role: "user", content: "hi" }] });
    await bb.finish();
    expect(replayTrace(readTrace(path)).status).toBe("incomplete");
  });

  it("is a no-op pass-through when no mode is set", async () => {
    const up = upstream([FINAL]);
    const bb = blackbox({ baseFetch: up.fetch });
    const tool = weatherTool({});
    expect(await weatherAgent(anthropicClient(bb), bb.tools({ weather: tool.fn }))).toBe("Rome is warmer.");
    expect(await bb.finish()).toMatchObject({ mode: "off", steps: 0 });
  });
});

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

describe("replay", () => {
  it("re-runs the agent offline: same answer, no network, tools never run, identical trace", async () => {
    const { path } = await recordWeather();
    const bb = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    const tool = weatherTool({ Paris: -99, Rome: -99 });
    const answer = await weatherAgent(anthropicClient(bb), bb.tools({ weather: tool.fn }));
    expect(answer).toBe("Rome is warmer.");
    expect(tool.runs).toEqual([]);
    const summary = await bb.finish();
    expect(summary).toMatchObject({ mode: "replay", status: "success" });
    expect(diffTraces(readTrace(path), bb.trace).hasDivergence).toBe(false);
  });

  it("reports the first request that differs from the recording", async () => {
    const { path } = await recordWeather();
    const bb = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    const error = await weatherAgent(anthropicClient(bb), bb.tools({ weather: weatherTool({}).fn }), "Is Oslo or Rome warmer?").then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isBlackboxError(error)).toBe(true);
    const failure = await bb.finish().then(() => undefined, (e: unknown) => e);
    expect(failure).toBeInstanceOf(ReplayDivergenceError);
    expect((failure as ReplayDivergenceError).stepIndex).toBe(0);
    expect((failure as ReplayDivergenceError).path).toBe("messages[0].content");
    expect((failure as Error).message).toContain("--match sequence");
  });

  it("stops strict replay when the request names a different model", async () => {
    const { path } = await recordWeather();
    const bb = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    const error = await anthropicClient(bb)
      .messages.create({
        model: "claude-opus-5",
        max_tokens: 512,
        system: "Answer in one sentence.",
        tools: [{ name: "weather", description: "Current weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }],
        messages: [{ role: "user", content: "Is Paris or Rome warmer today?" }],
      })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(isBlackboxError(error)).toBe(true);
    const failure = await bb.finish().then(() => undefined, (e: unknown) => e);
    expect(failure).toBeInstanceOf(ReplayDivergenceError);
    expect((failure as ReplayDivergenceError).stepIndex).toBe(0);
    expect((failure as ReplayDivergenceError).path).toBe("model");
  });

  it("tolerates a changed request in sequence mode", async () => {
    const { path } = await recordWeather();
    const bb = blackbox({ mode: "replay", cassette: path, match: "sequence", baseFetch: noNetwork, logErrors: false });
    const answer = await weatherAgent(anthropicClient(bb), bb.tools({ weather: weatherTool({}).fn }), "Different prompt");
    expect(answer).toBe("Rome is warmer.");
    await expect(bb.finish()).resolves.toMatchObject({ status: "success" });
  });

  it("reports an agent that makes more model calls than were recorded", async () => {
    const { path } = await recordWeather();
    const bb = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    const client = anthropicClient(bb);
    await weatherAgent(client, bb.tools({ weather: weatherTool({}).fn }));
    await expect(client.messages.create({ model: "m", max_tokens: 1, messages: [{ role: "user", content: "again" }] })).rejects.toThrow(
      /\[blackbox\]/,
    );
    await expect(bb.finish()).rejects.toThrow(/no further model call/);
  });

  it("reports an agent that stops before the recording ends", async () => {
    const { path } = await recordWeather();
    const bb = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    const client = anthropicClient(bb);
    const first = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 512,
      system: "Answer in one sentence.",
      tools: [{ name: "weather", description: "Current weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }],
      messages: [{ role: "user", content: "Is Paris or Rome warmer today?" }],
    });
    expect(first.stop_reason).toBe("tool_use");
    await expect(bb.finish()).rejects.toThrow(/the agent moved on without running it|end of run/);
  });

  it("hands the agent SDK-shaped objects: ids, stop reason, zero usage", async () => {
    const { path } = await recordWeather();
    const bb = blackbox({ mode: "replay", cassette: path, match: "sequence", baseFetch: noNetwork, logErrors: false });
    const response = await anthropicClient(bb).messages.create({ model: "claude-sonnet-5", max_tokens: 1, messages: [{ role: "user", content: "x" }] });
    expect(response.stop_reason).toBe("tool_use");
    expect(response.content.map((block) => (block.type === "tool_use" ? block.id : block.type))).toEqual(["text", "call-0", "call-1"]);
    expect(response.usage.input_tokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fork
// ---------------------------------------------------------------------------

describe("fork", () => {
  it("replays the prefix, swaps one tool result, continues from a script, and diffs at the fork step", async () => {
    const { path } = await recordWeather();
    const out = tmp("fork");
    const bb = blackbox({
      mode: "fork",
      cassette: path,
      out,
      forkAt: 3,
      forkSet: { city: "Paris", temp: 35 },
      continueWith: "script",
      script: [{ type: "final_answer", text: "Paris is warmer." }],
      baseFetch: noNetwork,
      logErrors: false,
    });
    const tool = weatherTool({ Paris: 0, Rome: 24 });
    const answer = await weatherAgent(anthropicClient(bb), bb.tools({ weather: tool.fn }));
    expect(answer).toBe("Paris is warmer.");
    // call-0 (Paris) was replaced; call-1 (Rome) comes after the fork step in the
    // recording, so it belongs to the new branch and ran for real.
    expect(tool.runs).toEqual(["Rome"]);
    await bb.finish();

    const parent = readTrace(path);
    const child = readTrace(out);
    expect(child.parentId).toBe(parent.id);
    expect(child.forkedFromStepId).toBe(parent.steps[3].id);
    const diff = diffTraces(parent, child);
    expect(diff.firstDivergenceIndex).toBe(3);
    expect(child.steps.slice(0, 3)).toEqual(parent.steps.slice(0, 3));
    expect(child.steps[3].payload).toEqual({ toolCallId: "call-0", toolName: "weather", result: { city: "Paris", temp: 35 } });
    const lastInput = [...child.steps].reverse().find((s) => s.type === "model_input")?.payload as { messages: Array<{ content: unknown }> };
    expect(JSON.stringify(lastInput.messages.at(-1))).toContain('\\"temp\\":35');
    expect(replayTrace(child)).toMatchObject({ status: "success", result: "Paris is warmer." });
    expect(verifyTrace(child).pass).toBe(true);
  });

  it("continues with the live client after the fork point only", async () => {
    const { path } = await recordWeather();
    const live = upstream([anthropicMessage([{ type: "text", text: "Live answer." }], "end_turn")]);
    const bb = blackbox({
      mode: "fork", cassette: path, out: tmp("fork-live"), forkAt: 5, forkSet: { city: "Rome", temp: -3 },
      continueWith: "live", baseFetch: live.fetch, logErrors: false,
    });
    const tool = weatherTool({});
    expect(await weatherAgent(anthropicClient(bb), bb.tools({ weather: tool.fn }))).toBe("Live answer.");
    expect(live.calls).toBe(1);
    expect(tool.runs).toEqual([]);
    expect(JSON.stringify(live.bodies[0])).toContain('\\"temp\\":-3');
    await expect(bb.finish()).resolves.toMatchObject({ status: "success" });
  });

  it("rejects a fork step that is not a tool result, naming the ones that are", async () => {
    const { path } = await recordWeather();
    expect(() => blackbox({ mode: "fork", cassette: path, out: tmp("x"), forkAt: 1, forkSet: 1, continueWith: "script", script: [] })).toThrow(
      /fork at a tool_result step \(this cassette has tool results at 3, 5\)/,
    );
  });

  it("requires a continuation", async () => {
    const { path } = await recordWeather();
    expect(() => blackbox({ mode: "fork", cassette: path, out: tmp("x"), forkAt: 3, forkSet: 1 })).toThrow(/"live".*"script"/);
  });

  it("reports when the script runs out", async () => {
    const { path } = await recordWeather();
    const bb = blackbox({
      mode: "fork", cassette: path, out: tmp("x"), forkAt: 3, forkSet: {}, continueWith: "script", script: [],
      baseFetch: noNetwork, logErrors: false,
    });
    await expect(weatherAgent(anthropicClient(bb), bb.tools({ weather: weatherTool({}).fn }))).rejects.toThrow(/\[blackbox\]/);
    await expect(bb.finish()).rejects.toThrow(/script ran out/);
  });
});

// ---------------------------------------------------------------------------
// OpenAI Chat Completions
// ---------------------------------------------------------------------------

function completion(message: object, finishReason: string): object {
  return {
    id: "chatcmpl-AbCdEf0123456789",
    object: "chat.completion",
    created: 1_790_000_000,
    model: "gpt-5",
    choices: [{ index: 0, finish_reason: finishReason, logprobs: null, message: { role: "assistant", refusal: null, ...message } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

async function openaiAgent(client: OpenAI, tools: { lookup: (input: { sku: string }) => Promise<{ sku: string; stock: number }> }): Promise<string> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: "You check stock." },
    { role: "user", content: "Is SKU-1 in stock?" },
  ];
  for (let turn = 0; turn < 5; turn++) {
    const response = await client.chat.completions.create({
      model: "gpt-5",
      messages,
      tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: { sku: { type: "string" } } } } }],
    });
    const message = response.choices[0].message;
    if (!message.tool_calls || message.tool_calls.length === 0) return message.content ?? "";
    messages.push(message);
    for (const call of message.tool_calls) {
      if (call.type !== "function") continue;
      const result = await tools.lookup(JSON.parse(call.function.arguments) as { sku: string });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  throw new Error("too many turns");
}

describe("OpenAI SDK", () => {
  const TOOL_TURN = completion(
    { content: null, tool_calls: [{ id: "call_AAAAAAAAAAAAAAAAAAAAAAAA", type: "function", function: { name: "lookup", arguments: '{"sku":"SKU-1"}' } }] },
    "tool_calls",
  );
  const DONE = completion({ content: "Yes, 4 in stock." }, "stop");
  const lookup = async ({ sku }: { sku: string }) => ({ sku, stock: 4 });

  it("records, replays offline with a placeholder key, and forks from a script", async () => {
    const path = tmp("openai");
    const rec = blackbox({ mode: "record", out: path, baseFetch: upstream([TOOL_TURN, DONE]).fetch, logErrors: false });
    expect(await openaiAgent(new OpenAI({ apiKey: API_KEY, fetch: rec.fetch, maxRetries: 0 }), rec.tools({ lookup }))).toBe("Yes, 4 in stock.");
    await rec.finish();
    const trace = readTrace(path);
    expect(trace.steps.map((s) => s.type)).toEqual([
      "model_input", "model_output", "tool_call", "tool_result", "model_input", "model_output", "metadata",
    ]);
    expect(trace.steps[0].payload).toMatchObject({ systemPrompt: "You check stock.", model: "gpt-5" });
    expect(verifyTrace(trace).pass).toBe(true);
    expect(JSON.stringify(trace)).not.toContain("call_AAAA");

    const replay = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    const client = new OpenAI({ apiKey: "replay", fetch: replay.fetch, maxRetries: 0 });
    expect(await openaiAgent(client, replay.tools({ lookup: async () => ({ sku: "never", stock: -1 }) }))).toBe("Yes, 4 in stock.");
    await expect(replay.finish()).resolves.toMatchObject({ status: "success" });

    const out = tmp("openai-fork");
    const fork = blackbox({
      mode: "fork", cassette: path, out, forkAt: 3, forkSet: { sku: "SKU-1", stock: 0 }, continueWith: "script",
      script: [{ type: "final_answer", text: "No, it is out of stock." }], baseFetch: noNetwork, logErrors: false,
    });
    expect(await openaiAgent(new OpenAI({ apiKey: "replay", fetch: fork.fetch, maxRetries: 0 }), fork.tools({ lookup }))).toBe(
      "No, it is out of stock.",
    );
    await fork.finish();
    expect(diffTraces(trace, readTrace(out)).firstDivergenceIndex).toBe(3);
  });

  it("rejects the Responses API with a pointer to chat.completions", async () => {
    const up = upstream([]);
    const bb = blackbox({ mode: "record", out: tmp("responses"), baseFetch: up.fetch, logErrors: false });
    const client = new OpenAI({ apiKey: API_KEY, fetch: bb.fetch, maxRetries: 0 });
    await expect(client.responses.create({ model: "gpt-5", input: "hi" })).rejects.toThrow(/chat\.completions\.create/);
    expect(up.calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Regression tests from the pre-release audit
// ---------------------------------------------------------------------------

describe("audit regressions", () => {
  it("a scripted fork with a tool round keeps call ids consistent, and the child replays strictly", async () => {
    const { path } = await recordWeather();
    const out = tmp("script-tools");
    const fork = blackbox({
      mode: "fork", cassette: path, out, forkAt: 3, forkSet: { city: "Paris", temp: 35 }, continueWith: "script",
      script: [
        { type: "tool_calls", calls: [{ toolCallId: "", toolName: "weather", toolInput: { city: "Oslo" } }] },
        { type: "final_answer", text: "Paris is warmest." },
      ],
      baseFetch: noNetwork, logErrors: false,
    });
    const tool = weatherTool({ Paris: 0, Rome: 24, Oslo: 5 });
    expect(await weatherAgent(anthropicClient(fork), fork.tools({ weather: tool.fn }))).toBe("Paris is warmest.");
    await fork.finish();
    const child = readTrace(out);
    const ids = child.steps.filter((s) => s.type === "tool_result").map((s) => (s.payload as { toolCallId: string }).toolCallId);
    expect(ids).toEqual(["call-0", "call-1", "call-2"]);
    const lastInput = [...child.steps].reverse().find((s) => s.type === "model_input")?.payload;
    expect(JSON.stringify(lastInput)).toContain('"toolCallId":"call-2"');
    expect(JSON.stringify(lastInput)).not.toContain("call-3");

    const replay = blackbox({ mode: "replay", cassette: out, baseFetch: noNetwork, logErrors: false });
    expect(await weatherAgent(anthropicClient(replay), replay.tools({ weather: weatherTool({}).fn }))).toBe("Paris is warmest.");
    await expect(replay.finish()).resolves.toMatchObject({ status: "success" });
  });

  it("records the arguments a tool was actually called with, and strict replay checks them", async () => {
    const { path } = await recordWeather();
    expect(readTrace(path).steps[2].payload).toEqual({ toolCallId: "call-0", toolName: "weather", toolInput: { city: "Paris" } });

    const bb = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    const client = anthropicClient(bb);
    const tools = bb.tools({ weather: weatherTool({}).fn });
    const first = await client.messages.create({
      model: "claude-sonnet-5", max_tokens: 512, system: "Answer in one sentence.",
      tools: [{ name: "weather", description: "Current weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }],
      messages: [{ role: "user", content: "Is Paris or Rome warmer today?" }],
    });
    expect(first.stop_reason).toBe("tool_use");
    await expect(tools.weather({ city: "Oslo" })).rejects.toBeInstanceOf(ReplayDivergenceError);
    await expect(bb.finish()).rejects.toThrow(/tool weather input/);
  });

  it("a fork fails when the agent skips a call recorded before the fork point", async () => {
    const { path } = await recordWeather();
    const bb = blackbox({
      mode: "fork", cassette: path, out: tmp("skip"), forkAt: 5, forkSet: { city: "Rome", temp: 0 }, continueWith: "script",
      script: [{ type: "final_answer", text: "x" }], baseFetch: noNetwork, logErrors: false,
    });
    const client = anthropicClient(bb);
    const tools = bb.tools({ weather: weatherTool({}).fn });
    const request = {
      model: "claude-sonnet-5", max_tokens: 512, system: "Answer in one sentence.",
      tools: [{ name: "weather", description: "Current weather", input_schema: { type: "object" as const, properties: { city: { type: "string" } } } }],
      messages: [{ role: "user" as const, content: "Is Paris or Rome warmer today?" }],
    };
    const first = await client.messages.create(request);
    const rome = first.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && (b.input as { city: string }).city === "Rome")!;
    await tools.weather({ city: "Rome" }); // Paris (recorded before step 5) is never run
    await expect(
      client.messages.create({
        ...request,
        messages: [
          ...request.messages,
          { role: "assistant", content: first.content },
          { role: "user", content: [{ type: "tool_result", tool_use_id: rome.id, content: "{}" }] },
        ],
      }),
    ).rejects.toThrow(/\[blackbox\]/);
    await expect(bb.finish()).rejects.toThrow(/moved on without running it/);
  });

  it("refuses to write a short API key taken from the request headers", async () => {
    const path = tmp("short-key");
    const bb = blackbox({ mode: "record", out: path, baseFetch: upstream([PARALLEL_WEATHER, FINAL]).fetch, logErrors: false });
    const client = new Anthropic({ apiKey: "k7proxy", fetch: bb.fetch, maxRetries: 0 });
    const leaky: Weather = async ({ city }) => ({ city, temp: 1, note: "k7proxy" }) as unknown as { city: string; temp: number };
    await weatherAgent(client, bb.tools({ weather: leaky }));
    await expect(bb.finish()).rejects.toThrow(/contains your API key/);
  });

  it("masks known keys in divergence errors, including repeated ones", async () => {
    const { path } = await recordWeather();
    const secret = "proxy-secret-4242";
    const bb = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    const client = new Anthropic({ apiKey: secret, fetch: bb.fetch, maxRetries: 0 });
    const tools = bb.tools({ weather: weatherTool({}).fn });
    const first = await weatherAgent(client, tools, `my key is ${secret}`).then(() => "", (e: unknown) => String(e));
    const second = await client.messages.create({ model: "m", max_tokens: 1, messages: [{ role: "user", content: "x" }] }).then(
      () => "",
      (e: unknown) => String(e),
    );
    const final = await bb.finish().then(() => "", (e: unknown) => String(e));
    for (const message of [first, second, final]) expect(message).not.toContain(secret);
    expect(second).toContain("[blackbox]");
    expect(final).toContain("[redacted]");
  });

  it("refuses to record a response that interleaves text and tool calls (it would replay reordered)", async () => {
    const interleaved = anthropicMessage(
      [
        { type: "text", text: "First Paris." },
        { type: "tool_use", id: "toolu_01CCCCCCCCCCCCCCCCCCCCCC", name: "weather", input: { city: "Paris" } },
        { type: "text", text: "Then Rome." },
        { type: "tool_use", id: "toolu_01DDDDDDDDDDDDDDDDDDDDDD", name: "weather", input: { city: "Rome" } },
      ],
      "tool_use",
    );
    const path = tmp("interleaved");
    const rec = blackbox({ mode: "record", out: path, baseFetch: upstream([interleaved, FINAL]).fetch, logErrors: false });
    await expect(weatherAgent(anthropicClient(rec), rec.tools({ weather: weatherTool({ Paris: 1, Rome: 2 }).fn }))).rejects.toThrow(
      /more than one text block/,
    );
    const failure = await rec.finish().then(() => undefined, (e: unknown) => e);
    expect(failure).toBeInstanceOf(BlackboxUnsupportedError);
    expect(() => readFileSync(path)).toThrow();
  });

  it("refuses fork --live for a thinking-enabled request, before any network call", async () => {
    const path = tmp("thinking");
    const rec = blackbox({ mode: "record", out: path, baseFetch: upstream([PARALLEL_WEATHER, FINAL]).fetch, logErrors: false });
    const thinkingAgent = async (client: Anthropic, tools: { weather: Weather }): Promise<string> => {
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: "Paris or Rome?" }];
      for (let turn = 0; turn < 3; turn++) {
        const response = await client.messages.create({ model: "m", max_tokens: 2048, thinking: { type: "enabled", budget_tokens: 1024 }, messages });
        if (response.stop_reason !== "tool_use") return "done";
        messages.push({ role: "assistant", content: response.content });
        const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        messages.push({
          role: "user",
          content: await Promise.all(uses.map(async (b) => ({ type: "tool_result" as const, tool_use_id: b.id, content: JSON.stringify(await tools.weather(b.input as { city: string })) }))),
        });
      }
      return "too many";
    };
    await thinkingAgent(anthropicClient(rec), rec.tools({ weather: weatherTool({}).fn }));
    await rec.finish();

    const live = upstream([]);
    const bb = blackbox({ mode: "fork", cassette: path, out: tmp("thinking-fork"), forkAt: 5, forkSet: {}, continueWith: "live", baseFetch: live.fetch, logErrors: false });
    await expect(thinkingAgent(anthropicClient(bb), bb.tools({ weather: weatherTool({}).fn }))).rejects.toThrow(/extended thinking/);
    expect(live.calls).toBe(0);
  });

  it("rejects overlapping model calls in one session", async () => {
    const bb = blackbox({ mode: "record", out: tmp("overlap"), baseFetch: upstream([FINAL, FINAL]).fetch, logErrors: false });
    const client = anthropicClient(bb);
    const call = () => client.messages.create({ model: "m", max_tokens: 1, messages: [{ role: "user", content: "x" }] });
    const results = await Promise.allSettled([call(), call()]);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    await expect(bb.finish()).rejects.toThrow(/overlapping model calls/);
  });

  it("records nothing for a call the provider rejects, and the run stays incomplete", async () => {
    const path = tmp("401");
    const denied = new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "bad key" } }), {
      status: 401, headers: { "content-type": "application/json" },
    });
    const bb = blackbox({ mode: "record", out: path, baseFetch: upstream([denied]).fetch, logErrors: false });
    await expect(weatherAgent(anthropicClient(bb), bb.tools({ weather: weatherTool({}).fn }))).rejects.toThrow(/bad key/);
    await bb.finish({ error: new Error("authentication failed") });
    const trace = readTrace(path);
    expect(trace.steps.map((s) => s.type)).toEqual(["metadata"]);
    expect(replayTrace(trace)).toMatchObject({ status: "error", failureReason: "agent_error" });
  });
});

describe("pre-tag audit regressions", () => {
  const request = {
    model: "claude-sonnet-5", max_tokens: 512, system: "Answer in one sentence.",
    tools: [{ name: "weather", description: "Current weather", input_schema: { type: "object" as const, properties: { city: { type: "string" } } } }],
    messages: [{ role: "user" as const, content: "Is Paris or Rome warmer today?" }],
  };

  it("a fork that skipped a prefix call neither reaches the live API nor writes a cassette at exit", async () => {
    const { path } = await recordWeather();
    const live = upstream([FINAL]);
    const out = tmp("skip-live");
    const bb = blackbox({
      mode: "fork", cassette: path, out, forkAt: 5, forkSet: { city: "Rome", temp: 0 }, continueWith: "live",
      baseFetch: live.fetch, logErrors: false,
    });
    const client = anthropicClient(bb);
    const tools = bb.tools({ weather: weatherTool({}).fn });
    const first = await client.messages.create(request);
    const rome = first.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && (b.input as { city: string }).city === "Rome")!;
    await tools.weather({ city: "Rome" });
    await expect(
      client.messages.create({
        ...request,
        messages: [...request.messages, { role: "assistant", content: first.content }, { role: "user", content: [{ type: "tool_result", tool_use_id: rome.id, content: "{}" }] }],
      }),
    ).rejects.toThrow(/\[blackbox\]/);
    expect(live.calls).toBe(0);
    bb.writeOnExit(0);
    expect(() => readFileSync(out)).toThrow();
  });

  it("refuses a cassette containing even a very short known key", async () => {
    const bb = blackbox({ mode: "record", out: tmp("tiny-key"), baseFetch: upstream([PARALLEL_WEATHER, FINAL]).fetch, logErrors: false });
    const client = new Anthropic({ apiKey: "k3y", fetch: bb.fetch, maxRetries: 0 });
    const leaky: Weather = async ({ city }) => ({ city, temp: 1, note: "k3y" }) as unknown as { city: string; temp: number };
    await weatherAgent(client, bb.tools({ weather: leaky }));
    await expect(bb.finish()).rejects.toThrow(/contains your API key/);
  });

  it("records an explicit null argument and replays it unchanged", async () => {
    const path = tmp("null-arg");
    const rec = blackbox({ mode: "record", out: path, baseFetch: upstream([PARALLEL_WEATHER, FINAL]).fetch, logErrors: false });
    const nullAgent = async (bb: BlackboxSession, fn: (input: null) => Promise<unknown>): Promise<void> => {
      const client = anthropicClient(bb);
      const tools = bb.tools({ weather: fn });
      const first = await client.messages.create(request);
      const uses = first.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const results = [];
      for (const use of uses) results.push({ type: "tool_result" as const, tool_use_id: use.id, content: JSON.stringify(await tools.weather(null)) });
      await client.messages.create({ ...request, messages: [...request.messages, { role: "assistant", content: first.content }, { role: "user", content: results }] });
    };
    await nullAgent(rec, async () => ({ temp: 1 }));
    await rec.finish();
    expect(readTrace(path).steps[2].payload).toMatchObject({ toolInput: null });
    const replay = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    await nullAgent(replay, async () => ({ temp: -1 }));
    await expect(replay.finish()).resolves.toMatchObject({ status: "success" });
  });

  it("replays a wrapped tool the agent ran before its first model call", async () => {
    const path = tmp("preload");
    const preloadAgent = async (bb: BlackboxSession, profile: () => Promise<{ home: string }>): Promise<string> => {
      const tools = bb.tools({ profile, weather: weatherTool({ Paris: 18, Rome: 24 }).fn });
      const me = await tools.profile();
      return weatherAgent(anthropicClient(bb), tools, `I live in ${me.home}. Is Paris or Rome warmer today?`);
    };
    const rec = blackbox({ mode: "record", out: path, baseFetch: upstream([PARALLEL_WEATHER, FINAL]).fetch, logErrors: false });
    await preloadAgent(rec, async () => ({ home: "Lyon" }));
    await rec.finish();
    expect(readTrace(path).steps.slice(0, 3).map((s) => s.type)).toEqual(["tool_call", "tool_result", "model_input"]);
    const replay = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    let ran = false;
    expect(await preloadAgent(replay, async () => { ran = true; return { home: "never" }; })).toBe("Rome is warmer.");
    expect(ran).toBe(false);
    await expect(replay.finish()).resolves.toMatchObject({ status: "success" });
  });

  it("records OpenAI sampling penalties so strict replay notices when they change", async () => {
    const { normalizeOpenAIRequest } = await import("../src/integrations/openai.ts");
    const { ToolCallIds } = await import("../src/integrations/common.ts");
    const input = normalizeOpenAIRequest({ model: "m", messages: [], presence_penalty: 2, frequency_penalty: 0.5, logit_bias: { "50256": -100 } }, new ToolCallIds());
    expect(input["params"]).toEqual({ presencePenalty: 2, frequencyPenalty: 0.5, logitBias: { "50256": -100 } });
  });
});
