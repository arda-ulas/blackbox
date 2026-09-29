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

  it("adapts parallel tool calls in one block list into a single tool_calls turn", () => {
    const source = oneToolTranscript();
    const assistant = source[3] as Record<string, unknown>;
    const message = assistant.message as Record<string, unknown>;
    (message.content as Record<string, unknown>[]).push({
      type: "tool_use", id: "toolu_native_456", name: "Bash", input: { command: "npm test" },
    });
    const resultMessage = (source[4] as Record<string, unknown>).message as Record<string, unknown>;
    (resultMessage.content as Record<string, unknown>[]).push({
      type: "tool_result", tool_use_id: "toolu_native_456", content: "1 passing",
    });

    const trace = adaptClaudeCodeTranscript(source, { traceId: "parallel" });
    expect(trace.steps[1].payload).toEqual({
      type: "tool_calls",
      calls: [
        { toolCallId: "call-0", toolName: "Read", toolInput: { file_path: "src/app.ts" } },
        { toolCallId: "call-1", toolName: "Bash", toolInput: { command: "npm test" } },
      ],
    });
    expect(trace.steps.map((step) => step.type).slice(0, 6)).toEqual([
      "model_input", "model_output", "tool_call", "tool_result", "tool_call", "tool_result",
    ]);
    expect(toolCallSequence(trace)).toEqual(["Read", "Bash"]);
    expect(verifyTrace(trace).pass).toBe(true);
  });

  it("merges one API message persisted across lines, with results interleaved", () => {
    // Claude Code's real layout: one content block per line, sharing message.id,
    // each tool result on its own user line written as soon as the tool finished.
    const msg = (content: Record<string, unknown>[]) => ({
      role: "assistant", id: "provider-api-message", stop_reason: "tool_use", content,
    });
    const source = [
      event("user", 0, { role: "user", content: "Check both files." }),
      event("assistant", 1, msg([{ type: "thinking", thinking: "private", signature: "sig" }])),
      event("assistant", 2, msg([{ type: "text", text: "Reading both." }])),
      event("assistant", 3, msg([{ type: "tool_use", id: "toolu_a1", name: "Read", input: { file_path: "a.ts" } }])),
      event("user", 4, { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_b2", content: "B" }] }),
      event("assistant", 5, msg([{ type: "tool_use", id: "toolu_b2", name: "Read", input: { file_path: "b.ts" } }])),
      event("user", 6, { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_a1", content: [{ type: "text", text: "A" }] }] }),
      event("assistant", 7, { role: "assistant", id: "provider-api-message-2", stop_reason: "end_turn", content: [{ type: "text", text: "Both read." }] }),
    ];

    const trace = adaptClaudeCodeTranscript(source, { traceId: "split-lines" });
    expect(trace.steps.map((step) => step.type)).toEqual([
      "model_input", "model_output", "tool_call", "tool_result", "tool_call", "tool_result",
      "model_input", "model_output", "metadata",
    ]);
    expect(trace.steps[1].payload).toMatchObject({ type: "tool_calls", text: "Reading both." });
    expect(trace.steps[3].payload).toMatchObject({ toolCallId: "call-0", result: "A" });
    expect(trace.steps[5].payload).toMatchObject({ toolCallId: "call-1", result: "B" });
    const secondInput = trace.steps[6].payload as { messages: Array<{ role: string; content: unknown }> };
    expect(secondInput.messages[1].content).toEqual([
      { type: "text", text: "Reading both." },
      { type: "tool_use", toolCallId: "call-0", toolName: "Read", toolInput: { file_path: "a.ts" } },
      { type: "tool_use", toolCallId: "call-1", toolName: "Read", toolInput: { file_path: "b.ts" } },
    ]);
    expect(verifyTrace(trace).pass).toBe(true);
    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain("provider-api-message");
    expect(serialized).not.toContain("toolu_a1");
  });

  it("records intermediate answers in a multi-turn session and ends on the last one", () => {
    const source = oneToolTranscript();
    source.push(
      event("user", 5, { role: "user", content: [{ type: "text", text: "Now summarize." }] }),
      event("assistant", 6, { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "Summary." }] }),
    );
    const trace = adaptClaudeCodeTranscript(source, { traceId: "multi-turn" });
    const finalInput = trace.steps.at(-3)?.payload as { messages: Array<{ role: string; content: unknown }> };
    expect(finalInput.messages.slice(-2)).toEqual([
      { role: "assistant", content: "Fixed the bug and the tests pass." },
      { role: "user", content: "Now summarize." },
    ]);
    expect(replayTrace(trace)).toMatchObject({ status: "success", result: "Summary." });
  });

  it("leaves a session that ends after a tool round incomplete", () => {
    const source = oneToolTranscript().slice(0, 5);
    const trace = adaptClaudeCodeTranscript(source, { traceId: "cut" });
    expect(trace.steps.at(-1)?.type).toBe("tool_result");
    expect(replayTrace(trace).status).toBe("incomplete");
  });

  it("rejects a tool call whose result never arrives before a later turn", () => {
    const source = oneToolTranscript();
    source.splice(4, 1);
    expect(() => adaptClaudeCodeTranscript(source, { traceId: "missing" })).toThrow(/no result for "Read"/);
  });

  it("ends incomplete when the session stops while its last tool is running", () => {
    const source = oneToolTranscript().slice(0, 4);
    const trace = adaptClaudeCodeTranscript(source, { traceId: "running" });
    expect(trace.steps.map((step) => step.type)).toEqual(["model_input", "model_output", "tool_call"]);
    expect(replayTrace(trace).status).toBe("incomplete");
    expect(verifyTrace(trace).pass).toBe(true);
  });

  it("keeps completed results of a parallel round the session stopped in", () => {
    const source = [
      event("user", 0, { role: "user", content: "Check both." }),
      event("assistant", 1, { role: "assistant", id: "m1", content: [{ type: "tool_use", id: "toolu_a", name: "Read", input: { file_path: "a" } }] }),
      event("assistant", 2, { role: "assistant", id: "m1", content: [{ type: "tool_use", id: "toolu_b", name: "Read", input: { file_path: "b" } }] }),
      event("user", 3, { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_b", content: "B" }] }),
    ];
    const trace = adaptClaudeCodeTranscript(source, { traceId: "partial" });
    expect(trace.steps.map((step) => step.type)).toEqual(["model_input", "model_output", "tool_call", "tool_call", "tool_result"]);
    expect(trace.steps[4].payload).toMatchObject({ toolCallId: "call-1", result: "B" });
    expect(replayTrace(trace).status).toBe("incomplete");
  });

  it("skips sidechain (subagent) lines entirely", () => {
    const source = oneToolTranscript();
    source.splice(5, 0,
      { ...event("assistant", 4, { role: "assistant", content: [{ type: "tool_use", id: "toolu_sub", name: "Grep", input: {} }] }), isSidechain: true },
      { ...event("user", 4, { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_sub", content: "x" }] }), isSidechain: true },
    );
    const trace = adaptClaudeCodeTranscript(source, { traceId: "sidechain" });
    expect(toolCallSequence(trace)).toEqual(["Read"]);
    expect(JSON.stringify(trace)).not.toContain("Grep");
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
