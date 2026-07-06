// Deterministic tool-loop agent.
//
// The loop calls the model, executes any requested tool, feeds the result back,
// and repeats until the model returns a final answer or the step limit is hit.
// Every event is recorded into the supplied TraceRecorder so the run can be
// replayed, forked, and diffed later.

import { type JsonValue, type Trace } from "../trace/TraceTypes.ts";
import {
  type ModelClient,
  type ModelInput,
  type ModelOutput,
  type Message,
  type ToolExecutor,
  type ModelErrorKind,
  ModelCallError,
} from "./modelClient.ts";
import { type TraceRecorder } from "../trace/TraceRecorder.ts";
import { toolCallIdForIndex } from "./toolCallId.ts";

export interface AgentLoopOptions {
  model: ModelClient;
  toolExecutor: ToolExecutor;
  recorder: TraceRecorder;
  /** Initial user-facing prompt. Ignored when initialMessages is provided. */
  prompt: string;
  systemPrompt?: string;
  /**
   * Maximum number of model calls before the loop aborts.
   * Prevents runaway loops in tests and live use. Default: 20.
   */
  maxSteps?: number;
  /**
   * Pre-built message history. When provided, overrides the single-message
   * construction from prompt. Used by forkRun for tool-result mutation so
   * the continuing agent sees the mutated conversation history.
   */
  initialMessages?: Message[];
}

export interface AgentLoopResult {
  trace: Trace;
  finalAnswer: string;
  /** Number of model calls made during the run. */
  stepCount: number;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { model, toolExecutor, recorder, prompt, systemPrompt, maxSteps = 20 } = options;

  const toolDefs = toolExecutor.definitions();

  const messages: Message[] = options.initialMessages
    ? [...options.initialMessages]
    : [{ role: "user", content: prompt }];
  let stepCount = 0;

  // Run-local counter for deterministic, provider-neutral tool-call ids
  // (call-0, call-1, ...). W4-D2 starts a fresh run at 0; seeding a continued
  // run from existing structured messages is W4-D3's concern.
  let toolCallCount = 0;

  while (stepCount < maxSteps) {
    // Build and record model input before calling the model.
    const modelInput: ModelInput = {
      messages: [...messages],
      tools: toolDefs,
    };
    if (systemPrompt !== undefined) {
      modelInput.systemPrompt = systemPrompt;
    }

    recorder.append("model_input", modelInput as unknown as JsonValue);

    let modelOutput: ModelOutput;
    try {
      modelOutput = await model.complete(modelInput);
    } catch (err) {
      const errorKind: ModelErrorKind =
        err instanceof ModelCallError ? err.errorKind : "unknown";
      const message =
        err instanceof Error ? err.message : "model call failed with an unknown error";
      recorder.append("metadata", {
        event: "run_failed",
        status: "error",
        reason: "model_error",
        errorKind,
        message,
      });
      throw err;
    }
    stepCount += 1;

    if (modelOutput.type === "final_answer") {
      recorder.append("model_output", modelOutput as unknown as JsonValue);
      recorder.append("metadata", {
        event: "run_completed",
        status: "success",
        result: modelOutput.text,
      });
      return {
        trace: recorder.getTrace(),
        finalAnswer: modelOutput.text,
        stepCount,
      };
    }

    // Tool call path. Assign a deterministic, provider-neutral correlation id
    // that ties the recorded call, its result, and the structured transcript
    // parts together — without any provider-native id.
    const { toolName, toolInput } = modelOutput;
    const toolCallId = toolCallIdForIndex(toolCallCount);
    toolCallCount += 1;

    recorder.append("model_output", { type: "tool_call", toolCallId, toolName, toolInput });
    recorder.append("tool_call", { toolCallId, toolName, toolInput });

    let toolResult: JsonValue;
    try {
      toolResult = await toolExecutor.execute(toolName, toolInput);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      recorder.append("tool_result", { toolCallId, toolName, error: detail });
      recorder.append("metadata", {
        event: "run_failed",
        status: "error",
        reason: "unknown_tool",
        toolName,
        toolCallId,
      });
      throw new Error(`Agent loop aborted: ${detail}`);
    }

    recorder.append("tool_result", { toolCallId, toolName, result: toolResult });

    // Feed the result back as structured, provider-neutral transcript parts.
    // The tool_use and tool_result parts share toolCallId so a fresh adapter can
    // reconstruct correlation from the cassette alone (no adapter memory).
    messages.push({
      role: "assistant",
      content: [{ type: "tool_use", toolCallId, toolName, toolInput }],
    });
    messages.push({
      role: "user",
      content: [{ type: "tool_result", toolCallId, toolName, result: toolResult }],
    });
  }

  recorder.append("metadata", {
    event: "run_failed",
    status: "error",
    reason: "max_steps_exceeded",
    maxSteps,
  });
  throw new Error(`Agent loop exceeded max steps (${maxSteps}).`);
}
