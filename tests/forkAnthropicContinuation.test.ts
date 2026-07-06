// Offline analog of W4-E E3 — fork continuation through a MOCKED Anthropic
// adapter. No ANTHROPIC_API_KEY, no network: this locks the fork-continuation
// request-construction mechanism that the live proof (realForkProof.ts) exercises.
//
// The live proof is deliberately NOT part of npm test.

import { describe, it, expect, beforeAll } from "vitest";
import { TraceRecorder } from "../src/trace/TraceRecorder.ts";
import { runAgentLoop } from "../src/agent/agentLoop.ts";
import { FakeDeterministicModelClient } from "../src/agent/modelClient.ts";
import { defaultToolExecutor } from "../src/agent/fixtureTools.ts";
import { forkRun } from "../src/fork/forkRun.ts";
import { diffTraces } from "../src/fork/diffTraces.ts";
import { validateTrace } from "../src/replay/CassetteReplay.ts";
import {
  AnthropicModelClient,
  type AnthropicLikeClient,
} from "../src/agent/anthropicModelClient.ts";
import { auditNeutrality, collectToolBlockIds } from "../src/examples/toolUseProofHelpers.ts";
import type { JsonValue, Trace } from "../src/trace/TraceTypes.ts";

// Same no-availability mutation the live E3 proof injects.
const MUTATION: JsonValue = {
  results: [],
  available: false,
  message: "No hotels available for that date.",
};
const TR_IDX = 3; // tool_result step in the single-round parent
const FORK_INDEX = 4; // the following model_input

// Structured v2 parent: model_input → model_output(tool_call) → tool_call →
//   tool_result → model_input → model_output(final) → metadata (7 steps).
let parentTrace: Trace;

beforeAll(async () => {
  const recorder = new TraceRecorder("mock-parent", { createdAt: 1000 });
  await runAgentLoop({
    model: new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "search", toolInput: { query: "hotels" } },
      { type: "final_answer", text: "Parent answer." },
    ]),
    toolExecutor: defaultToolExecutor(),
    recorder,
    prompt: "Find hotels.",
  });
  parentTrace = recorder.getTrace();
});

// A mocked Anthropic client that captures request params and returns a scripted
// end_turn/text response — no network.
function makeMockedAnthropic(): { model: AnthropicModelClient; captured: unknown[] } {
  const captured: unknown[] = [];
  const client: AnthropicLikeClient = {
    messages: {
      async create(params: unknown): Promise<unknown> {
        captured.push(params);
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "No availability — fully booked." }],
        };
      },
    },
  };
  return { model: new AnthropicModelClient({ client }), captured };
}

async function forkWithMockedAnthropic() {
  const { model, captured } = makeMockedAnthropic();
  const { childTrace } = await forkRun({
    parentTrace,
    forkIndex: FORK_INDEX,
    childId: "mock-parent-fork",
    promptMutation: "(tool-result mutation — promptMutation unused)",
    toolResultMutations: { [TR_IDX]: MUTATION },
    model,
    toolExecutor: defaultToolExecutor(),
    maxSteps: 4,
  });
  return { childTrace, captured };
}

describe("fork continuation via a mocked Anthropic adapter", () => {
  it("sanity: the parent has a tool_result at TR_IDX and a model_input at FORK_INDEX", () => {
    expect(parentTrace.version).toBe(2);
    expect(parentTrace.steps[TR_IDX].type).toBe("tool_result");
    expect(parentTrace.steps[FORK_INDEX].type).toBe("model_input");
  });

  it("child validates and is version 2", async () => {
    const { childTrace } = await forkWithMockedAnthropic();
    expect(() => validateTrace(childTrace)).not.toThrow();
    expect(childTrace.version).toBe(2);
  });

  it("diff first divergence is at the mutated tool_result with a hash-identical prefix", async () => {
    const { childTrace } = await forkWithMockedAnthropic();
    const diff = diffTraces(parentTrace, childTrace);
    expect(diff.hasDivergence).toBe(true);
    expect(diff.firstDivergenceIndex).toBe(TR_IDX);
    expect(diff.sharedPrefixLength).toBe(TR_IDX);
    for (let i = 0; i < TR_IDX; i++) {
      expect(childTrace.steps[i].hash).toBe(parentTrace.steps[i].hash);
    }
  });

  it("the continuation request carries call-0 as tool_use.id and tool_result.tool_use_id", async () => {
    const { captured } = await forkWithMockedAnthropic();
    const { toolUseIds, toolResultIds } = collectToolBlockIds(captured);
    expect(toolUseIds).toContain("call-0");
    expect(toolResultIds).toContain("call-0");
  });

  it("the continuation request carries the mutated tool_result content", async () => {
    const { captured } = await forkWithMockedAnthropic();
    expect(JSON.stringify(captured)).toContain(MUTATION.message as string);
    // And not the original fixture result.
    expect(JSON.stringify(captured)).not.toContain("Fixture result A");
  });

  it("mutated child tool_result preserves toolCallId and toolName", async () => {
    const { childTrace } = await forkWithMockedAnthropic();
    const payload = childTrace.steps[TR_IDX].payload as {
      toolCallId?: string;
      toolName?: string;
      result?: unknown;
    };
    expect(payload.toolCallId).toBe("call-0");
    expect(payload.toolName).toBe("search");
    expect(payload.result).toEqual(MUTATION);
  });

  it("child trace passes the neutrality audit (no provider-native data)", async () => {
    const { childTrace } = await forkWithMockedAnthropic();
    const audit = auditNeutrality(JSON.stringify(childTrace));
    expect(audit.ok).toBe(true);
    expect(audit.found).toEqual([]);
  });
});
