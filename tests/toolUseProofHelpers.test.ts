// Offline unit tests for the W4-E E1 proof helpers.
//
// No ANTHROPIC_API_KEY, no network — these cover the pure helpers only. The live
// gate (real API acceptance of synthetic toolCallId) is the opt-in proof script
// realToolUseProof.ts, which is deliberately NOT part of npm test.

import { describe, it, expect } from "vitest";
import {
  auditNeutrality,
  collectToolBlockIds,
  NEUTRALITY_FORBIDDEN,
} from "../src/examples/toolUseProofHelpers.ts";

// ---------------------------------------------------------------------------
// auditNeutrality
// ---------------------------------------------------------------------------

describe("auditNeutrality", () => {
  it("passes a clean neutral trace (only call-N ids, no provider markers)", () => {
    const serialized = JSON.stringify({
      version: 2,
      steps: [
        { type: "tool_call", payload: { toolCallId: "call-0", toolName: "search", toolInput: {} } },
        { type: "tool_result", payload: { toolCallId: "call-0", toolName: "search", result: { ok: true } } },
      ],
    });
    const result = auditNeutrality(serialized);
    expect(result.ok).toBe(true);
    expect(result.found).toEqual([]);
  });

  it("flags a provider tool_use id (toolu_)", () => {
    const serialized = JSON.stringify({ id: "toolu_01ABCDEF", note: "leak" });
    const result = auditNeutrality(serialized);
    expect(result.ok).toBe(false);
    expect(result.found).toContain("toolu_");
  });

  it.each(NEUTRALITY_FORBIDDEN)("flags forbidden marker %s", (marker) => {
    const result = auditNeutrality(`{"leak":"${marker}"}`);
    expect(result.ok).toBe(false);
    expect(result.found).toContain(marker);
  });

  it("flags the literal API key value when present", () => {
    const key = "sk-ant-secret-value-123";
    const serialized = JSON.stringify({ payload: { note: `oops ${key} leaked` } });
    const result = auditNeutrality(serialized, key);
    expect(result.ok).toBe(false);
    expect(result.found).toContain("<api-key-value>");
  });

  it("does not flag the key when it is absent from the serialized trace", () => {
    const serialized = JSON.stringify({ version: 2, steps: [] });
    const result = auditNeutrality(serialized, "sk-ant-unused-key");
    expect(result.ok).toBe(true);
  });

  it("reports multiple distinct violations at once", () => {
    const serialized = JSON.stringify({ id: "msg_1", usage: { input: 1 }, stop_reason: "end_turn" });
    const result = auditNeutrality(serialized);
    expect(result.ok).toBe(false);
    expect(result.found).toEqual(expect.arrayContaining(["msg_", "usage", "stop_reason"]));
  });
});

// ---------------------------------------------------------------------------
// collectToolBlockIds
// ---------------------------------------------------------------------------

describe("collectToolBlockIds", () => {
  it("extracts call-0 from a structured continuation request", () => {
    const request = {
      model: "claude-haiku-4-5-20251001",
      messages: [
        { role: "user", content: "Find hotels." },
        { role: "assistant", content: [{ type: "tool_use", id: "call-0", name: "search", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call-0", content: "[]" }] },
      ],
    };
    const { toolUseIds, toolResultIds } = collectToolBlockIds([request]);
    expect(toolUseIds).toEqual(["call-0"]);
    expect(toolResultIds).toEqual(["call-0"]);
  });

  it("collects ids across multiple requests and tool rounds in order", () => {
    const requests = [
      { messages: [{ role: "user", content: "hi" }] }, // turn 1: plain string, no blocks
      {
        messages: [
          { role: "assistant", content: [{ type: "tool_use", id: "call-0", name: "search", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "call-0", content: "{}" }] },
        ],
      },
    ];
    const { toolUseIds, toolResultIds } = collectToolBlockIds(requests);
    expect(toolUseIds).toEqual(["call-0"]);
    expect(toolResultIds).toEqual(["call-0"]);
  });

  it("ignores plain-string content and malformed messages without throwing", () => {
    const requests = [
      { messages: [{ role: "user", content: "plain text" }] },
      { messages: "not-an-array" },
      {},
      { messages: [{ role: "assistant" }] },
    ];
    const { toolUseIds, toolResultIds } = collectToolBlockIds(requests);
    expect(toolUseIds).toEqual([]);
    expect(toolResultIds).toEqual([]);
  });
});
