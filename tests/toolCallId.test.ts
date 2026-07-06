import { describe, it, expect } from "vitest";
import { toolCallIdForIndex } from "../src/agent/toolCallId.ts";
import type { Message, MessagePart } from "../src/agent/modelClient.ts";
import type { JsonValue } from "../src/trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// toolCallIdForIndex — deterministic, provider-neutral correlation ids
// ---------------------------------------------------------------------------

describe("toolCallIdForIndex", () => {
  it("returns deterministic ids for valid indexes", () => {
    expect(toolCallIdForIndex(0)).toBe("call-0");
    expect(toolCallIdForIndex(1)).toBe("call-1");
    expect(toolCallIdForIndex(42)).toBe("call-42");
  });

  it("is a pure function — same index always yields the same id", () => {
    expect(toolCallIdForIndex(3)).toBe(toolCallIdForIndex(3));
  });

  it("rejects negative indexes", () => {
    expect(() => toolCallIdForIndex(-1)).toThrow(/non-negative integer/);
  });

  it("rejects non-integer indexes", () => {
    expect(() => toolCallIdForIndex(1.5)).toThrow(/non-negative integer/);
  });

  it("rejects non-finite indexes", () => {
    expect(() => toolCallIdForIndex(Number.NaN)).toThrow(/non-negative integer/);
    expect(() => toolCallIdForIndex(Number.POSITIVE_INFINITY)).toThrow(/non-negative integer/);
  });
});

// ---------------------------------------------------------------------------
// Message.content — string still works, structured parts are accepted
//
// These are type-level acceptance checks: they must compile and hold at
// runtime. They do NOT exercise the agent loop (which still emits legacy
// string content until W4-D2).
// ---------------------------------------------------------------------------

describe("Message content (W4-D1 structured transcript types)", () => {
  it("accepts plain string content", () => {
    const msg: Message = { role: "user", content: "hello" };
    expect(typeof msg.content).toBe("string");
  });

  it("accepts structured MessagePart[] content", () => {
    const msg: Message = {
      role: "assistant",
      content: [{ type: "text", text: "thinking" }],
    };
    expect(Array.isArray(msg.content)).toBe(true);
  });
});

describe("MessagePart union", () => {
  it("supports a text part", () => {
    const part: MessagePart = { type: "text", text: "hi" };
    expect(part.type).toBe("text");
  });

  it("supports a tool_use part with provider-neutral toolCallId", () => {
    const input: JsonValue = { query: "weekend hotels" };
    const part: MessagePart = {
      type: "tool_use",
      toolCallId: toolCallIdForIndex(0),
      toolName: "search",
      toolInput: input,
    };
    expect(part).toEqual({
      type: "tool_use",
      toolCallId: "call-0",
      toolName: "search",
      toolInput: { query: "weekend hotels" },
    });
  });

  it("supports a tool_result part carrying a result value", () => {
    const result: JsonValue = { results: [] };
    const part: MessagePart = {
      type: "tool_result",
      toolCallId: "call-0",
      toolName: "search",
      result,
    };
    // The success variant carries `result`, not `error`.
    expect(part.type).toBe("tool_result");
    expect("result" in part).toBe(true);
  });

  it("supports a tool_result part carrying an error string", () => {
    const part: MessagePart = {
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "flights",
      error: "Unknown fixture tool",
    };
    expect(part.type).toBe("tool_result");
    expect("error" in part).toBe(true);
  });

  it("correlates a tool_use and its tool_result by identical toolCallId", () => {
    const id = toolCallIdForIndex(2);
    const use: MessagePart = { type: "tool_use", toolCallId: id, toolName: "booking", toolInput: {} };
    const res: MessagePart = { type: "tool_result", toolCallId: id, toolName: "booking", result: { confirmed: true } };
    expect(use.toolCallId).toBe(res.toolCallId);
  });
});
