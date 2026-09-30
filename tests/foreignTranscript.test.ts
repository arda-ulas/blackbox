// Foreign transcript adapter tests (W10-A) — adapter-boundary proof.
//
// The adapter converts a synthetic, chat-style external transcript into a normal
// Blackbox v2 Trace. These tests prove:
//   - the exact step grammar and deterministic, byte-stable output,
//   - the in-memory conversion matches the COMMITTED golden cassette byte-for-byte
//     (the golden is READ-ONLY here — never written/updated by the tests),
//   - provider-native noise (ids, usage, finish_reason, model, foreign call ids)
//     never crosses the boundary into the trace,
//   - the converted cassette flows through the UNCHANGED core (validate / verify /
//     replay / terminalOutcome / toolCallSequence / assertCassette),
//   - malformed input is rejected deterministically.
// Everything is offline, deterministic, zero live calls.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  adaptForeignTranscript,
  ForeignTranscriptError,
} from "../src/ingest/foreignTranscript.ts";
import { loadTrace, validateTrace, replayTrace } from "../src/replay/CassetteReplay.ts";
import { verifyTrace } from "../src/trace/verifyTrace.ts";
import { auditTraceNeutrality, NEUTRALITY_FORBIDDEN } from "../src/trace/neutrality.ts";
import { terminalOutcome, toolCallSequence } from "../src/trace/traceOutcome.ts";
import { assertCassette } from "../src/workflow/assertCassette.ts";
import { CURRENT_TRACE_VERSION, type Trace } from "../src/trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// Paths + constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const EXTERNAL_DIR = join(PROJECT_ROOT, "fixtures", "external");
const FOREIGN_PATH = join(EXTERNAL_DIR, "chat-tool-use.foreign.json");
const CONVERTED_PATH = join(EXTERNAL_DIR, "chat-tool-use.converted.v2.json");

/** Blackbox trace id used for the committed golden cassette. */
const TRACE_ID = "external-chat-tool-use";

/** Frozen hash of the terminal (metadata) step of the golden conversion. */
const FROZEN_FINAL_HASH =
  "e3837b693496eb0df4b34183a220bc41522ae2e4fb73f0c8336aabd3bf4bec76";

const FINAL_ANSWER =
  "The weather in Paris is 17C and partly cloudy. I've emailed a short summary to alex@example.com.";

/** Serialize exactly as saveTrace / the committed golden file do (no trailing newline). */
function serialize(trace: Trace): string {
  return JSON.stringify(trace, null, 2);
}

function readForeign(): unknown {
  return JSON.parse(readFileSync(FOREIGN_PATH, "utf8"));
}

function convert(): Trace {
  return adaptForeignTranscript(readForeign(), { traceId: TRACE_ID });
}

// A minimal, valid single-tool-round transcript, freshly built each call so
// malformed-case mutations never leak between tests.
function validTranscript(): Record<string, unknown> {
  return {
    tools: [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Look up weather.",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      },
    ],
    messages: [
      { id: "m0", role: "user", timestamp: 1000, content: "What's the weather in Paris?" },
      {
        id: "m1",
        role: "assistant",
        timestamp: 1001,
        content: null,
        tool_calls: [
          {
            id: "call_x1",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"Paris"}' },
          },
        ],
      },
      {
        id: "m2",
        role: "tool",
        timestamp: 1002,
        tool_call_id: "call_x1",
        name: "get_weather",
        content: '{"temperature_c":17}',
      },
      { id: "m3", role: "assistant", timestamp: 1003, content: "It is 17C in Paris." },
    ],
  };
}

// ---------------------------------------------------------------------------
// Happy path: shape, ids, determinism, golden bytes
// ---------------------------------------------------------------------------

describe("adaptForeignTranscript — happy path", () => {
  it("produces the exact 11-step type sequence for a two-tool run", () => {
    const trace = convert();
    expect(trace.version).toBe(CURRENT_TRACE_VERSION);
    expect(trace.id).toBe(TRACE_ID);
    expect(trace.steps.map((s) => s.type)).toEqual([
      "model_input",
      "model_output",
      "tool_call",
      "tool_result",
      "model_input",
      "model_output",
      "tool_call",
      "tool_result",
      "model_input",
      "model_output",
      "metadata",
    ]);
  });

  it("remaps foreign call ids to deterministic call-0 / call-1", () => {
    const trace = convert();
    const toolCallSteps = trace.steps.filter((s) => s.type === "tool_call");
    expect(toolCallSteps.map((s) => (s.payload as { toolCallId: string }).toolCallId)).toEqual([
      "call-0",
      "call-1",
    ]);
    // The model_output tool-call steps carry the same ids in order.
    const outputCallIds = trace.steps
      .filter((s) => s.type === "model_output")
      .map((s) => (s.payload as { toolCallId?: string }).toolCallId)
      .filter((v): v is string => v !== undefined);
    expect(outputCallIds).toEqual(["call-0", "call-1"]);
  });

  it("preserves tool names and parsed tool inputs", () => {
    const trace = convert();
    const calls = trace.steps.filter((s) => s.type === "tool_call").map((s) => s.payload as {
      toolName: string;
      toolInput: unknown;
    });
    expect(calls[0].toolName).toBe("get_weather");
    expect(calls[0].toolInput).toEqual({ city: "Paris" });
    expect(calls[1].toolName).toBe("send_email");
    expect(calls[1].toolInput).toEqual({
      to: "alex@example.com",
      subject: "Paris weather",
      body: "It is 17C and partly cloudy in Paris.",
    });
  });

  it("carries createdAt and step timestamps from the source transcript (no clock)", () => {
    const trace = convert();
    expect(trace.createdAt).toBe(1710500000000);
    expect(trace.steps.map((s) => s.timestamp)).toEqual([
      1710500000500, 1710500000500, 1710500000500, 1710500001000, 1710500001500,
      1710500001500, 1710500001500, 1710500002000, 1710500002500, 1710500002500,
      1710500002500,
    ]);
  });

  it("is deterministic: repeated conversion is deeply equal and byte-identical", () => {
    const a = convert();
    const b = convert();
    expect(a).toEqual(b);
    expect(serialize(a)).toBe(serialize(b));
  });

  it("matches the committed golden cassette byte-for-byte", () => {
    const inMemory = serialize(convert());
    const committed = readFileSync(CONVERTED_PATH, "utf8");
    expect(inMemory).toBe(committed);
  });

  it("freezes the terminal-step hash as a literal constant", () => {
    const trace = convert();
    const last = trace.steps.at(-1)!;
    expect(last.type).toBe("metadata");
    expect(last.hash).toBe(FROZEN_FINAL_HASH);
  });

  it("does not mutate the source input", () => {
    const input = readForeign();
    const before = JSON.stringify(input);
    adaptForeignTranscript(input, { traceId: TRACE_ID });
    expect(JSON.stringify(input)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Neutrality: no foreign / provider-native leakage into the trace
// ---------------------------------------------------------------------------

describe("adaptForeignTranscript — provider neutrality", () => {
  it("persists get_weather and send_email but not foreign call ids", () => {
    const serialized = serialize(convert());
    expect(serialized).toContain("get_weather");
    expect(serialized).toContain("send_email");
    expect(serialized).not.toContain("call_a1B2c3");
    expect(serialized).not.toContain("call_d4E5f6");
  });

  it("drops provider-noise keys and sentinel values entirely", () => {
    const serialized = serialize(convert());
    for (const sentinel of [
      "usage",
      "finish_reason",
      "chatcmpl",
      "conversation_id",
      "system_fingerprint",
      "_provider_meta",
      "synthetic-chat-model",
      "vendor-run-abc123",
      "fp_synthetic_0007",
      "msg_0001",
      "msg_",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it("passes the structured neutrality audit (no forbidden markers)", () => {
    const audit = auditTraceNeutrality(convert());
    expect(audit.ok).toBe(true);
    expect(audit.found).toEqual([]);
  });

  it("contains none of the NEUTRALITY_FORBIDDEN markers as raw text", () => {
    const serialized = serialize(convert());
    for (const marker of NEUTRALITY_FORBIDDEN) {
      expect(serialized).not.toContain(marker);
    }
  });
});

// ---------------------------------------------------------------------------
// Pipeline: the converted cassette flows through the UNCHANGED core
// ---------------------------------------------------------------------------

describe("adaptForeignTranscript — flows through the core unchanged", () => {
  it("validates as a hash-chained trace", () => {
    expect(() => validateTrace(convert())).not.toThrow();
  });

  it("loadTrace reads the committed golden cassette equal to the in-memory conversion", async () => {
    const loaded = await loadTrace(CONVERTED_PATH);
    expect(loaded).toEqual(convert());
  });

  it("verifyTrace passes all four invariants", () => {
    const report = verifyTrace(convert());
    expect(report.pass).toBe(true);
    expect(report.invariants.map((i) => `${i.name}:${i.status}`)).toEqual([
      "schema_version:pass",
      "hash_chain:pass",
      "provider_neutrality:pass",
      "replayability:pass",
    ]);
  });

  it("replayTrace returns success and the final answer, fully offline", () => {
    const summary = replayTrace(convert());
    expect(summary.status).toBe("success");
    expect(summary.result).toBe(FINAL_ANSWER);
    expect(summary.stepCount).toBe(11);
  });

  it("terminalOutcome reports success and the final answer", () => {
    const outcome = terminalOutcome(convert());
    expect(outcome.status).toBe("success");
    expect(outcome.finalAnswer).toBe(FINAL_ANSWER);
  });

  it("toolCallSequence returns the ordered foreign tool names", () => {
    expect(toolCallSequence(convert())).toEqual(["get_weather", "send_email"]);
  });

  it("assertCassette passes with the expected status and tool sequence", () => {
    const report = assertCassette(convert(), {
      expectStatus: "success",
      expectTools: ["get_weather", "send_email"],
    });
    expect(report.pass).toBe(true);
  });

  it("assertCassette fails on the wrong tool order", () => {
    const report = assertCassette(convert(), {
      expectStatus: "success",
      expectTools: ["send_email", "get_weather"],
    });
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.kind).toBe("expectation");
  });
});

// ---------------------------------------------------------------------------
// Validation: deterministic rejection of malformed input
// ---------------------------------------------------------------------------

describe("adaptForeignTranscript — validation", () => {
  const run = (t: unknown): (() => Trace) => () =>
    adaptForeignTranscript(t, { traceId: TRACE_ID });

  it("accepts the minimal valid single-round transcript", () => {
    const trace = adaptForeignTranscript(validTranscript(), { traceId: TRACE_ID });
    expect(trace.steps.map((s) => s.type)).toEqual([
      "model_input",
      "model_output",
      "tool_call",
      "tool_result",
      "model_input",
      "model_output",
      "metadata",
    ]);
  });

  it("rejects a non-object transcript", () => {
    expect(run(null)).toThrow(ForeignTranscriptError);
    expect(run("nope")).toThrow(ForeignTranscriptError);
  });

  it("rejects an empty message list", () => {
    expect(run({ messages: [] })).toThrow(ForeignTranscriptError);
  });

  it("rejects an empty traceId", () => {
    expect(() => adaptForeignTranscript(validTranscript(), { traceId: "" })).toThrow(
      ForeignTranscriptError,
    );
  });

  it("rejects a missing timestamp", () => {
    const t = validTranscript();
    delete (t.messages as Record<string, unknown>[])[0].timestamp;
    expect(run(t)).toThrow(/missing timestamp/);
  });

  it("rejects a non-integer (fractional) timestamp", () => {
    const t = validTranscript();
    (t.messages as Record<string, unknown>[])[0].timestamp = 1000.5;
    expect(run(t)).toThrow(/integer epoch/);
  });

  it("rejects a non-numeric timestamp", () => {
    const t = validTranscript();
    (t.messages as Record<string, unknown>[])[0].timestamp = "1000";
    expect(run(t)).toThrow(/integer epoch/);
  });

  it("rejects decreasing timestamps", () => {
    const t = validTranscript();
    (t.messages as Record<string, unknown>[])[2].timestamp = 999;
    expect(run(t)).toThrow(/earlier than the previous/);
  });

  it("rejects an unsupported role", () => {
    const t = validTranscript();
    (t.messages as Record<string, unknown>[])[1].role = "system";
    expect(run(t)).toThrow(/unsupported role/);
  });

  it("rejects a transcript that does not begin with a user message", () => {
    const t = validTranscript();
    (t.messages as Record<string, unknown>[])[0].role = "assistant";
    expect(run(t)).toThrow(/begin with a user message/);
  });

  it("rejects parallel tool calls in one assistant message", () => {
    const t = validTranscript();
    const assistant = (t.messages as Record<string, unknown>[])[1];
    assistant.tool_calls = [
      { id: "call_x1", type: "function", function: { name: "get_weather", arguments: "{}" } },
      { id: "call_x2", type: "function", function: { name: "send_email", arguments: "{}" } },
    ];
    expect(run(t)).toThrow(/parallel tool calls/);
  });

  it("rejects an assistant message mixing final text and a tool call", () => {
    const t = validTranscript();
    (t.messages as Record<string, unknown>[])[1].content = "here is your answer";
    expect(run(t)).toThrow(/mixes final text and a tool call/);
  });

  it("rejects invalid JSON tool-call arguments", () => {
    const t = validTranscript();
    const assistant = (t.messages as Record<string, unknown>[])[1];
    (assistant.tool_calls as Record<string, unknown>[])[0] = {
      id: "call_x1",
      type: "function",
      function: { name: "get_weather", arguments: "{not valid json}" },
    };
    expect(run(t)).toThrow(/not valid JSON/);
  });

  it("rejects a duplicate foreign tool call id", () => {
    // Two rounds reusing the same foreign id.
    const t = {
      messages: [
        { role: "user", timestamp: 1, content: "hi" },
        {
          role: "assistant",
          timestamp: 2,
          content: null,
          tool_calls: [{ id: "dup", function: { name: "get_weather", arguments: "{}" } }],
        },
        { role: "tool", timestamp: 3, tool_call_id: "dup", content: "{}" },
        {
          role: "assistant",
          timestamp: 4,
          content: null,
          tool_calls: [{ id: "dup", function: { name: "send_email", arguments: "{}" } }],
        },
        { role: "tool", timestamp: 5, tool_call_id: "dup", content: "{}" },
        { role: "assistant", timestamp: 6, content: "done" },
      ],
    };
    expect(run(t)).toThrow(/duplicates an earlier tool call id/);
  });

  it("rejects a tool result referencing an unknown tool_call_id", () => {
    const t = validTranscript();
    (t.messages as Record<string, unknown>[])[2].tool_call_id = "call_other";
    expect(run(t)).toThrow(/does not match the tool call/);
  });

  it("rejects a dangling unresolved tool call at the end", () => {
    const t = {
      messages: [
        { role: "user", timestamp: 1, content: "hi" },
        {
          role: "assistant",
          timestamp: 2,
          content: null,
          tool_calls: [{ id: "c1", function: { name: "get_weather", arguments: "{}" } }],
        },
      ],
    };
    expect(run(t)).toThrow(/dangling tool call/);
  });

  it("rejects a transcript missing the final assistant message", () => {
    const t = {
      messages: [
        { role: "user", timestamp: 1, content: "hi" },
        {
          role: "assistant",
          timestamp: 2,
          content: null,
          tool_calls: [{ id: "c1", function: { name: "get_weather", arguments: "{}" } }],
        },
        { role: "tool", timestamp: 3, tool_call_id: "c1", content: "{}" },
      ],
    };
    expect(run(t)).toThrow(/missing a final assistant message/);
  });
});
