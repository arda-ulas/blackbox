import { describe, it, expect, beforeAll } from "vitest";
import { diffTraces, formatFirstDivergence } from "../src/fork/diffTraces.ts";
import { forkRun } from "../src/fork/forkRun.ts";
import { TraceRecorder } from "../src/trace/TraceRecorder.ts";
import { FakeDeterministicModelClient } from "../src/agent/modelClient.ts";
import { defaultFixtureTools } from "../src/agent/fixtureTools.ts";
import { runAgentLoop } from "../src/agent/agentLoop.ts";
import { CURRENT_TRACE_VERSION } from "../src/trace/TraceTypes.ts";
import type { Trace } from "../src/trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// Shared fixture: a 7-step tool trace (model_input → tool_call round-trip →
// model_input → final_answer → metadata) used as the canonical parent.
// ---------------------------------------------------------------------------

let toolTrace: Trace; // 7 steps

beforeAll(async () => {
  const recorder = new TraceRecorder("parent-diff", { createdAt: 1000 });
  const result = await runAgentLoop({
    model: new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "search", toolInput: { query: "hotels" } },
      { type: "final_answer", text: "Parent answer." },
    ]),
    tools: defaultFixtureTools(),
    recorder,
    prompt: "Find hotels.",
  });
  toolTrace = result.trace;
});

// ---------------------------------------------------------------------------
// 1. Identical traces → no divergence
// ---------------------------------------------------------------------------

describe("diffTraces — identical traces", () => {
  it("reports hasDivergence false and sharedPrefixLength equal to step count", () => {
    const clone = structuredClone(toolTrace);
    const diff = diffTraces(toolTrace, clone);

    expect(diff.hasDivergence).toBe(false);
    expect(diff.firstDivergenceIndex).toBeNull();
    expect(diff.sharedPrefixLength).toBe(toolTrace.steps.length);
    expect(diff.parentStep).toBeNull();
    expect(diff.childStep).toBeNull();
    expect(diff.isParentStrictPrefixOfChild).toBe(false);
    expect(diff.isChildStrictPrefixOfParent).toBe(false);
  });

  it("includes correct trace ids in the result", () => {
    const clone: Trace = { ...structuredClone(toolTrace), id: "clone-id" };
    const diff = diffTraces(toolTrace, clone);

    expect(diff.parentTraceId).toBe("parent-diff");
    expect(diff.childTraceId).toBe("clone-id");
  });
});

// ---------------------------------------------------------------------------
// 2. Forked traces → divergence at forkIndex with correct prefix length
// ---------------------------------------------------------------------------

describe("diffTraces — forked child", () => {
  it("reports firstDivergenceIndex equal to forkIndex and sharedPrefixLength equal to forkIndex", async () => {
    const FORK_INDEX = 4;
    const { childTrace } = await forkRun({
      parentTrace: toolTrace,
      forkIndex: FORK_INDEX,
      childId: "child-diff-fork",
      promptMutation: "Find flights instead.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Child answer." },
      ]),
      tools: defaultFixtureTools(),
    });

    const diff = diffTraces(toolTrace, childTrace);

    expect(diff.hasDivergence).toBe(true);
    expect(diff.firstDivergenceIndex).toBe(FORK_INDEX);
    expect(diff.sharedPrefixLength).toBe(FORK_INDEX);
  });

  it("provides both parent and child steps at the divergence point", async () => {
    const FORK_INDEX = 4;
    const { childTrace } = await forkRun({
      parentTrace: toolTrace,
      forkIndex: FORK_INDEX,
      childId: "child-diff-steps",
      promptMutation: "Find flights instead.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Child answer." },
      ]),
      tools: defaultFixtureTools(),
    });

    const diff = diffTraces(toolTrace, childTrace);

    expect(diff.parentStep).not.toBeNull();
    expect(diff.childStep).not.toBeNull();
    expect(diff.parentStep?.hash).toBe(toolTrace.steps[FORK_INDEX].hash);
    expect(diff.childStep?.hash).toBe(childTrace.steps[FORK_INDEX].hash);
    expect(diff.parentStep?.hash).not.toBe(diff.childStep?.hash);
    expect(diff.isParentStrictPrefixOfChild).toBe(false);
    expect(diff.isChildStrictPrefixOfParent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Child longer than parent → divergence at parent length, strict prefix
// ---------------------------------------------------------------------------

describe("diffTraces — child longer than parent", () => {
  it("reports divergence at parent length, parentStep null, isParentStrictPrefixOfChild true", () => {
    // Parent = first 3 steps of toolTrace; child = all 7 steps.
    const shortParent: Trace = {
      version: CURRENT_TRACE_VERSION,
      id: "short-parent",
      createdAt: 0,
      steps: structuredClone(toolTrace.steps.slice(0, 3)),
    };
    const diff = diffTraces(shortParent, toolTrace);

    expect(diff.hasDivergence).toBe(true);
    expect(diff.firstDivergenceIndex).toBe(3);
    expect(diff.sharedPrefixLength).toBe(3);
    expect(diff.parentStep).toBeNull();
    expect(diff.childStep).not.toBeNull();
    expect(diff.isParentStrictPrefixOfChild).toBe(true);
    expect(diff.isChildStrictPrefixOfParent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Parent longer than child → divergence at child length, strict prefix
// ---------------------------------------------------------------------------

describe("diffTraces — parent longer than child", () => {
  it("reports divergence at child length, childStep null, isChildStrictPrefixOfParent true", () => {
    // Child = first 3 steps of toolTrace; parent = all 7 steps.
    const shortChild: Trace = {
      version: CURRENT_TRACE_VERSION,
      id: "short-child",
      createdAt: 0,
      steps: structuredClone(toolTrace.steps.slice(0, 3)),
    };
    const diff = diffTraces(toolTrace, shortChild);

    expect(diff.hasDivergence).toBe(true);
    expect(diff.firstDivergenceIndex).toBe(3);
    expect(diff.sharedPrefixLength).toBe(3);
    expect(diff.parentStep).not.toBeNull();
    expect(diff.childStep).toBeNull();
    expect(diff.isChildStrictPrefixOfParent).toBe(true);
    expect(diff.isParentStrictPrefixOfChild).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Formatted output includes "First divergence" and the divergent index
// ---------------------------------------------------------------------------

describe("formatFirstDivergence", () => {
  it("includes 'First divergence' and the index when traces diverge", async () => {
    const FORK_INDEX = 2;
    const { childTrace } = await forkRun({
      parentTrace: toolTrace,
      forkIndex: FORK_INDEX,
      childId: "child-fmt",
      promptMutation: "Different prompt.",
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Formatted." },
      ]),
      tools: defaultFixtureTools(),
    });

    const diff = diffTraces(toolTrace, childTrace);
    const output = formatFirstDivergence(diff);

    expect(output).toContain("First divergence");
    expect(output).toContain(String(FORK_INDEX));
    expect(output).toContain("parent-diff");
    expect(output).toContain("child-fmt");
    expect(output).toContain(`Shared prefix:  ${FORK_INDEX} step(s)`);
  });

  it("reports no-divergence clearly when traces are identical", () => {
    const diff = diffTraces(toolTrace, structuredClone(toolTrace));
    const output = formatFirstDivergence(diff);

    expect(output).toContain("no divergence");
    expect(output).not.toContain("First divergence");
  });

  it("marks parent strict prefix in formatted output", () => {
    const shortParent: Trace = {
      id: "short-p",
      createdAt: 0,
      steps: structuredClone(toolTrace.steps.slice(0, 2)),
    };
    const diff = diffTraces(shortParent, toolTrace);
    const output = formatFirstDivergence(diff);

    expect(output).toContain("strict prefix");
    expect(output).toContain("<no step>");
  });
});

// ---------------------------------------------------------------------------
// 6. Diff uses hash equality, not object identity
// ---------------------------------------------------------------------------

describe("diffTraces — hash equality not object identity", () => {
  it("treats steps with the same hash as identical regardless of trace id or createdAt", () => {
    // Build a synthetic trace that shares the same step objects (and therefore
    // the same hashes) as toolTrace but has a completely different id and createdAt.
    const synthetic: Trace = {
      version: CURRENT_TRACE_VERSION,
      id: "totally-different-id",
      createdAt: 999_999,
      steps: structuredClone(toolTrace.steps),
    };

    const diff = diffTraces(toolTrace, synthetic);

    // The function must report no divergence — it compares hashes, not references.
    expect(diff.hasDivergence).toBe(false);
    expect(diff.sharedPrefixLength).toBe(toolTrace.steps.length);
  });

  it("detects divergence even for steps that are structurally identical but have different hashes", async () => {
    // Two independent recordings of the same scripted run produce steps with
    // different timestamps → different hashes, even though the payloads match.
    const makeTrace = async (id: string) => {
      const rec = new TraceRecorder(id, { createdAt: 0 });
      return (
        await runAgentLoop({
          model: new FakeDeterministicModelClient([{ type: "final_answer", text: "Same." }]),
          tools: defaultFixtureTools(),
          recorder: rec,
          prompt: "Same prompt.",
        })
      ).trace;
    };

    const traceA = await makeTrace("rec-a");
    // Small delay to guarantee different Date.now() values for timestamps.
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const traceB = await makeTrace("rec-b");

    // If timestamps differ the hashes will differ even for otherwise identical content.
    const stepAHash = traceA.steps[0].hash;
    const stepBHash = traceB.steps[0].hash;

    if (stepAHash !== stepBHash) {
      // Normal case: different timestamps → different hashes → diff detects divergence.
      const diff = diffTraces(traceA, traceB);
      expect(diff.hasDivergence).toBe(true);
      expect(diff.firstDivergenceIndex).toBe(0);
    } else {
      // Rare case: timestamps happened to match. Hashes are equal → no divergence.
      // Accept this outcome; the important thing is diffTraces is driven by hash.
      const diff = diffTraces(traceA, traceB);
      expect(diff.hasDivergence).toBe(false);
    }
  });
});
