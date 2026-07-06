// Fork a parent trace at a given step index, optionally mutate tool results
// in the prefix, and continue the agent loop. The child trace shares a
// canonical-hash-identical prefix with the parent for all steps before the
// first mutation (or before forkIndex when no mutations are requested).

import { type JsonValue, type Trace, type TraceStep } from "../trace/TraceTypes.ts";
import {
  type Message,
  type MessagePart,
  type ModelClient,
  type ToolExecutor,
} from "../agent/modelClient.ts";
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
  toolExecutor: ToolExecutor;
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
    toolExecutor,
    maxSteps,
    toolResultMutations,
  } = options;

  if (!Number.isInteger(forkIndex) || forkIndex < 0 || forkIndex >= parentTrace.steps.length) {
    throw new Error(
      `forkRun: forkIndex ${forkIndex} out of range — parent has ${parentTrace.steps.length} step(s)`,
    );
  }

  if (parentTrace.steps[forkIndex].type === "metadata") {
    throw new Error(
      `forkRun: cannot fork at a "metadata" step (index ${forkIndex}) — ` +
        `metadata steps are terminal run markers with no meaningful continuation`,
    );
  }

  // Validate mutation targets before touching the recorder.
  if (toolResultMutations) {
    for (const key of Object.keys(toolResultMutations)) {
      // Reject non-canonical or non-integer-string keys ("abc", "3.5", "-1", "03", etc.)
      if (!/^(0|[1-9]\d*)$/.test(key)) {
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
        // Preserve the original toolCallId and toolName; replace only the result
        // value so the recorded payload shape stays
        // { toolCallId, toolName, result } — same as the agent loop's v2
        // tool_result step. Dropping toolCallId here would break call ↔ result
        // correlation in the mutated child (the W4-D2 → W4-D3 handoff artifact).
        const originalPayload = step.payload as { toolCallId?: string; toolName?: string };
        const mutated: JsonValue = {
          toolName: originalPayload.toolName ?? "unknown",
          result: toolResultMutations![i],
        };
        if (originalPayload.toolCallId !== undefined) {
          (mutated as { toolCallId?: string }).toolCallId = originalPayload.toolCallId;
        }
        payload = mutated;
      } else {
        payload = step.payload;
      }
      recorder.append(step.type, payload, step.timestamp);
    }
  }

  // When mutations are active, reconstruct the message history so the
  // continuing agent loop sees the injected tool result values, rebuilt as
  // structured v2 MessagePart[] tool_use/tool_result rounds.
  const initialMessages: Message[] | undefined = hasMutations
    ? reconstructMessages(prefixSteps, toolResultMutations!)
    : undefined;

  // Seed the continued run past the tool-call ids already baked into the copied
  // prefix so new calls get fresh ids (call-N…) rather than colliding with the
  // existing call-0/call-1/… — regardless of mutation mode, since the prefix
  // steps live in the child trace either way.
  const initialToolCallIndex = nextToolCallIndex(prefixSteps);

  const result = await runAgentLoop({
    model,
    toolExecutor,
    recorder,
    prompt: promptMutation,
    maxSteps: maxSteps ?? 20,
    initialMessages,
    initialToolCallIndex,
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

  // Carry the tool_use details forward from the model_output(tool_call) step so
  // the reconstructed assistant turn keeps the original toolInput alongside the
  // toolCallId/toolName the tool_result step also records.
  let pending: { toolCallId: string; toolName: string; toolInput: JsonValue } | null = null;

  for (let i = 1; i < prefixSteps.length; i++) {
    const step = prefixSteps[i];

    if (step.type === "model_output") {
      const out = step.payload as {
        type?: string;
        toolCallId?: string;
        toolName?: string;
        toolInput?: JsonValue;
      };
      if (out.type === "tool_call") {
        pending = {
          toolCallId: out.toolCallId ?? "",
          toolName: out.toolName ?? "unknown",
          toolInput: out.toolInput ?? null,
        };
      }
    } else if (step.type === "tool_result") {
      const raw = step.payload as {
        toolCallId?: string;
        toolName?: string;
        result?: JsonValue;
        error?: string;
      };
      // Prefer the ids recorded on the tool_result step; fall back to the
      // pending tool_use if an older/partial payload omitted them.
      const toolCallId = raw.toolCallId ?? pending?.toolCallId ?? "";
      const toolName = raw.toolName ?? pending?.toolName ?? "unknown";
      const toolInput = pending?.toolInput ?? null;

      // Assistant turn: the structured tool_use that requested this result.
      const toolUse: MessagePart = { type: "tool_use", toolCallId, toolName, toolInput };
      messages.push({ role: "assistant", content: [toolUse] });

      // User turn: the structured tool_result. A mutation always injects a
      // result value; otherwise preserve the original result or error shape.
      let toolResult: MessagePart;
      if (step.index in toolResultMutations) {
        toolResult = {
          type: "tool_result",
          toolCallId,
          toolName,
          result: toolResultMutations[step.index],
        };
      } else if (raw.error !== undefined) {
        toolResult = { type: "tool_result", toolCallId, toolName, error: raw.error };
      } else {
        toolResult = { type: "tool_result", toolCallId, toolName, result: raw.result ?? null };
      }
      messages.push({ role: "user", content: [toolResult] });

      pending = null;
    }
    // model_input and tool_call steps carry no new message content here —
    // the history is rebuilt incrementally from model_output/tool_result pairs.
  }

  return messages;
}

/**
 * Derive the next run-local tool-call index from a copied prefix. Scans every
 * step payload for a `toolCallId` of the form `call-<n>` and returns the highest
 * n seen + 1 (0 when the prefix contains no tool calls). This seeds a continued
 * run so its new tool-call ids do not collide with the prefix's existing ids.
 */
function nextToolCallIndex(prefixSteps: ReadonlyArray<TraceStep>): number {
  let max = -1;
  for (const step of prefixSteps) {
    const id = (step.payload as { toolCallId?: unknown }).toolCallId;
    if (typeof id === "string") {
      const m = /^call-(\d+)$/.exec(id);
      if (m) {
        const n = Number(m[1]);
        if (n > max) max = n;
      }
    }
  }
  return max + 1;
}
