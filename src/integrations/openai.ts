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
// The Responses API, streaming, `n > 1`, non-text content parts, and fields the
// neutral schema cannot carry faithfully (audio, legacy functions, message
// names, strict tools, a content-filtered response) are rejected with a
// BlackboxUnsupportedError naming the field, never recorded or replayed altered.

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

const LEGACY_FUNCTIONS_ADVICE = "use tools and tool_choice instead of the legacy functions API";

export function checkOpenAIRequest(body: Record<string, unknown>): void {
  if (body["stream"] === true) unsupported("stream: true", STREAMING_ADVICE);
  if (typeof body["n"] === "number" && body["n"] !== 1) unsupported("n > 1", "request one choice per call");
  if (body["audio"] !== undefined && body["audio"] !== null) {
    unsupported("the audio request field (audio output)", "request text output; audio cannot be recorded in this version");
  }
  for (const field of ["functions", "function_call"]) {
    if (body[field] !== undefined && body[field] !== null) unsupported(`the legacy ${field} request field`, LEGACY_FUNCTIONS_ADVICE);
  }
  if (body["max_tokens"] !== undefined && body["max_tokens"] !== null && body["max_completion_tokens"] !== undefined && body["max_completion_tokens"] !== null) {
    unsupported("both max_tokens and max_completion_tokens", "send one of them; they are recorded as one value");
  }
  if (body["web_search_options"] !== undefined && body["web_search_options"] !== null) {
    unsupported("web_search_options (server-side search)", "search in a wrapped tool instead");
  }
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
}

/** Reject message fields the neutral schema does not carry. */
function checkOpenAIMessage(raw: Record<string, unknown>, where: string): void {
  if (raw["name"] !== undefined && raw["name"] !== null) {
    unsupported(`a message name (${where}.name)`, "leave name out; message names are not recorded in this version");
  }
  if (raw["function_call"] !== undefined && raw["function_call"] !== null) {
    unsupported(`a legacy function_call in the history (${where}.function_call)`, LEGACY_FUNCTIONS_ADVICE);
  }
  if (raw["audio"] !== undefined && raw["audio"] !== null) {
    unsupported(`audio in the history (${where}.audio)`, "audio cannot be recorded in this version");
  }
  if (raw["refusal"] !== undefined && raw["refusal"] !== null) {
    unsupported(`an assistant refusal in the history (${where}.refusal)`, "a refusal would be recorded as ordinary text");
  }
}

function contentText(content: unknown, where: string): string {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (isRecord(part) && part["type"] === "refusal") {
          unsupported(`a refusal part in the history (${where})`, "a refusal would be recorded as ordinary text");
        }
        return joinTextBlocks([part], where);
      })
      .join("\n\n");
  }
  return unsupported(`content at ${where}`, "send string or text-part content");
}

function parseArguments(raw: unknown): JsonValue {
  if (typeof raw !== "string") return json(raw ?? {});
  try {
    const parsed: unknown = JSON.parse(raw);
    // A JSON-encoded string stays encoded, so a replay hands back the same text.
    return typeof parsed === "string" ? raw : json(parsed);
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
    checkOpenAIMessage(rawMessages[index], `messages[${index}]`);
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
    checkOpenAIMessage(raw, where);

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
      const text = contentText(raw["content"], where);
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
  const rawTools = Array.isArray(body["tools"]) ? body["tools"] : [];
  rawTools.forEach((tool, toolIndex) => {
    if (!isRecord(tool)) return;
    if (tool["type"] !== "function" || !isRecord(tool["function"])) {
      unsupported(`"${String(tool["type"])}" tools`, "only function tools can be recorded in this version");
    }
    const fn = tool["function"] as Record<string, unknown>;
    // strict: false is the default, so it records the same as leaving it out.
    if (fn["strict"] !== undefined && fn["strict"] !== null && fn["strict"] !== false) {
      unsupported(`strict function tools (tools[${toolIndex}].function.strict)`, "leave strict out; it is not recorded in this version");
    }
    const definition: ToolDefinition = {
      name: String(fn["name"]),
      description: typeof fn["description"] === "string" ? fn["description"] : "",
    };
    if (isRecord(fn["parameters"])) definition.inputSchema = json(fn["parameters"]) as JsonObject;
    tools.push(definition);
  });

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
  if (finish === "content_filter") {
    unsupported("a response stopped by the content filter (finish_reason content_filter)", "it cannot be replayed faithfully in this version");
  }
  if (finish === "function_call" || (message["function_call"] !== undefined && message["function_call"] !== null)) {
    unsupported("a legacy function_call response", LEGACY_FUNCTIONS_ADVICE);
  }
  if (message["audio"] !== undefined && message["audio"] !== null) {
    unsupported("audio in a response (message.audio)", "request text output; audio cannot be recorded in this version");
  }
  // A replay returns none of these, so a response carrying them is not recorded.
  if (present(choice["logprobs"])) unsupported("logprobs in a response (choices[0].logprobs)", "leave logprobs off; they are not recorded in this version");
  if (present(message["annotations"])) unsupported("annotations in a response (message.annotations)", "they are not recorded in this version");
  const hasToolCalls = Array.isArray(message["tool_calls"]) && message["tool_calls"].length > 0;
  if (typeof message["refusal"] === "string" && (typeof message["content"] === "string" || hasToolCalls || finish !== "stop")) {
    unsupported(
      "a refusal together with content, tool calls or a finish_reason other than stop",
      "a replay returns a refusal alone, with finish_reason stop",
    );
  }
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

  // A replay gives tool calls null content (unless there is text) and a final
  // answer string content, as the API does; the other forms cannot come back.
  const content = message["content"];
  if (refusal === undefined && calls.length > 0 && content === "") {
    unsupported("tool calls with empty-string content", "a replay would return null content");
  }
  if (refusal === undefined && calls.length === 0 && typeof content !== "string") {
    unsupported("a response with no content, tool calls or refusal", "a replay would return empty-string content");
  }
  if (calls.length > 0) {
    // A replay answers tool calls with finish_reason tool_calls (or length).
    if (finish !== "tool_calls" && finish !== "length") {
      unsupported(
        `tool calls with finish_reason ${JSON.stringify(finish)} (the API returns stop when tool_choice names a function)`,
        "they would replay with finish_reason tool_calls; let the model choose the tool (tool_choice auto or required)",
      );
    }
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
  // A final answer's content is a string, even an empty one; tool calls
  // without text carry null content, as the API sends them.
  let content: string | null = null;
  if (!refused && output.type === "final_answer") content = output.text;
  if (output.type === "tool_calls" && output.text !== undefined && output.text.length > 0) content = output.text;
  const message: OpenAI.ChatCompletionMessage = {
    role: "assistant",
    content,
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
