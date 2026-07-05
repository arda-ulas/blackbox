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
  type Message,
  type ToolDefinition,
} from "./modelClient.ts";
import { type FixtureTool, executeTool } from "./fixtureTools.ts";
import { type TraceRecorder } from "../trace/TraceRecorder.ts";

export interface AgentLoopOptions {
  model: ModelClient;
  tools: FixtureTool[];
  recorder: TraceRecorder;
  /** Initial user-facing prompt. */
  prompt: string;
  systemPrompt?: string;
  /**
   * Maximum number of model calls before the loop aborts.
   * Prevents runaway loops in tests and live use. Default: 20.
   */
  maxSteps?: number;
}

export interface AgentLoopResult {
  trace: Trace;
  finalAnswer: string;
  /** Number of model calls made during the run. */
  stepCount: number;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { model, tools, recorder, prompt, systemPrompt, maxSteps = 20 } = options;

  const toolDefs: ToolDefinition[] = tools.map((t) => ({
    name: t.name,
    description: t.name,
  }));

  const messages: Message[] = [{ role: "user", content: prompt }];
  let stepCount = 0;

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

    const modelOutput = await model.complete(modelInput);
    stepCount += 1;

    recorder.append("model_output", modelOutput as unknown as JsonValue);

    if (modelOutput.type === "final_answer") {
      recorder.append("metadata", {
        kind: "final_answer",
        text: modelOutput.text,
      });
      return {
        trace: recorder.getTrace(),
        finalAnswer: modelOutput.text,
        stepCount,
      };
    }

    // Tool call path.
    const { toolName, toolInput } = modelOutput;
    recorder.append("tool_call", { toolName, toolInput });

    let toolResult: JsonValue;
    try {
      toolResult = await executeTool(tools, toolName, toolInput);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      recorder.append("tool_result", { toolName, error: detail });
      throw new Error(`Agent loop aborted: ${detail}`);
    }

    recorder.append("tool_result", { toolName, result: toolResult });

    // Feed the result back as the next round of messages.
    messages.push({ role: "assistant", content: `[tool_call:${toolName}]` });
    messages.push({ role: "user", content: JSON.stringify(toolResult) });
  }

  throw new Error(`Agent loop exceeded max steps (${maxSteps}).`);
}
