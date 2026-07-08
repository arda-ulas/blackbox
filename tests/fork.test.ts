import { describe, it, expect, beforeAll } from "vitest";
import { forkRun } from "../src/fork/forkRun.ts";
import { TraceRecorder } from "../src/trace/TraceRecorder.ts";
import { FakeDeterministicModelClient } from "../src/agent/modelClient.ts";
import { ReactiveDemoModelClient } from "../src/agent/reactiveDemoModel.ts";
import { defaultToolExecutor } from "../src/agent/fixtureTools.ts";
import { runAgentLoop } from "../src/agent/agentLoop.ts";
import { validateTrace, replayTrace } from "../src/replay/CassetteReplay.ts";
import { diffTraces, formatFirstDivergence } from "../src/fork/diffTraces.ts";
import { verifyTrace } from "../src/trace/verifyTrace.ts";
import { auditTraceNeutrality } from "../src/trace/neutrality.ts";
import type { Trace, JsonValue } from "../src/trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// Shared parent trace: model_input → model_output(tool_call) → tool_call →
//   tool_result → model_input → model_output(final_answer) → metadata
// 7 steps total; fork at index 4 gives a prefix of 4 steps.
// ---------------------------------------------------------------------------

let parentTrace: Trace;
const FORK_INDEX = 4; // second model_input

beforeAll(async () => {
  const recorder = new TraceRecorder("parent-run", { createdAt: 1000 });
  const result = await runAgentLoop({
    model: new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "search", toolInput: { query: "hotels" } },
      { type: "final_answer", text: "Parent answer." },
    ]),
    toolExecutor: defaultToolExecutor(),
    recorder,
    prompt: "Find hotels.",
  });
  parentTrace = result.trace;
});

// ---------------------------------------------------------------------------

describe("forkRun — fork metadata", () => {
  it("sets parentId to the parent trace id", async () => {
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-meta",
      promptMutation: "Find flights.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Child answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });
    expect(childTrace.parentId).toBe("parent-run");
  });

  it("sets forkedFromStepId to the step id at forkIndex", async () => {
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-stepid",
      promptMutation: "Find flights.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Child answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });
    expect(childTrace.forkedFromStepId).toBe(parentTrace.steps[FORK_INDEX].id);
  });
});

describe("forkRun — prefix copy invariant", () => {
  it("copies parent steps [0, forkIndex) verbatim into the child trace", async () => {
    const { childTrace, prefixLength } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-prefix",
      promptMutation: "Find flights.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Child answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });
    expect(prefixLength).toBe(FORK_INDEX);
    for (let i = 0; i < FORK_INDEX; i++) {
      const p = parentTrace.steps[i];
      const c = childTrace.steps[i];
      expect(c.id).toBe(p.id);
      expect(c.index).toBe(p.index);
      expect(c.type).toBe(p.type);
      expect(c.timestamp).toBe(p.timestamp);
      expect(c.prevHash).toBe(p.prevHash);
      expect(c.hash).toBe(p.hash);
    }
  });

  it("prefix hashes are canonical-hash-identical between parent and child", async () => {
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-hash",
      promptMutation: "Find flights.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Child answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });
    for (let i = 0; i < FORK_INDEX; i++) {
      expect(childTrace.steps[i].hash).toBe(parentTrace.steps[i].hash);
    }
  });

  it("step at forkIndex has a different hash than the parent step at the same index", async () => {
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-diverge",
      promptMutation: "Completely different prompt.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Child answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });
    expect(childTrace.steps[FORK_INDEX].hash).not.toBe(parentTrace.steps[FORK_INDEX].hash);
  });
});

describe("forkRun — chain integrity", () => {
  it("child trace passes validateTrace (full hash-chain is intact)", async () => {
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-validate",
      promptMutation: "Find flights.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Child answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });
    expect(() => validateTrace(childTrace)).not.toThrow();
  });

  it("step at forkIndex chains prevHash to the last prefix step's hash", async () => {
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-chain",
      promptMutation: "Find flights.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Child answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });
    const lastPrefixHash = parentTrace.steps[FORK_INDEX - 1].hash;
    expect(childTrace.steps[FORK_INDEX].prevHash).toBe(lastPrefixHash);
  });
});

describe("forkRun — isolation and edge cases", () => {
  it("does not mutate the parent trace", async () => {
    const originalStepCount = parentTrace.steps.length;
    const originalHashes = parentTrace.steps.map((s) => s.hash);

    await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-isolation",
      promptMutation: "Find flights.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Child answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });

    expect(parentTrace.steps).toHaveLength(originalStepCount);
    parentTrace.steps.forEach((s, i) => {
      expect(s.hash).toBe(originalHashes[i]);
    });
  });

  it("forkIndex 0 produces an empty prefix and still sets parentId/forkedFromStepId", async () => {
    const { childTrace, prefixLength } = await forkRun({
      parentTrace,
      forkIndex: 0,
      childId: "child-zero",
      promptMutation: "Zero-fork prompt.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Zero-fork answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });
    expect(prefixLength).toBe(0);
    expect(childTrace.parentId).toBe("parent-run");
    expect(childTrace.forkedFromStepId).toBe(parentTrace.steps[0].id);
    expect(() => validateTrace(childTrace)).not.toThrow();
  });

  it("throws on forkIndex out of range", async () => {
    await expect(
      forkRun({
        parentTrace,
        forkIndex: parentTrace.steps.length, // one past the end
        childId: "child-oob",
        promptMutation: "Whatever.",
        model: new FakeDeterministicModelClient([]),
        toolExecutor: defaultToolExecutor(),
      }),
    ).rejects.toThrow(/forkIndex/);

    await expect(
      forkRun({
        parentTrace,
        forkIndex: -1,
        childId: "child-neg",
        promptMutation: "Whatever.",
        model: new FakeDeterministicModelClient([]),
        toolExecutor: defaultToolExecutor(),
      }),
    ).rejects.toThrow(/forkIndex/);
  });
});

// ---------------------------------------------------------------------------
// W2-B: tool-result mutation
//
// Parent trace step layout:
//   0  model_input       (prompt: "Find hotels.")
//   1  model_output      (tool_call: search)
//   2  tool_call         (search)
//   3  tool_result       (search result)  ← mutation target
//   4  model_input       (second call)    ← forkIndex
//   5  model_output      (final_answer)
//   6  metadata
// ---------------------------------------------------------------------------

// Injected replacement for the search tool_result at step 3.
const INJECTED_RESULT = { injected: true, custom: "w2b-value" };

describe("forkRun — tool-result mutation", () => {
  it("omitting toolResultMutations preserves prefix hashes (no regression)", async () => {
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-no-mutation",
      promptMutation: "Find flights.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "No-mutation answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });
    // Steps 0..FORK_INDEX-1 must be hash-identical to parent.
    for (let i = 0; i < FORK_INDEX; i++) {
      expect(childTrace.steps[i].hash).toBe(parentTrace.steps[i].hash);
    }
  });

  it("with mutation: steps before mutation point keep parent hashes; mutated step has new hash", async () => {
    const MUTATION_INDEX = 3; // tool_result step
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-mutation-hashes",
      promptMutation: "Find flights.",
      toolResultMutations: { [MUTATION_INDEX]: INJECTED_RESULT },
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Mutation answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });
    // Steps before the mutation: identical to parent.
    for (let i = 0; i < MUTATION_INDEX; i++) {
      expect(childTrace.steps[i].hash).toBe(parentTrace.steps[i].hash);
    }
    // Mutated step: different hash.
    expect(childTrace.steps[MUTATION_INDEX].hash).not.toBe(
      parentTrace.steps[MUTATION_INDEX].hash,
    );
  });

  it("child's first new model_input messages carry the injected result as a structured tool_result part", async () => {
    const MUTATION_INDEX = 3;
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-message-check",
      promptMutation: "Find flights.",
      toolResultMutations: { [MUTATION_INDEX]: INJECTED_RESULT },
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Message check answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });

    // The first new step in the child is the model_input at FORK_INDEX.
    const firstNewStep = childTrace.steps[FORK_INDEX];
    expect(firstNewStep.type).toBe("model_input");

    const payload = firstNewStep.payload as {
      messages?: Array<{ role: string; content: unknown }>;
    };
    // The last user message content is a structured MessagePart[] whose
    // tool_result part carries the injected value verbatim — no JSON.stringify.
    const userMessages = (payload.messages ?? []).filter((m) => m.role === "user");
    const lastContent = userMessages.at(-1)?.content;
    expect(Array.isArray(lastContent)).toBe(true);
    const parts = lastContent as Array<{
      type: string;
      toolCallId?: string;
      toolName?: string;
      result?: unknown;
    }>;
    const toolResultPart = parts.find((p) => p.type === "tool_result");
    expect(toolResultPart).toBeDefined();
    expect(toolResultPart?.result).toEqual(INJECTED_RESULT);
    expect(typeof toolResultPart?.toolCallId).toBe("string");
  });

  it("mutated child trace passes validateTrace", async () => {
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-mutation-validate",
      promptMutation: "Find flights.",
      toolResultMutations: { 3: INJECTED_RESULT },
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Valid mutation." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });
    expect(() => validateTrace(childTrace)).not.toThrow();
  });

  it("forks at a tool_result step (forkIndex points to step 3, a tool_result)", async () => {
    // forkIndex = 3: prefix = steps [0, 1, 2] (model_input, model_output, tool_call).
    // The child starts fresh from step 3 with the mutated prompt.
    const { childTrace, prefixLength } = await forkRun({
      parentTrace,
      forkIndex: 3,
      childId: "child-tr-fork",
      promptMutation: "Fork at tool_result.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Tool-result-fork answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });
    expect(prefixLength).toBe(3);
    // Prefix hashes match parent.
    for (let i = 0; i < 3; i++) {
      expect(childTrace.steps[i].hash).toBe(parentTrace.steps[i].hash);
    }
    expect(() => validateTrace(childTrace)).not.toThrow();
  });

  it("rejects mutation targeting a non-tool_result step", async () => {
    // Step 2 is a tool_call, not a tool_result.
    await expect(
      forkRun({
        parentTrace,
        forkIndex: FORK_INDEX,
        childId: "child-bad-type",
        promptMutation: "Whatever.",
        toolResultMutations: { 2: { bad: "target" } },
        model: new FakeDeterministicModelClient([]),
        toolExecutor: defaultToolExecutor(),
      }),
    ).rejects.toThrow(/tool_result/);
  });

  it("rejects mutation targeting a step at or beyond forkIndex", async () => {
    // Step FORK_INDEX is forkIndex itself — not in the prefix [0, FORK_INDEX).
    await expect(
      forkRun({
        parentTrace,
        forkIndex: FORK_INDEX,
        childId: "child-oob-mutation",
        promptMutation: "Whatever.",
        toolResultMutations: { [FORK_INDEX]: { out: "of range" } },
        model: new FakeDeterministicModelClient([]),
        toolExecutor: defaultToolExecutor(),
      }),
    ).rejects.toThrow(/outside prefix range/);
  });
});

// ---------------------------------------------------------------------------
// W2-B audit patch: payload shape, stale-prefix guard, malformed keys,
// parent isolation in mutation mode
//
// Parent trace step layout (same as above):
//   0  model_input       (prompt: "Find hotels.")
//   1  model_output      (tool_call: search)
//   2  tool_call         (search)
//   3  tool_result       (search result)
//   4  model_input       (second call)    ← FORK_INDEX
//   5  model_output      (final_answer)
//   6  metadata
// ---------------------------------------------------------------------------

describe("forkRun — tool-result mutation payload shape", () => {
  it("mutated tool_result step preserves toolName and uses injected result value", async () => {
    const MUTATION_INDEX = 3;
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-payload-shape",
      promptMutation: "Find flights.",
      toolResultMutations: { [MUTATION_INDEX]: INJECTED_RESULT },
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Payload shape answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });

    const mutatedStep = childTrace.steps[MUTATION_INDEX];
    expect(mutatedStep.type).toBe("tool_result");

    const payload = mutatedStep.payload as { toolName?: string; result?: unknown };
    // toolName must be a string (preserved from the parent step's payload).
    expect(typeof payload.toolName).toBe("string");
    // result must be exactly the injected value, not the whole mutation object.
    expect(payload.result).toEqual(INJECTED_RESULT);
  });
});

describe("forkRun — stale model_input guard", () => {
  it("rejects mutation when a model_input follows the mutation target within the prefix", async () => {
    // forkIndex=5 puts prefix=[0,1,2,3,4]; step 4 is model_input and comes after
    // the mutation at step 3 — it would carry stale message history.
    await expect(
      forkRun({
        parentTrace,
        forkIndex: 5,
        childId: "child-stale-model-input",
        promptMutation: "Whatever.",
        toolResultMutations: { 3: INJECTED_RESULT },
        model: new FakeDeterministicModelClient([]),
        toolExecutor: defaultToolExecutor(),
      }),
    ).rejects.toThrow(/stale/);
  });
});

describe("forkRun — malformed mutation keys", () => {
  it("rejects a non-integer key ('abc')", async () => {
    await expect(
      forkRun({
        parentTrace,
        forkIndex: FORK_INDEX,
        childId: "child-bad-key-abc",
        promptMutation: "Whatever.",
        toolResultMutations: { abc: { bad: "key" } } as unknown as Record<number, JsonValue>,
        model: new FakeDeterministicModelClient([]),
        toolExecutor: defaultToolExecutor(),
      }),
    ).rejects.toThrow(/not a valid non-negative integer/);
  });

  it("rejects a float key ('3.5')", async () => {
    await expect(
      forkRun({
        parentTrace,
        forkIndex: FORK_INDEX,
        childId: "child-bad-key-float",
        promptMutation: "Whatever.",
        toolResultMutations: { "3.5": { bad: "key" } } as unknown as Record<number, JsonValue>,
        model: new FakeDeterministicModelClient([]),
        toolExecutor: defaultToolExecutor(),
      }),
    ).rejects.toThrow(/not a valid non-negative integer/);
  });

  it("rejects a leading-zero key ('03') that would silently miss the mutation target", async () => {
    await expect(
      forkRun({
        parentTrace,
        forkIndex: FORK_INDEX,
        childId: "child-bad-key-leading-zero",
        promptMutation: "Whatever.",
        toolResultMutations: { "03": { bad: "key" } } as unknown as Record<number, JsonValue>,
        model: new FakeDeterministicModelClient([]),
        toolExecutor: defaultToolExecutor(),
      }),
    ).rejects.toThrow(/not a valid non-negative integer/);
  });
});

describe("forkRun — parent isolation in mutation mode", () => {
  it("does not mutate the parent trace when tool-result mutations are applied", async () => {
    const originalHashes = parentTrace.steps.map((s) => s.hash);
    const originalStepCount = parentTrace.steps.length;

    await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-mutation-isolation",
      promptMutation: "Find flights.",
      toolResultMutations: { 3: INJECTED_RESULT },
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Isolation check." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });

    expect(parentTrace.steps).toHaveLength(originalStepCount);
    parentTrace.steps.forEach((s, i) => {
      expect(s.hash).toBe(originalHashes[i]);
    });
  });
});

// ---------------------------------------------------------------------------
// W2-C: fork continuation semantics — non-model_input fork points
//
// Parent trace step layout:
//   0  model_input       (prompt: "Find hotels.")
//   1  model_output      (tool_call: search)      ← fork point for test 1
//   2  tool_call         (search)                 ← fork point for test 2
//   3  tool_result       (search result)           (already tested in W2-B)
//   4  model_input       (second call)
//   5  model_output      (final_answer)
//   6  metadata          (run_completed)          ← must be rejected
// ---------------------------------------------------------------------------

describe("forkRun — non-model_input fork points (W2-C)", () => {
  it("forks at a model_output step: prefix is verbatim, child starts with a new model_input", async () => {
    const { childTrace, prefixLength } = await forkRun({
      parentTrace,
      forkIndex: 1, // model_output step
      childId: "child-at-model-output",
      promptMutation: "Find trains instead.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Train answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });

    expect(prefixLength).toBe(1);
    // Sole prefix step is hash-identical to parent.
    expect(childTrace.steps[0].hash).toBe(parentTrace.steps[0].hash);
    // Fork metadata points at the correct parent step.
    expect(childTrace.forkedFromStepId).toBe(parentTrace.steps[1].id);
    // First child-only step is a fresh model_input (not a model_output).
    expect(childTrace.steps[1].type).toBe("model_input");
    // prevHash of first new step chains to the last copied prefix step.
    expect(childTrace.steps[1].prevHash).toBe(parentTrace.steps[0].hash);
    expect(() => validateTrace(childTrace)).not.toThrow();
  });

  it("forks at a tool_call step: two-step prefix is verbatim, child continues from model_input", async () => {
    const { childTrace, prefixLength } = await forkRun({
      parentTrace,
      forkIndex: 2, // tool_call step
      childId: "child-at-tool-call",
      promptMutation: "Try a different approach.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Tool-call-fork answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });

    expect(prefixLength).toBe(2);
    // Prefix hashes [0,1] match parent.
    for (let i = 0; i < 2; i++) {
      expect(childTrace.steps[i].hash).toBe(parentTrace.steps[i].hash);
    }
    // Fork metadata points at the correct parent step.
    expect(childTrace.forkedFromStepId).toBe(parentTrace.steps[2].id);
    // First child-only step is a fresh model_input.
    expect(childTrace.steps[2].type).toBe("model_input");
    // prevHash of first new step chains to the last copied prefix step.
    expect(childTrace.steps[2].prevHash).toBe(parentTrace.steps[1].hash);
    expect(() => validateTrace(childTrace)).not.toThrow();
  });

  it("rejects forking at a metadata step (terminal run marker)", async () => {
    const metadataIndex = parentTrace.steps.findIndex((s) => s.type === "metadata");
    expect(metadataIndex).toBeGreaterThan(-1);

    await expect(
      forkRun({
        parentTrace,
        forkIndex: metadataIndex,
        childId: "child-at-metadata",
        promptMutation: "Whatever.",
        model: new FakeDeterministicModelClient([]),
        toolExecutor: defaultToolExecutor(),
      }),
    ).rejects.toThrow(/metadata/);
  });
});

// ---------------------------------------------------------------------------
// W4-D3: structured fork reconstruction + toolCallId preservation
//
// Parent trace step layout (from beforeAll — single search tool call):
//   0  model_input       (prompt: "Find hotels.")
//   1  model_output      (tool_call: search, toolCallId call-0)
//   2  tool_call         (search, call-0)
//   3  tool_result       (search result, call-0)  ← mutation target
//   4  model_input       (second call)             ← FORK_INDEX
//   5  model_output      (final_answer)
//   6  metadata
// ---------------------------------------------------------------------------

describe("forkRun — W4-D3 structured reconstruction", () => {
  const MUTATION_INDEX = 3;

  it("mutated tool_result step preserves the original toolCallId (and toolName)", async () => {
    const parentToolResult = parentTrace.steps[MUTATION_INDEX].payload as {
      toolCallId?: string;
      toolName?: string;
    };
    expect(parentToolResult.toolCallId).toBe("call-0");

    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-d3-preserve-id",
      promptMutation: "Find flights.",
      toolResultMutations: { [MUTATION_INDEX]: INJECTED_RESULT },
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Preserve-id answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });

    const childPayload = childTrace.steps[MUTATION_INDEX].payload as {
      toolCallId?: string;
      toolName?: string;
      result?: unknown;
    };
    expect(childPayload.toolCallId).toBe(parentToolResult.toolCallId);
    expect(childPayload.toolName).toBe(parentToolResult.toolName);
    expect(childPayload.result).toEqual(INJECTED_RESULT);
  });

  it("reconstructed continued model_input carries structured tool_use / tool_result parts with matching ids", async () => {
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-d3-structured",
      promptMutation: "Find flights.",
      toolResultMutations: { [MUTATION_INDEX]: INJECTED_RESULT },
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Structured answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });

    const modelInput = childTrace.steps[FORK_INDEX];
    expect(modelInput.type).toBe("model_input");
    const messages = (modelInput.payload as {
      messages?: Array<{ role: string; content: unknown }>;
    }).messages ?? [];

    // Collect all structured parts across message contents.
    const parts = messages
      .map((m) => m.content)
      .filter((c): c is Array<{ type: string; toolCallId?: string }> => Array.isArray(c))
      .flat();

    const toolUse = parts.find((p) => p.type === "tool_use");
    const toolResult = parts.find((p) => p.type === "tool_result");
    expect(toolUse).toBeDefined();
    expect(toolResult).toBeDefined();
    // Correlation holds across the reconstructed pair.
    expect(toolUse?.toolCallId).toBe("call-0");
    expect(toolResult?.toolCallId).toBe("call-0");
    expect(toolUse?.toolCallId).toBe(toolResult?.toolCallId);
  });

  it("fork reconstruction emits no legacy [tool_call:...] / JSON.stringify string transcript", async () => {
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-d3-no-legacy",
      promptMutation: "Find flights.",
      toolResultMutations: { [MUTATION_INDEX]: INJECTED_RESULT },
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "No-legacy answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });

    const serialized = JSON.stringify(childTrace);
    expect(serialized).not.toContain("[tool_call:");
    // The injected result must appear as a structured object, never as an
    // escaped JSON-in-a-string blob.
    expect(serialized).not.toContain(JSON.stringify(JSON.stringify(INJECTED_RESULT)));
  });

  it("seeds continued tool-call ids past the prefix — a new child tool call becomes call-1, not call-0", async () => {
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-d3-seed-id",
      promptMutation: "Find flights.",
      toolResultMutations: { [MUTATION_INDEX]: INJECTED_RESULT },
      model: new FakeDeterministicModelClient([
        { type: "tool_call", toolName: "calendar", toolInput: { date: "2024-03-15" } },
        { type: "final_answer", text: "Seeded answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });

    const toolCallIds = childTrace.steps
      .filter((s) => s.type === "tool_call")
      .map((s) => (s.payload as { toolCallId: string }).toolCallId);

    // Prefix contributed call-0; the continued run's new call is call-1.
    expect(toolCallIds).toContain("call-0");
    expect(toolCallIds).toContain("call-1");
    // No duplicate call-* ids anywhere in the child trace.
    expect(new Set(toolCallIds).size).toBe(toolCallIds.length);
  });

  it("multi-call correlation is consistent across model_output / tool_call / tool_result in the continued child", async () => {
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-d3-correlation",
      promptMutation: "Find flights.",
      toolResultMutations: { [MUTATION_INDEX]: INJECTED_RESULT },
      model: new FakeDeterministicModelClient([
        { type: "tool_call", toolName: "calendar", toolInput: { date: "2024-03-15" } },
        { type: "final_answer", text: "Correlation answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });

    // Every tool round (model_output tool_call, tool_call, tool_result) sharing
    // an id must agree on that id, and every generated id must be well-formed.
    const idFor = (type: string) =>
      childTrace.steps
        .filter((s) => s.type === type)
        .map((s) => (s.payload as { toolCallId?: string }).toolCallId);

    const callIds = idFor("tool_call");
    const resultIds = idFor("tool_result");
    const outputToolCallIds = childTrace.steps
      .filter((s) => s.type === "model_output")
      .map((s) => s.payload as { type?: string; toolCallId?: string })
      .filter((p) => p.type === "tool_call")
      .map((p) => p.toolCallId);

    // Same set of ids appears in each correlated stream, in order.
    expect(callIds).toEqual(outputToolCallIds);
    expect(resultIds).toEqual(callIds);
    for (const id of callIds) {
      expect(id).toMatch(/^call-\d+$/);
    }
  });

  it("continued child trace validates and keeps prefix hash identity before the mutated step", async () => {
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-d3-validate",
      promptMutation: "Find flights.",
      toolResultMutations: { [MUTATION_INDEX]: INJECTED_RESULT },
      model: new FakeDeterministicModelClient([
        { type: "tool_call", toolName: "calendar", toolInput: { date: "2024-03-15" } },
        { type: "final_answer", text: "Validate answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });

    expect(() => validateTrace(childTrace)).not.toThrow();
    for (let i = 0; i < MUTATION_INDEX; i++) {
      expect(childTrace.steps[i].hash).toBe(parentTrace.steps[i].hash);
    }
  });

  it("first divergence still points at the mutated tool_result step", async () => {
    const { childTrace } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-d3-divergence",
      promptMutation: "Find flights.",
      toolResultMutations: { [MUTATION_INDEX]: INJECTED_RESULT },
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Divergence answer." },
      ]),
      toolExecutor: defaultToolExecutor(),
    });

    const diff = diffTraces(parentTrace, childTrace);
    expect(diff.hasDivergence).toBe(true);
    expect(diff.firstDivergenceIndex).toBe(MUTATION_INDEX);
    expect(diff.sharedPrefixLength).toBe(MUTATION_INDEX);

    const output = formatFirstDivergence(diff);
    expect(output).toContain("First divergence");
    expect(output).toContain(String(MUTATION_INDEX));
  });
});

// ---------------------------------------------------------------------------
// W7-A: reactive continuation derives the child answer from the mutated
// tool_result. Same fork geometry as the demo (mutation at step 3, forkIndex 4).
// ---------------------------------------------------------------------------

describe("forkRun — reactive continuation (W7-A)", () => {
  const MUTATION_INDEX = 3; // the search tool_result step

  const MUTATION_A: JsonValue = {
    results: [],
    available: false,
    message: "No hotels available for that date.",
  };
  const MUTATION_B: JsonValue = {
    results: [],
    available: false,
    message: "MARKER-B: fully booked in that city.",
  };

  async function forkReactive(childId: string, mutation: JsonValue) {
    return forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId,
      promptMutation: "(tool-result mutation — promptMutation unused)",
      toolResultMutations: { [MUTATION_INDEX]: mutation },
      model: new ReactiveDemoModelClient(),
      toolExecutor: defaultToolExecutor(),
    });
  }

  it("two different mutation payloads produce two different child answers", async () => {
    const a = await forkReactive("child-reactive-a", MUTATION_A);
    const b = await forkReactive("child-reactive-b", MUTATION_B);
    expect(a.finalAnswer).not.toEqual(b.finalAnswer);
  });

  it("each child answer embeds its own payload message (derivation is visible)", async () => {
    const a = await forkReactive("child-reactive-embed-a", MUTATION_A);
    const b = await forkReactive("child-reactive-embed-b", MUTATION_B);
    expect(a.finalAnswer).toContain("No hotels available for that date.");
    expect(b.finalAnswer).toContain("MARKER-B: fully booked in that city.");
  });

  it("the same payload yields the same answer (deterministic)", async () => {
    const a = await forkReactive("child-reactive-det-1", MUTATION_A);
    const b = await forkReactive("child-reactive-det-2", MUTATION_A);
    expect(a.finalAnswer).toEqual(b.finalAnswer);
  });

  it("child validates, verifies (incl. neutrality), and replays to the derived answer", async () => {
    const { childTrace, finalAnswer } = await forkReactive("child-reactive-verify", MUTATION_A);

    expect(() => validateTrace(childTrace)).not.toThrow();
    expect(verifyTrace(childTrace).pass).toBe(true);
    expect(auditTraceNeutrality(childTrace).ok).toBe(true);

    const replay = replayTrace(childTrace);
    expect(replay.status).toBe("success");
    expect(replay.result).toBe(finalAnswer);
    expect(replay.result).toContain("No hotels available for that date.");
  });

  it("child stays at 7 steps with a hash-identical prefix and first divergence at index 3", async () => {
    const { childTrace } = await forkReactive("child-reactive-geometry", MUTATION_A);
    expect(childTrace.steps.length).toBe(7);

    for (let i = 0; i < MUTATION_INDEX; i++) {
      expect(childTrace.steps[i].hash).toBe(parentTrace.steps[i].hash);
    }

    const diff = diffTraces(parentTrace, childTrace);
    expect(diff.firstDivergenceIndex).toBe(MUTATION_INDEX);
    expect(diff.sharedPrefixLength).toBe(MUTATION_INDEX);
  });

  it("availability payload triggers a different (rule-3) answer than the no-availability payload", async () => {
    const none = await forkReactive("child-reactive-none", MUTATION_A);
    const avail = await forkReactive("child-reactive-avail", {
      results: [{ title: "Grand Hotel" }],
      available: true,
    });
    expect(avail.finalAnswer).not.toEqual(none.finalAnswer);
    expect(avail.finalAnswer).toContain("Grand Hotel");
  });

  it("prompt-mode fork (no tool-result mutations) yields the rule-4 prompt-derived answer", async () => {
    const { finalAnswer } = await forkRun({
      parentTrace,
      forkIndex: FORK_INDEX,
      childId: "child-reactive-prompt",
      promptMutation: "Try a different city instead",
      // No toolResultMutations → forkRun passes initialMessages: undefined, so the
      // continuation sees no tool rounds and hits rule 4 (prompt-derived).
      model: new ReactiveDemoModelClient(),
      toolExecutor: defaultToolExecutor(),
    });
    expect(finalAnswer).toContain("Try a different city instead");
    // Not the tool_result-derived rule-2 wording.
    expect(finalAnswer).not.toContain("no options are available");
  });
});
