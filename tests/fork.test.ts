import { describe, it, expect, beforeAll } from "vitest";
import { forkRun } from "../src/fork/forkRun.ts";
import { TraceRecorder } from "../src/trace/TraceRecorder.ts";
import { FakeDeterministicModelClient } from "../src/agent/modelClient.ts";
import { defaultFixtureTools } from "../src/agent/fixtureTools.ts";
import { runAgentLoop } from "../src/agent/agentLoop.ts";
import { validateTrace } from "../src/replay/CassetteReplay.ts";
import type { Trace } from "../src/trace/TraceTypes.ts";

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
    tools: defaultFixtureTools(),
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
      tools: defaultFixtureTools(),
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
      tools: defaultFixtureTools(),
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
      tools: defaultFixtureTools(),
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
      tools: defaultFixtureTools(),
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
      tools: defaultFixtureTools(),
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
      tools: defaultFixtureTools(),
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
      tools: defaultFixtureTools(),
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
      tools: defaultFixtureTools(),
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
      tools: defaultFixtureTools(),
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
        tools: defaultFixtureTools(),
      }),
    ).rejects.toThrow(/forkIndex/);

    await expect(
      forkRun({
        parentTrace,
        forkIndex: -1,
        childId: "child-neg",
        promptMutation: "Whatever.",
        model: new FakeDeterministicModelClient([]),
        tools: defaultFixtureTools(),
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
      tools: defaultFixtureTools(),
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
      tools: defaultFixtureTools(),
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

  it("child's first new model_input messages include the injected tool result value", async () => {
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
      tools: defaultFixtureTools(),
    });

    // The first new step in the child is the model_input at FORK_INDEX.
    const firstNewStep = childTrace.steps[FORK_INDEX];
    expect(firstNewStep.type).toBe("model_input");

    const payload = firstNewStep.payload as {
      messages?: Array<{ role: string; content: string }>;
    };
    // The last user message must be the JSON-stringified injected result.
    const userMessages = (payload.messages ?? []).filter((m) => m.role === "user");
    const lastUserContent = userMessages.at(-1)?.content ?? "";
    expect(lastUserContent).toBe(JSON.stringify(INJECTED_RESULT));
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
      tools: defaultFixtureTools(),
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
      tools: defaultFixtureTools(),
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
        tools: defaultFixtureTools(),
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
        tools: defaultFixtureTools(),
      }),
    ).rejects.toThrow(/outside prefix range/);
  });
});
