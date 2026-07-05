// Fork a parent trace at a given step index, apply a prompt mutation, and
// continue the agent loop. The child trace shares a canonical-hash-identical
// prefix with the parent for all steps before forkIndex, then diverges.

import { type Trace } from "../trace/TraceTypes.ts";
import { type ModelClient } from "../agent/modelClient.ts";
import { type FixtureTool } from "../agent/fixtureTools.ts";
import { TraceRecorder } from "../trace/TraceRecorder.ts";
import { runAgentLoop } from "../agent/agentLoop.ts";

export interface ForkOptions {
  parentTrace: Trace;
  /**
   * First divergent step index. Steps [0, forkIndex) are copied verbatim from
   * the parent; the child's new run starts at forkIndex.
   */
  forkIndex: number;
  childId: string;
  /** New prompt that drives the child run starting at forkIndex. */
  promptMutation: string;
  model: ModelClient;
  tools: FixtureTool[];
  maxSteps?: number;
}

export interface ForkResult {
  childTrace: Trace;
  finalAnswer: string;
  /** Number of steps copied verbatim from the parent (= forkIndex). */
  prefixLength: number;
}

export async function forkRun(options: ForkOptions): Promise<ForkResult> {
  const { parentTrace, forkIndex, childId, promptMutation, model, tools, maxSteps } = options;

  if (!Number.isInteger(forkIndex) || forkIndex < 0 || forkIndex >= parentTrace.steps.length) {
    throw new Error(
      `forkRun: forkIndex ${forkIndex} out of range — parent has ${parentTrace.steps.length} step(s)`,
    );
  }

  const recorder = new TraceRecorder(childId, {
    parentId: parentTrace.id,
    forkedFromStepId: parentTrace.steps[forkIndex].id,
  });

  const prefix = parentTrace.steps.slice(0, forkIndex);
  if (prefix.length > 0) {
    recorder.loadPrefix(prefix);
  }

  const result = await runAgentLoop({
    model,
    tools,
    recorder,
    prompt: promptMutation,
    maxSteps: maxSteps ?? 20,
  });

  return {
    childTrace: result.trace,
    finalAnswer: result.finalAnswer,
    prefixLength: prefix.length,
  };
}
