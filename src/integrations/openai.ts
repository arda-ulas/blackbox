// OpenAI Chat Completions (`POST /v1/chat/completions`) ↔ neutral step payloads.
//
// Request → `model_input`: leading `system`/`developer` messages become
// `systemPrompt` (joined in order); user/assistant/tool messages become neutral
// Messages, with consecutive `tool` messages grouped into one user turn of
// tool_result parts; function tools become ToolDefinitions; behavior-relevant
// controls go into `params`.
// Response → `model_output`: `tool_calls` become a `tool_calls` output (with
// `arguments` JSON-parsed, falling back to the raw string), otherwise the
// message content is a `final_answer`.
//
// The Responses API, streaming, `n > 1`, and non-text content parts are
// rejected with a BlackboxUnsupportedError naming the feature.

import type OpenAI from "openai";
import type { Message, MessagePart, ToolDefinition } from "../agent/modelClient.ts";
import type { JsonObject, JsonValue } from "../trace/TraceTypes.ts";
import {
  isRecord,
  json,
  joinTextBlocks,
  pickParams,
  STREAMING_ADVICE,
  unsupported,
  type NeutralOutput,
  type ToolCallIds,
} from "./common.ts";

export const OPENAI_CHAT_PATH = "/chat/completions";
export const OPENAI_RESPONSES_PATH = "/responses";

const PARAMS: Record<string, string> = {
  max_tokens: "maxTokens",
  max_completion_tokens: "maxTokens",
  temperature: "temperature",
  top_p: "topP",
  tool_choice: "toolChoice",
  response_format: "responseFormat",
  stop: "stop",
  parallel_tool_calls: "parallelToolCalls",
  seed: "seed",
  reasoning_effort: "reasoningEffort",
  presence_penalty: "presencePenalty",
  frequency_penalty: "frequencyPenalty",
  logit_bias: "logitBias",
  logprobs: "logprobs",
  top_logprobs: "topLogprobs",
  verbosity: "verbosity",
  prediction: "prediction",
  modalities: "modalities",
};

export function checkOpenAIRequest(body: Record<string, unknown>): void {
  if (body["stream"] === true) unsupported("stream: true", STREAMING_ADVICE);
  if (typeof body["n"] === "number" && body["n"] !== 1) unsupported("n > 1", "request one choice per call");
}

function contentText(content: unknown, where: string): string {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (isRecord(part) && part["type"] === "refusal" && typeof part["refusal"] === "string") return part["refusal"];
        return joinTextBlocks([part], where);
      })
      .join("\n\n");
  }
  return unsupported(`content at ${where}`, "send string or text-part content");
}

function parseArguments(raw: unknown): JsonValue {
  if (typeof raw !== "string") return json(raw ?? {});
  try {
    return json(JSON.parse(raw));
  } catch {
    return raw;
  }
}

/** The `model_input` payload for a Chat Completions request body. */
export function normalizeOpenAIRequest(body: Record<string, unknown>, ids: ToolCallIds): JsonObject {
  checkOpenAIRequest(body);

  const rawMessages = Array.isArray(body["messages"]) ? body["messages"].filter(isRecord) : [];
  const systemParts: string[] = [];
  let index = 0;
  while (index < rawMessages.length && (rawMessages[index]["role"] === "system" || rawMessages[index]["role"] === "developer")) {
    systemParts.push(contentText(rawMessages[index]["content"], `messages[${index}]`));
    index++;
  }

  const messages: Message[] = [];
  let pendingResults: MessagePart[] | null = null;
  const flushResults = (): void => {
    if (pendingResults !== null) messages.push({ role: "user", content: pendingResults });
    pendingResults = null;
  };

  for (; index < rawMessages.length; index++) {
    const raw = rawMessages[index];
    const where = `messages[${index}]`;
    const role = raw["role"];

    if (role === "tool") {
      const { toolCallId, toolName } = ids.resolve(String(raw["tool_call_id"]));
      pendingResults ??= [];
      pendingResults.push({ type: "tool_result", toolCallId, toolName, result: contentText(raw["content"], where) });
      continue;
    }
    flushResults();

    if (role === "user") {
      const content = raw["content"];
      messages.push({ role: "user", content: typeof content === "string" ? content : contentText(content, where) });
    } else if (role === "assistant") {
      const text = contentText(raw["content"] ?? raw["refusal"], where);
      const toolCalls = Array.isArray(raw["tool_calls"]) ? raw["tool_calls"].filter(isRecord) : [];
      if (toolCalls.length === 0) {
        messages.push({ role: "assistant", content: text });
        continue;
      }
      const parts: MessagePart[] = text.length > 0 ? [{ type: "text", text }] : [];
      for (const call of toolCalls) {
        const fn = isRecord(call["function"]) ? call["function"] : {};
        const toolName = String(fn["name"]);
        const { toolCallId } = ids.resolve(String(call["id"]), toolName);
        parts.push({ type: "tool_use", toolCallId, toolName, toolInput: parseArguments(fn["arguments"]) });
      }
      messages.push({ role: "assistant", content: parts });
    } else if (role === "system" || role === "developer") {
      unsupported(`a ${role} message after the conversation starts (${where})`, "put system and developer messages first");
    } else {
      unsupported(`"${String(role)}" messages`, "use user, assistant, tool, system or developer messages");
    }
  }
  flushResults();

  const tools: ToolDefinition[] = [];
  for (const tool of Array.isArray(body["tools"]) ? body["tools"] : []) {
    if (!isRecord(tool)) continue;
    if (tool["type"] !== "function" || !isRecord(tool["function"])) {
      unsupported(`"${String(tool["type"])}" tools`, "only function tools can be recorded in this version");
    }
    const fn = tool["function"] as Record<string, unknown>;
    const definition: ToolDefinition = {
      name: String(fn["name"]),
      description: typeof fn["description"] === "string" ? fn["description"] : "",
    };
    if (isRecord(fn["parameters"])) definition.inputSchema = json(fn["parameters"]) as JsonObject;
    tools.push(definition);
  }

  const payload: JsonObject = {
    messages: messages as unknown as JsonValue,
    tools: tools as unknown as JsonValue,
  };
  if (systemParts.length > 0) payload["systemPrompt"] = systemParts.join("\n\n");
  if (typeof body["model"] === "string") payload["model"] = body["model"];
  const params = pickParams(body, PARAMS);
  if (params) payload["params"] = params;
  return payload;
}

/** The `model_output` payload for a Chat Completions response body. */
export function normalizeOpenAIResponse(response: Record<string, unknown>, ids: ToolCallIds): NeutralOutput {
  const choices = Array.isArray(response["choices"]) ? response["choices"].filter(isRecord) : [];
  const choice = choices[0];
  if (choice === undefined || !isRecord(choice["message"])) {
    unsupported("a completion without choices[0].message", "check the provider response");
  }
  const message = choice["message"] as Record<string, unknown>;
  const finish = choice["finish_reason"];
  const refusal = typeof message["refusal"] === "string" ? message["refusal"] : undefined;
  const text = typeof message["content"] === "string" ? message["content"] : "";

  const calls: Array<{ toolCallId: string; toolName: string; toolInput: JsonValue }> = [];
  for (const call of Array.isArray(message["tool_calls"]) ? message["tool_calls"].filter(isRecord) : []) {
    if (call["type"] !== "function" || !isRecord(call["function"])) {
      unsupported(`"${String(call["type"])}" tool calls`, "only function tools can be recorded in this version");
    }
    const fn = call["function"] as Record<string, unknown>;
    const toolName = String(fn["name"]);
    calls.push({ toolCallId: ids.assign(String(call["id"]), toolName), toolName, toolInput: parseArguments(fn["arguments"]) });
  }

  if (calls.length > 0) {
    const output: NeutralOutput = { type: "tool_calls", calls };
    if (text.length > 0) output.text = text;
    if (finish === "length") output.stop = "length";
    return output;
  }
  if (refusal !== undefined) return { type: "final_answer", text: refusal, stop: "refusal" };
  const output: NeutralOutput = { type: "final_answer", text };
  if (finish === "length") output.stop = "length";
  return output;
}

/**
 * A Chat Completions response body that replays a recorded output. Tool-call
 * ids are the neutral `call-N` ids; usage is zero.
 */
export function synthesizeOpenAIResponse(
  output: NeutralOutput,
  model: string,
  responseId: string,
  createdSeconds: number,
): JsonObject {
  const refused = output.type === "final_answer" && output.stop === "refusal";
  const message: OpenAI.ChatCompletionMessage = {
    role: "assistant",
    content: refused ? null : output.text !== undefined && output.text.length > 0 ? output.text : null,
    refusal: refused ? (output.text ?? "") : null,
  };
  if (output.type === "tool_calls") {
    message.tool_calls = output.calls.map((call) => ({
      id: call.toolCallId,
      type: "function" as const,
      function: {
        name: call.toolName,
        arguments: typeof call.toolInput === "string" ? call.toolInput : JSON.stringify(call.toolInput),
      },
    }));
  }
  let finishReason: OpenAI.ChatCompletion.Choice["finish_reason"] = output.type === "tool_calls" ? "tool_calls" : "stop";
  if (output.stop === "length") finishReason = "length";

  const completion = {
    id: responseId,
    object: "chat.completion",
    created: createdSeconds,
    model,
    choices: [{ index: 0, message, finish_reason: finishReason, logprobs: null }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  } satisfies OpenAI.ChatCompletion;
  return json(completion) as JsonObject;
}
