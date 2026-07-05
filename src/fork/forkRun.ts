// Fork a parent trace at a given step index, optionally mutate tool results
// in the prefix, and continue the agent loop. The child trace shares a
// canonical-hash-identical prefix with the parent for all steps before the
// first mutation (or before forkIndex when no mutations are requested).

import { type JsonValue, type Trace, type TraceStep } from "../trace/TraceTypes.ts";
import { type Message, type ModelClient } from "../agent/modelClient.ts";
import { type FixtureTool } from "../agent/fixtureTools.ts";
import { TraceRecorder } from "../trace/TraceRecorder.ts";
import { runAgentLoop } from "../agent/agentLoop.ts";

export interface ForkOptions {
  parentTrace: Trace;
  /**
   * First divergent step index. Steps [0, forkIndex) are copied from the
   * parent (verbatim when no mutations, partially re-chained when mutations
   * are applied). The child's new run starts at forkIndex.
   */
  forkIndex: number;
  childId: string;
  /**
   * Prompt for the continuing agent run starting at forkIndex.
   * Ignored when toolResultMutations is provided — in that case the agent
   * receives the reconstructed conversation history from the (mutated) prefix.
   */
  promptMutation: string;
  model: ModelClient;
  tools: FixtureTool[];
  maxSteps?: number;
  /**
   * Optional map of parent step index → replacement result value.
   * Each key must be a non-negative integer string identifying a "tool_result"
   * step within the prefix [0, forkIndex). The original toolName is preserved;
   * only the result value is replaced. Mutated steps get new hashes; all
   * subsequent prefix steps are re-chained.
   *
   * Constraint: no model_input step may exist between the earliest mutation
   * index and forkIndex (such a step would carry stale message history).
   */
  toolResultMutations?: Record<number, JsonValue>;
}

export interface ForkResult {
  childTrace: Trace;
  finalAnswer: string;
  /** Number of steps in the prefix (= forkIndex), including any mutated steps. */
  prefixLength: number;
}

export async function forkRun(options: ForkOptions): Promise<ForkResult> {
  const {
    parentTrace,
    forkIndex,
    childId,
    promptMutation,
    model,
    tools,
    maxSteps,
    toolResultMutations,
  } = options;

  if (!Number.isInteger(forkIndex) || forkIndex < 0 || forkIndex >= parentTrace.steps.length) {
    throw new Error(
      `forkRun: forkIndex ${forkIndex} out of range — parent has ${parentTrace.steps.length} step(s)`,
    );
  }

  // Validate mutation targets before touching the recorder.
  if (toolResultMutations) {
    for (const key of Object.keys(toolResultMutations)) {
      // Reject non-integer-string keys ("abc", "3.5", "-1", etc.)
      if (!/^\d+$/.test(key)) {
        throw new Error(
          `forkRun: toolResultMutations key "${key}" is not a valid non-negative integer`,
        );
      }
      const i = Number(key);
      if (i >= forkIndex) {
        throw new Error(
          `forkRun: toolResultMutations key ${i} is outside prefix range [0, ${forkIndex})`,
        );
      }
      const step = parentTrace.steps[i];
      if (step.type !== "tool_result") {
        throw new Error(
          `forkRun: toolResultMutations target step ${i} has type "${step.type}", expected "tool_result"`,
        );
      }
    }
  }

  const recorder = new TraceRecorder(childId, {
    parentId: parentTrace.id,
    forkedFromStepId: parentTrace.steps[forkIndex].id,
  });

  const prefixSteps = parentTrace.steps.slice(0, forkIndex);
  const hasMutations =
    toolResultMutations !== undefined && Object.keys(toolResultMutations).length > 0;

  if (!hasMutations) {
    // No mutations: load prefix verbatim — canonical-hash-identical to parent.
    if (prefixSteps.length > 0) {
      recorder.loadPrefix(prefixSteps);
    }
  } else {
    // Find the earliest mutation index to split the prefix.
    const firstMutationIndex = Math.min(...Object.keys(toolResultMutations!).map(Number));

    // Guard: any model_input between the mutation point and forkIndex would
    // carry the original (pre-mutation) tool result in its recorded messages,
    // making the prefix internally inconsistent. Reject early with a clear error.
    for (let i = firstMutationIndex + 1; i < forkIndex; i++) {
      if (parentTrace.steps[i].type === "model_input") {
        throw new Error(
          `forkRun: mutation at step ${firstMutationIndex} would leave the model_input at step ${i} ` +
            `stale — set forkIndex ≤ ${i} or remove that mutation target`,
        );
      }
    }

    // Steps before the first mutation: verbatim (identical hashes to parent).
    const verbatimPart = prefixSteps.slice(0, firstMutationIndex);
    if (verbatimPart.length > 0) {
      recorder.loadPrefix(verbatimPart);
    }

    // Steps from the first mutation onward: re-append, applying replacements.
    // Preserving original timestamps keeps the hashes deterministic across runs.
    for (let i = firstMutationIndex; i < forkIndex; i++) {
      const step = parentTrace.steps[i];
      let payload: JsonValue;
      if (i in toolResultMutations!) {
        // Preserve the original toolName; replace only the result value so the
        // recorded payload shape stays { toolName, result } — same as the agent loop.
        const originalPayload = step.payload as { toolName?: string };
        payload = {
          toolName: originalPayload.toolName ?? "unknown",
          result: toolResultMutations![i],
        };
      } else {
        payload = step.payload;
      }
      recorder.append(step.type, payload, step.timestamp);
    }
  }

  // When mutations are active, reconstruct the message history so the
  // continuing agent loop sees the injected tool result values.
  const initialMessages: Message[] | undefined = hasMutations
    ? reconstructMessages(prefixSteps, toolResultMutations!)
    : undefined;

  const result = await runAgentLoop({
    model,
    tools,
    recorder,
    prompt: promptMutation,
    maxSteps: maxSteps ?? 20,
    initialMessages,
  });

  return {
    childTrace: result.trace,
    finalAnswer: result.finalAnswer,
    prefixLength: prefixSteps.length,
  };
}

/**
 * Rebuild the conversation Message[] from recorded prefix steps, substituting
 * mutated values wherever specified. The result is fed to the continuing agent
 * loop as initialMessages so it sees the corrected history.
 */
function reconstructMessages(
  prefixSteps: ReadonlyArray<TraceStep>,
  toolResultMutations: Record<number, JsonValue>,
): Message[] {
  if (prefixSteps.length === 0) return [];

  const firstStep = prefixSteps[0];
  if (firstStep.type !== "model_input") {
    throw new Error(
      `forkRun: cannot reconstruct message history — ` +
        `expected first prefix step to be "model_input", got "${firstStep.type}"`,
    );
  }

  // Seed from the recorded initial messages in the first model_input payload.
  // Role is restricted to "user" | "assistant" matching the Message interface.
  const firstPayload = firstStep.payload as {
    messages?: Array<{ role: "user" | "assistant"; content: string }>;
  };
  const messages: Message[] = firstPayload.messages
    ? firstPayload.messages.map((m) => ({ ...m }))
    : [];

  let pendingToolName: string | null = null;

  for (let i = 1; i < prefixSteps.length; i++) {
    const step = prefixSteps[i];

    if (step.type === "model_output") {
      const out = step.payload as { type?: string; toolName?: string };
      if (out.type === "tool_call") {
        pendingToolName = out.toolName ?? null;
      }
    } else if (step.type === "tool_result") {
      const raw = step.payload as { toolName?: string; result?: JsonValue };
      const toolName = raw.toolName ?? pendingToolName ?? "unknown";
      // Use the injected value if this step is a mutation target.
      const result =
        step.index in toolResultMutations ? toolResultMutations[step.index] : raw.result;
      messages.push({ role: "assistant", content: `[tool_call:${toolName}]` });
      messages.push({ role: "user", content: JSON.stringify(result) });
      pendingToolName = null;
    }
    // model_input and tool_call steps carry no new message content here —
    // the history is rebuilt incrementally from model_output/tool_result pairs.
  }

  return messages;
}
