import { describe, expect, it } from "vitest";
import {
  adaptClaudeCodeTranscript,
  ClaudeCodeTranscriptError,
  parseClaudeCodeJsonl,
} from "../src/ingest/claudeCodeTranscript.ts";
import { validateTrace, replayTrace } from "../src/replay/CassetteReplay.ts";
import { verifyTrace } from "../src/trace/verifyTrace.ts";
import { toolCallSequence } from "../src/trace/traceOutcome.ts";

const timestamp = (second: number): string => `2026-07-24T17:20:${String(second).padStart(2, "0")}.000Z`;

function event(type: "user" | "assistant", second: number, message: Record<string, unknown>) {
  return {
    type,
    timestamp: timestamp(second),
    sessionId: "provider-session-id",
    uuid: `provider-message-${second}`,
    message,
  };
}

function oneToolTranscript(): unknown[] {
  return [
    { type: "system", subtype: "init", usage: { input_tokens: 1 } },
    event("user", 0, { role: "user", content: "Inspect the project and fix the failing test." }),
    event("assistant", 1, {
      role: "assistant",
      model: "provider-model",
      stop_reason: "tool_use",
      usage: { output_tokens: 10 },
      content: [{ type: "thinking", thinking: "private reasoning", signature: "provider-signature" }],
    }),
    event("assistant", 2, {
      role: "assistant",
      model: "provider-model",
      stop_reason: "tool_use",
      usage: { output_tokens: 5 },
      content: [{ type: "tool_use", id: "toolu_native_123", name: "Read", input: { file_path: "src/app.ts" } }],
    }),
    {
      ...event("user", 3, {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_native_123", content: '{"line":1,"text":"bug"}' }],
      }),
      toolUseResult: { provider: "metadata that must not cross" },
    },
    event("assistant", 4, {
      role: "assistant",
      model: "provider-model",
      stop_reason: "end_turn",
      usage: { output_tokens: 12 },
      content: [{ type: "text", text: "Fixed the bug and the tests pass." }],
    }),
  ];
}

describe("adaptClaudeCodeTranscript", () => {
  it("adapts sequential real-format blocks into a valid neutral v2 trace", () => {
    const source = oneToolTranscript();
    const before = structuredClone(source);
    const trace = adaptClaudeCodeTranscript(source, { traceId: "claude-root-session" });

    expect(source).toEqual(before);
    expect(trace.steps.map((step) => step.type)).toEqual([
      "model_input",
      "model_output",
      "tool_call",
      "tool_result",
      "model_input",
      "model_output",
      "metadata",
    ]);
    expect(toolCallSequence(trace)).toEqual(["Read"]);
    expect(replayTrace(trace)).toMatchObject({
      status: "success",
      result: "Fixed the bug and the tests pass.",
    });
    expect(verifyTrace(trace).pass).toBe(true);
    expect(() => validateTrace(trace)).not.toThrow();

    const serialized = JSON.stringify(trace);
    for (const providerValue of [
      "toolu_native_123",
      "provider-session-id",
      "provider-message",
      "provider-model",
      "private reasoning",
      "provider-signature",
      "input_tokens",
      "output_tokens",
      "stop_reason",
      "toolUseResult",
    ]) {
      expect(serialized).not.toContain(providerValue);
    }
  });

  it("is byte-deterministic for the same source", () => {
    const first = adaptClaudeCodeTranscript(oneToolTranscript(), { traceId: "deterministic" });
    const second = adaptClaudeCodeTranscript(oneToolTranscript(), { traceId: "deterministic" });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("repairs the evidenced adjacent persisted result/use inversion", () => {
    const source = oneToolTranscript();
    const result = source[4] as Record<string, unknown>;
    const use = source[3] as Record<string, unknown>;
    result.parentUuid = use.uuid;
    [source[3], source[4]] = [result, use];

    const trace = adaptClaudeCodeTranscript(source, { traceId: "inverted-pair" });
    expect(toolCallSequence(trace)).toEqual(["Read"]);
    expect(verifyTrace(trace).pass).toBe(true);
  });

  it("preserves a recoverable tool error and a later successful retry", () => {
    const source = oneToolTranscript();
    const firstResult = source[4] as Record<string, unknown>;
    const firstMessage = firstResult.message as Record<string, unknown>;
    const firstBlocks = firstMessage.content as Record<string, unknown>[];
    firstBlocks[0].is_error = true;
    firstBlocks[0].content = "temporary read failure";
    source.splice(5, 0,
      event("assistant", 4, {
        role: "assistant",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "toolu_retry", name: "Read", input: { file_path: "src/app.ts" } }],
      }),
      event("user", 5, {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_retry", content: "retry succeeded" }],
      }),
    );
    (source[7] as Record<string, unknown>).timestamp = timestamp(6);

    const trace = adaptClaudeCodeTranscript(source, { traceId: "retry" });
    expect(toolCallSequence(trace)).toEqual(["Read", "Read"]);
    expect(trace.steps[3].payload).toMatchObject({ error: "temporary read failure" });
    expect(verifyTrace(trace).pass).toBe(true);
  });

  it("rejects parallel tool calls instead of flattening them", () => {
    const source = oneToolTranscript();
    const assistant = source[3] as Record<string, unknown>;
    const message = assistant.message as Record<string, unknown>;
    const blocks = message.content as Record<string, unknown>[];
    blocks.push({ type: "tool_use", id: "toolu_native_456", name: "Bash", input: { command: "npm test" } });
    expect(() => adaptClaudeCodeTranscript(source, { traceId: "parallel" })).toThrow(/parallel tool calls/);
  });

  it("rejects sidechain messages", () => {
    const sidechain = oneToolTranscript();
    (sidechain[3] as Record<string, unknown>).isSidechain = true;
    expect(() => adaptClaudeCodeTranscript(sidechain, { traceId: "sidechain" })).toThrow(/sidechain/);
  });

  it("carries a follow-up human turn into the next recorded model input", () => {
    const followUp = oneToolTranscript();
    followUp.splice(5, 0, event("user", 4, { role: "user", content: "One more change." }));
    (followUp[6] as Record<string, unknown>).timestamp = timestamp(5);
    const trace = adaptClaudeCodeTranscript(followUp, { traceId: "follow-up" });
    const finalInput = trace.steps.at(-3)?.payload as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(finalInput.messages.at(-1)).toEqual({ role: "user", content: "One more change." });
    expect(verifyTrace(trace).pass).toBe(true);
  });

  it("parses JSONL and reports the exact invalid line", () => {
    expect(parseClaudeCodeJsonl('{"type":"system"}\n{"type":"user"}')).toHaveLength(2);
    expect(() => parseClaudeCodeJsonl('{"ok":true}\nnot-json')).toThrow(
      new ClaudeCodeTranscriptError("Claude Code JSONL line 2 is not valid JSON"),
    );
  });
});
