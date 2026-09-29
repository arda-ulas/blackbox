// Pure wire ↔ neutral translation tests for the provider integrations.
// JSON fixtures only: no SDK client, no fetch, no network.

import { describe, it, expect } from "vitest";
import { ToolCallIds } from "../src/integrations/common.ts";
import {
  normalizeAnthropicRequest,
  normalizeAnthropicResponse,
  synthesizeAnthropicResponse,
} from "../src/integrations/anthropic.ts";
import {
  normalizeOpenAIRequest,
  normalizeOpenAIResponse,
  synthesizeOpenAIResponse,
} from "../src/integrations/openai.ts";
import { BlackboxUnsupportedError } from "../src/errors.ts";
import { auditTraceNeutrality } from "../src/trace/neutrality.ts";
import { TraceRecorder } from "../src/trace/TraceRecorder.ts";
import type { JsonValue } from "../src/trace/TraceTypes.ts";

function neutral(...payloads: JsonValue[]): { ok: boolean; found: string[] } {
  const recorder = new TraceRecorder("audit", { createdAt: 0 });
  for (const payload of payloads) recorder.append("metadata", payload, 0);
  return auditTraceNeutrality(recorder.getTrace());
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

const anthropicResponse = {
  id: "msg_01XFDUDYJgAACzvnptvVoYEL",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5",
  content: [
    { type: "thinking", thinking: "private", signature: "sig" },
    { type: "text", text: "Let me check both.", citations: null },
    { type: "tool_use", id: "toolu_01A09q90qw90lq917835lq9", name: "weather", input: { city: "Paris" }, caller: { type: "direct" } },
    { type: "tool_use", id: "toolu_01B11q90qw90lq917835lq9", name: "weather", input: { city: "Rome" }, caller: { type: "direct" } },
  ],
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 20 },
};

describe("anthropic integration", () => {
  it("normalizes a response into a tool_calls output with call-N ids", () => {
    const ids = new ToolCallIds();
    const output = normalizeAnthropicResponse(anthropicResponse, ids);
    expect(output).toEqual({
      type: "tool_calls",
      text: "Let me check both.",
      calls: [
        { toolCallId: "call-0", toolName: "weather", toolInput: { city: "Paris" } },
        { toolCallId: "call-1", toolName: "weather", toolInput: { city: "Rome" } },
      ],
    });
    expect(neutral(output as unknown as JsonValue).ok).toBe(true);
  });

  it("normalizes a follow-up request, mapping provider ids through the session", () => {
    const ids = new ToolCallIds();
    normalizeAnthropicResponse(anthropicResponse, ids);
    const input = normalizeAnthropicRequest(
      {
        model: "claude-sonnet-5",
        max_tokens: 1024,
        temperature: 0,
        system: [{ type: "text", text: "Be terse.", cache_control: { type: "ephemeral" } }],
        tools: [{ name: "weather", description: "Get weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }],
        messages: [
          { role: "user", content: "Paris or Rome?" },
          { role: "assistant", content: anthropicResponse.content },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "toolu_01A09q90qw90lq917835lq9", content: '{"temp":18}' },
              { type: "tool_result", tool_use_id: "toolu_01B11q90qw90lq917835lq9", content: [{ type: "text", text: "boom" }], is_error: true },
            ],
          },
        ],
      },
      ids,
    );
    expect(input).toEqual({
      model: "claude-sonnet-5",
      systemPrompt: "Be terse.",
      params: { maxTokens: 1024, temperature: 0 },
      tools: [{ name: "weather", description: "Get weather", inputSchema: { type: "object", properties: { city: { type: "string" } } } }],
      messages: [
        { role: "user", content: "Paris or Rome?" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check both." },
            { type: "tool_use", toolCallId: "call-0", toolName: "weather", toolInput: { city: "Paris" } },
            { type: "tool_use", toolCallId: "call-1", toolName: "weather", toolInput: { city: "Rome" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", toolCallId: "call-0", toolName: "weather", result: '{"temp":18}' },
            { type: "tool_result", toolCallId: "call-1", toolName: "weather", error: "boom" },
          ],
        },
      ],
    });
    expect(neutral(input).ok).toBe(true);
  });

  it("round-trips: a synthesized response normalizes back to the recorded output", () => {
    const recorded = normalizeAnthropicResponse(anthropicResponse, new ToolCallIds());
    const replayIds = new ToolCallIds();
    const body = synthesizeAnthropicResponse(recorded, "claude-sonnet-5", "blackbox-replay-1");
    expect(body["stop_reason"]).toBe("tool_use");
    expect(normalizeAnthropicResponse(body, replayIds)).toEqual(recorded);
  });

  it("records truncation and refusal and replays them", () => {
    const ids = new ToolCallIds();
    const truncated = normalizeAnthropicResponse({ content: [{ type: "text", text: "Half" }], stop_reason: "max_tokens" }, ids);
    expect(truncated).toEqual({ type: "final_answer", text: "Half", stop: "length" });
    expect(synthesizeAnthropicResponse(truncated, "m", "r")["stop_reason"]).toBe("max_tokens");
    const refused = normalizeAnthropicResponse({ content: [{ type: "text", text: "No." }], stop_reason: "refusal" }, ids);
    expect(synthesizeAnthropicResponse(refused, "m", "r")["stop_reason"]).toBe("refusal");
  });

  it("rejects streaming, images and server tools with actionable errors", () => {
    const ids = new ToolCallIds();
    expect(() => normalizeAnthropicRequest({ stream: true, messages: [] }, ids)).toThrow(
      /streaming isn't supported yet; use the non-streaming call/,
    );
    expect(() =>
      normalizeAnthropicRequest({ messages: [{ role: "user", content: [{ type: "image", source: {} }] }] }, ids),
    ).toThrow(BlackboxUnsupportedError);
    expect(() =>
      normalizeAnthropicRequest({ messages: [], tools: [{ type: "web_search_20250305", name: "web_search" }] }, ids),
    ).toThrow(/server tool "web_search_20250305"/);
  });
});

// ---------------------------------------------------------------------------
// OpenAI Chat Completions
// ---------------------------------------------------------------------------

const openaiResponse = {
  id: "chatcmpl-B9MHDbslfkBeAs8l4bebGdFOJ6PeG",
  object: "chat.completion",
  created: 1_790_000_000,
  model: "gpt-5",
  system_fingerprint: "fp_abc",
  choices: [
    {
      index: 0,
      finish_reason: "tool_calls",
      logprobs: null,
      message: {
        role: "assistant",
        content: null,
        refusal: null,
        tool_calls: [
          { id: "call_Aq9vX1b2c3d4e5f6g7h8i9j0", type: "function", function: { name: "weather", arguments: '{"city":"Paris"}' } },
          { id: "call_Bq9vX1b2c3d4e5f6g7h8i9j0", type: "function", function: { name: "weather", arguments: "not json" } },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
};

describe("openai integration", () => {
  it("normalizes tool calls, parsing arguments and keeping unparsable ones as strings", () => {
    const output = normalizeOpenAIResponse(openaiResponse, new ToolCallIds());
    expect(output).toEqual({
      type: "tool_calls",
      calls: [
        { toolCallId: "call-0", toolName: "weather", toolInput: { city: "Paris" } },
        { toolCallId: "call-1", toolName: "weather", toolInput: "not json" },
      ],
    });
  });

  it("normalizes a follow-up request: system prompt, grouped tool results, params", () => {
    const ids = new ToolCallIds();
    normalizeOpenAIResponse(openaiResponse, ids);
    const input = normalizeOpenAIRequest(
      {
        model: "gpt-5",
        max_completion_tokens: 500,
        tool_choice: "auto",
        tools: [{ type: "function", function: { name: "weather", description: "Get weather", parameters: { type: "object" } } }],
        messages: [
          { role: "system", content: "Be terse." },
          { role: "developer", content: [{ type: "text", text: "Use Celsius." }] },
          { role: "user", content: "Paris or Rome?" },
          { role: "assistant", content: null, tool_calls: openaiResponse.choices[0].message.tool_calls },
          { role: "tool", tool_call_id: "call_Aq9vX1b2c3d4e5f6g7h8i9j0", content: '{"temp":18}' },
          { role: "tool", tool_call_id: "call_Bq9vX1b2c3d4e5f6g7h8i9j0", content: "error: bad args" },
        ],
      },
      ids,
    );
    expect(input).toEqual({
      model: "gpt-5",
      systemPrompt: "Be terse.\n\nUse Celsius.",
      params: { maxTokens: 500, toolChoice: "auto" },
      tools: [{ name: "weather", description: "Get weather", inputSchema: { type: "object" } }],
      messages: [
        { role: "user", content: "Paris or Rome?" },
        {
          role: "assistant",
          content: [
            { type: "tool_use", toolCallId: "call-0", toolName: "weather", toolInput: { city: "Paris" } },
            { type: "tool_use", toolCallId: "call-1", toolName: "weather", toolInput: "not json" },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", toolCallId: "call-0", toolName: "weather", result: '{"temp":18}' },
            { type: "tool_result", toolCallId: "call-1", toolName: "weather", result: "error: bad args" },
          ],
        },
      ],
    });
    expect(neutral(input).ok).toBe(true);
  });

  it("round-trips: a synthesized completion normalizes back to the recorded output", () => {
    const recorded = normalizeOpenAIResponse(openaiResponse, new ToolCallIds());
    const body = synthesizeOpenAIResponse(recorded, "gpt-5", "blackbox-replay-1", 1_790_000_000);
    expect((body["choices"] as Array<{ finish_reason: string }>)[0].finish_reason).toBe("tool_calls");
    expect(normalizeOpenAIResponse(body, new ToolCallIds())).toEqual(recorded);
  });

  it("records a refusal and a truncated answer", () => {
    const refusal = normalizeOpenAIResponse(
      { choices: [{ finish_reason: "stop", message: { role: "assistant", content: null, refusal: "I can't help." } }] },
      new ToolCallIds(),
    );
    expect(refusal).toEqual({ type: "final_answer", text: "I can't help.", stop: "refusal" });
    const body = synthesizeOpenAIResponse(refusal, "gpt-5", "r", 0);
    const message = (body["choices"] as Array<{ message: Record<string, unknown> }>)[0].message;
    expect(message["refusal"]).toBe("I can't help.");
    expect(message["content"]).toBeNull();

    const truncated = normalizeOpenAIResponse(
      { choices: [{ finish_reason: "length", message: { role: "assistant", content: "Half" } }] },
      new ToolCallIds(),
    );
    expect(truncated).toEqual({ type: "final_answer", text: "Half", stop: "length" });
  });

  it("rejects streaming, n > 1, late system messages and image parts", () => {
    const ids = new ToolCallIds();
    expect(() => normalizeOpenAIRequest({ stream: true, messages: [] }, ids)).toThrow(/use the non-streaming call/);
    expect(() => normalizeOpenAIRequest({ n: 2, messages: [] }, ids)).toThrow(/n > 1/);
    expect(() =>
      normalizeOpenAIRequest({ messages: [{ role: "user", content: "hi" }, { role: "system", content: "late" }] }, ids),
    ).toThrow(/system message after the conversation starts/);
    expect(() =>
      normalizeOpenAIRequest({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "x" } }] }] }, ids),
    ).toThrow(BlackboxUnsupportedError);
  });
});
