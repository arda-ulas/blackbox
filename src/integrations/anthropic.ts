// Anthropic Messages API (`POST /v1/messages`) ↔ neutral step payloads.
//
// Request → `model_input`: `system` becomes `systemPrompt`; `messages` become
// neutral Messages (tool_use/tool_result ids mapped to `call-N`); custom tools
// become ToolDefinitions; behavior-relevant controls go into `params`.
// Response → `model_output`: tool_use blocks become a `tool_calls` output (text
// blocks alongside become its `text`), a text-only response a `final_answer`.
//
// Thinking blocks are dropped in both directions, so a recording and its replay
// agree. Images, documents, server tools and streaming are rejected with a
// BlackboxUnsupportedError naming the feature.

import type Anthropic from "@anthropic-ai/sdk";
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

export const ANTHROPIC_PATH = "/v1/messages";

const PARAMS: Record<string, string> = {
  max_tokens: "maxTokens",
  temperature: "temperature",
  top_p: "topP",
  top_k: "topK",
  tool_choice: "toolChoice",
  stop_sequences: "stop",
  output_config: "outputConfig",
  thinking: "thinking",
};

const DROPPED_BLOCKS = new Set(["thinking", "redacted_thinking"]);

/** Reject request features this version cannot record or replay. */
export function checkAnthropicRequest(body: Record<string, unknown>): void {
  if (body["stream"] === true) unsupported("stream: true", STREAMING_ADVICE);
}

function toolResultValue(block: Record<string, unknown>, where: string): JsonValue {
  const content = block["content"];
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return joinTextBlocks(content, where);
  return json(content);
}

function normalizeContent(
  role: "user" | "assistant",
  content: unknown,
  ids: ToolCallIds,
  where: string,
): string | MessagePart[] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) unsupported(`non-array content at ${where}`, "send string or block content");
  const parts: MessagePart[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const type = block["type"];
    if (typeof type === "string" && DROPPED_BLOCKS.has(type)) continue;
    if (type === "text" && typeof block["text"] === "string") {
      parts.push({ type: "text", text: block["text"] });
    } else if (type === "tool_use" && role === "assistant") {
      const name = String(block["name"]);
      const { toolCallId } = ids.resolve(String(block["id"]), name);
      parts.push({ type: "tool_use", toolCallId, toolName: name, toolInput: json(block["input"] ?? {}) });
    } else if (type === "tool_result" && role === "user") {
      const { toolCallId, toolName } = ids.resolve(String(block["tool_use_id"]));
      if (block["is_error"] === true) {
        const value = toolResultValue(block, `${where}.tool_result`);
        parts.push({ type: "tool_result", toolCallId, toolName, error: typeof value === "string" ? value : JSON.stringify(value) });
      } else {
        parts.push({ type: "tool_result", toolCallId, toolName, result: toolResultValue(block, `${where}.tool_result`) });
      }
    } else {
      unsupported(`"${String(type)}" content blocks`, "only text, tool_use and tool_result blocks can be recorded in this version");
    }
  }
  return parts;
}

/** The `model_input` payload for an Anthropic Messages request body. */
export function normalizeAnthropicRequest(body: Record<string, unknown>, ids: ToolCallIds): JsonObject {
  checkAnthropicRequest(body);

  const messages: Message[] = [];
  const rawMessages = Array.isArray(body["messages"]) ? body["messages"] : [];
  rawMessages.forEach((raw, index) => {
    if (!isRecord(raw)) return;
    const role = raw["role"] === "assistant" ? "assistant" : "user";
    messages.push({ role, content: normalizeContent(role, raw["content"], ids, `messages[${index}]`) });
  });

  const tools: ToolDefinition[] = [];
  for (const tool of Array.isArray(body["tools"]) ? body["tools"] : []) {
    if (!isRecord(tool)) continue;
    const type = tool["type"];
    if (type !== undefined && type !== null && type !== "custom") {
      unsupported(`server tool "${String(type)}"`, "only custom (client-executed) tools can be recorded in this version");
    }
    const definition: ToolDefinition = {
      name: String(tool["name"]),
      description: typeof tool["description"] === "string" ? tool["description"] : "",
    };
    if (isRecord(tool["input_schema"])) definition.inputSchema = json(tool["input_schema"]) as JsonObject;
    tools.push(definition);
  }

  const payload: JsonObject = {
    messages: messages as unknown as JsonValue,
    tools: tools as unknown as JsonValue,
  };
  const system = body["system"];
  if (typeof system === "string") payload["systemPrompt"] = system;
  else if (Array.isArray(system)) payload["systemPrompt"] = joinTextBlocks(system, "system");
  if (typeof body["model"] === "string") payload["model"] = body["model"];
  const params = pickParams(body, PARAMS);
  if (params) payload["params"] = params;
  return payload;
}

/** The `model_output` payload for an Anthropic Messages response body. */
export function normalizeAnthropicResponse(response: Record<string, unknown>, ids: ToolCallIds): NeutralOutput {
  const content = Array.isArray(response["content"]) ? response["content"] : [];
  const texts: string[] = [];
  const calls: Array<{ toolCallId: string; toolName: string; toolInput: JsonValue }> = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    const type = block["type"];
    if (typeof type === "string" && DROPPED_BLOCKS.has(type)) continue;
    if (type === "text" && typeof block["text"] === "string") {
      if (block["text"].length > 0) texts.push(block["text"]);
    } else if (type === "tool_use") {
      const toolName = String(block["name"]);
      calls.push({ toolCallId: ids.assign(String(block["id"]), toolName), toolName, toolInput: json(block["input"] ?? {}) });
    } else {
      unsupported(`"${String(type)}" response blocks`, "only text and tool_use responses can be recorded in this version");
    }
  }

  const stopReason = response["stop_reason"];
  if (stopReason === "pause_turn") unsupported("stop_reason pause_turn (server tools)", "use client-executed tools");
  const text = texts.join("\n\n");
  const truncated = stopReason === "max_tokens" || stopReason === "model_context_window_exceeded";

  if (calls.length > 0) {
    const output: NeutralOutput = { type: "tool_calls", calls };
    if (text.length > 0) output.text = text;
    if (truncated) output.stop = "length";
    return output;
  }
  const output: NeutralOutput = { type: "final_answer", text };
  if (truncated) output.stop = "length";
  if (stopReason === "refusal") output.stop = "refusal";
  return output;
}

/**
 * An Anthropic Messages response body that replays a recorded output. Tool-use
 * ids are the neutral `call-N` ids; usage is zero.
 */
export function synthesizeAnthropicResponse(output: NeutralOutput, model: string, responseId: string): JsonObject {
  const content: Array<Anthropic.TextBlock | Anthropic.ToolUseBlock> = [];
  if (output.text !== undefined && output.text.length > 0) {
    content.push({ type: "text", text: output.text, citations: null });
  }
  if (output.type === "tool_calls") {
    for (const call of output.calls) {
      content.push({ type: "tool_use", id: call.toolCallId, name: call.toolName, input: call.toolInput, caller: { type: "direct" } });
    }
  }
  let stopReason: Anthropic.StopReason = output.type === "tool_calls" ? "tool_use" : "end_turn";
  if (output.stop === "length") stopReason = "max_tokens";
  if (output.stop === "refusal") stopReason = "refusal";

  const message = {
    id: responseId,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    diagnostics: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
      output_tokens_details: null,
    },
  } satisfies Anthropic.Message;
  return json(message) as JsonObject;
}
