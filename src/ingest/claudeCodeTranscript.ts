// Claude Code transcript adapter.
//
// Converts the message-bearing subset of a Claude Code JSONL session into an
// ordinary provider-neutral Blackbox v2 trace. The source JSONL is retained by
// the caller; this adapter is pure and never reads files, executes tools, calls
// a model, or consults the clock/environment.
//
// This is intentionally a narrow root-session slice. It supports one initial
// human prompt, sequential tool_use -> tool_result rounds, recoverable tool
// errors, follow-up human turns, and a terminal assistant text block. Provider ids, model/usage/stop
// metadata, thinking blocks, and intermediate assistant narration are dropped.
// Parallel tool calls and sidechain/subagent messages are rejected rather than
// silently flattened.

import { type Message, type MessagePart, type ToolDefinition } from "../agent/modelClient.ts";
import { toolCallIdForIndex } from "../agent/toolCallId.ts";
import { TraceRecorder } from "../trace/TraceRecorder.ts";
import { type JsonObject, type JsonValue, type Trace } from "../trace/TraceTypes.ts";

export interface AdaptClaudeCodeTranscriptOptions {
  traceId: string;
}

export class ClaudeCodeTranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeCodeTranscriptError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown, where: string): JsonValue {
  if (value === null) return null;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return value as string | boolean;
  if (kind === "number") {
    if (!Number.isFinite(value as number)) {
      throw new ClaudeCodeTranscriptError(`${where}: number must be finite`);
    }
    return value as number;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => toJsonValue(item, `${where}[${index}]`));
  }
  if (isRecord(value)) {
    const copy: JsonObject = {};
    for (const key of Object.keys(value)) {
      copy[key] = toJsonValue(value[key], `${where}.${key}`);
    }
    return copy;
  }
  throw new ClaudeCodeTranscriptError(`${where}: value is not JSON-safe (${kind})`);
}

function timestampOf(event: Record<string, unknown>, where: string): number {
  const value = event["timestamp"];
  if (typeof value !== "string") {
    throw new ClaudeCodeTranscriptError(`${where}.timestamp must be an ISO timestamp string`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new ClaudeCodeTranscriptError(`${where}.timestamp is not a valid ISO timestamp`);
  }
  return timestamp;
}

function parseToolResultContent(value: unknown, where: string): JsonValue {
  if (typeof value !== "string") {
    throw new ClaudeCodeTranscriptError(`${where}.content must be a string`);
  }
  try {
    return toJsonValue(JSON.parse(value) as unknown, `${where}.content`);
  } catch (error) {
    if (error instanceof ClaudeCodeTranscriptError) throw error;
    return value;
  }
}

/** Parse newline-delimited Claude Code session JSON without interpreting it. */
export function parseClaudeCodeJsonl(raw: string): unknown[] {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new ClaudeCodeTranscriptError("Claude Code JSONL must be a non-empty string");
  }

  return raw
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, index }) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        throw new ClaudeCodeTranscriptError(`Claude Code JSONL line ${index + 1} is not valid JSON`);
      }
    });
}

interface SourceMessage {
  event: Record<string, unknown>;
  message: Record<string, unknown>;
  sourceIndex: number;
}

function messageEvents(input: unknown): SourceMessage[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ClaudeCodeTranscriptError("Claude Code transcript must be a non-empty event array");
  }

  const messages: SourceMessage[] = [];
  for (let sourceIndex = 0; sourceIndex < input.length; sourceIndex++) {
    const event = input[sourceIndex];
    if (!isRecord(event)) {
      throw new ClaudeCodeTranscriptError(`events[${sourceIndex}] must be an object`);
    }
    if (event["isSidechain"] === true && (event["type"] === "user" || event["type"] === "assistant")) {
      throw new ClaudeCodeTranscriptError(
        `events[${sourceIndex}]: sidechain/subagent messages are not supported`,
      );
    }
    if (event["type"] !== "user" && event["type"] !== "assistant") continue;
    const message = event["message"];
    if (!isRecord(message)) {
      throw new ClaudeCodeTranscriptError(`events[${sourceIndex}].message must be an object`);
    }
    messages.push({ event, message, sourceIndex });
  }

  if (messages.length === 0) {
    throw new ClaudeCodeTranscriptError("Claude Code transcript contains no user/assistant messages");
  }

  // Persisted Claude Code JSONL can contain one narrow append-order inversion:
  // a tool_result line immediately precedes the assistant tool_use line it
  // references, while the parentUuid edge still says result -> tool_use. Repair
  // only that directly evidenced adjacent pair. Anything less local remains an
  // unsupported branch/order shape and is rejected by the main state machine.
  for (let index = 0; index + 1 < messages.length; index++) {
    const resultEntry = messages[index];
    const useEntry = messages[index + 1];
    const resultContent = resultEntry.message["content"];
    const useContent = useEntry.message["content"];
    if (!Array.isArray(resultContent) || !Array.isArray(useContent)) continue;
    const resultBlocks = resultContent.filter(isRecord).filter((block) => block["type"] === "tool_result");
    const useBlocks = useContent.filter(isRecord).filter((block) => block["type"] === "tool_use");
    if (
      resultEntry.message["role"] === "user" &&
      useEntry.message["role"] === "assistant" &&
      resultBlocks.length === 1 &&
      useBlocks.length === 1 &&
      resultBlocks[0]["tool_use_id"] === useBlocks[0]["id"] &&
      resultEntry.event["parentUuid"] === useEntry.event["uuid"]
    ) {
      messages[index] = useEntry;
      messages[index + 1] = resultEntry;
      index += 1;
    }
  }
  return messages;
}

export function adaptClaudeCodeTranscript(
  input: unknown,
  options: AdaptClaudeCodeTranscriptOptions,
): Trace {
  const traceId = options?.traceId;
  if (typeof traceId !== "string" || traceId.length === 0) {
    throw new ClaudeCodeTranscriptError("options.traceId must be a non-empty string");
  }

  const source = messageEvents(input);
  const first = source[0];
  if (first.message["role"] !== "user" || typeof first.message["content"] !== "string") {
    throw new ClaudeCodeTranscriptError(
      `events[${first.sourceIndex}]: transcript must begin with a string user prompt`,
    );
  }
  const prompt = first.message["content"];
  if (prompt.length === 0) {
    throw new ClaudeCodeTranscriptError("the initial user prompt must be non-empty");
  }

  // Claude Code's persisted transcript does not include the original tool
  // definitions. Preserve only the unique observed names, in first-use order,
  // and label the unavailable definition honestly.
  const toolNames: string[] = [];
  for (const entry of source) {
    const content = entry.message["content"];
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block) || block["type"] !== "tool_use") continue;
      const name = block["name"];
      if (typeof name === "string" && name.length > 0 && !toolNames.includes(name)) {
        toolNames.push(name);
      }
    }
  }
  const toolDefs: ToolDefinition[] = toolNames.map((name) => ({
    name,
    description: "Observed in Claude Code transcript; original definition unavailable.",
  }));

  const recorder = new TraceRecorder(traceId, {
    createdAt: timestampOf(first.event, `events[${first.sourceIndex}]`),
  });
  const history: Message[] = [{ role: "user", content: prompt }];
  const seenProviderCallIds = new Set<string>();
  let pending:
    | {
        providerCallId: string;
        toolCallId: string;
        toolName: string;
        toolInput: JsonValue;
      }
    | undefined;
  let nextCallIndex = 0;
  let finalText: string | undefined;
  let finalTimestamp: number | undefined;

  for (let position = 1; position < source.length; position++) {
    const entry = source[position];
    const role = entry.message["role"];
    const content = entry.message["content"];
    const where = `events[${entry.sourceIndex}]`;

    if (role === "assistant") {
      if (!Array.isArray(content)) {
        throw new ClaudeCodeTranscriptError(`${where}.message.content must be an array`);
      }
      const blocks = content.filter(isRecord);
      const toolUses = blocks.filter((block) => block["type"] === "tool_use");
      if (toolUses.length > 1) {
        throw new ClaudeCodeTranscriptError(
          `${where}: parallel tool calls are not supported (found ${toolUses.length})`,
        );
      }
      if (toolUses.length === 1) {
        if (pending) {
          throw new ClaudeCodeTranscriptError(
            `${where}: tool call arrived before result for ${JSON.stringify(pending.toolName)}`,
          );
        }
        const block = toolUses[0];
        const providerCallId = block["id"];
        const toolName = block["name"];
        if (typeof providerCallId !== "string" || providerCallId.length === 0) {
          throw new ClaudeCodeTranscriptError(`${where}: tool_use.id must be a non-empty string`);
        }
        if (seenProviderCallIds.has(providerCallId)) {
          throw new ClaudeCodeTranscriptError(`${where}: duplicate tool_use.id`);
        }
        if (typeof toolName !== "string" || toolName.length === 0) {
          throw new ClaudeCodeTranscriptError(`${where}: tool_use.name must be a non-empty string`);
        }
        const toolInput = toJsonValue(block["input"], `${where}.tool_use.input`);
        const toolCallId = toolCallIdForIndex(nextCallIndex++);
        const timestamp = timestampOf(entry.event, where);

        seenProviderCallIds.add(providerCallId);
        recorder.append("model_input", { messages: history, tools: toolDefs } as unknown as JsonValue, timestamp);
        recorder.append("model_output", { type: "tool_call", toolCallId, toolName, toolInput }, timestamp);
        recorder.append("tool_call", { toolCallId, toolName, toolInput }, timestamp);
        pending = { providerCallId, toolCallId, toolName, toolInput };
        continue;
      }

      // Thinking and non-terminal narration are deliberately not representable
      // in v2. Only an end_turn text block becomes the terminal final answer.
      if (entry.message["stop_reason"] === "end_turn") {
        const textBlocks = blocks.filter((block) => block["type"] === "text");
        for (const block of textBlocks) {
          if (typeof block["text"] === "string" && block["text"].length > 0) {
            finalText = block["text"];
            finalTimestamp = timestampOf(entry.event, where);
          }
        }
      }
      continue;
    }

    if (role !== "user") {
      throw new ClaudeCodeTranscriptError(`${where}.message.role is unsupported`);
    }
    if (typeof content === "string") {
      if (pending) {
        throw new ClaudeCodeTranscriptError(`${where}: human turn arrived before a pending tool result`);
      }
      if (content.length === 0) {
        throw new ClaudeCodeTranscriptError(`${where}: follow-up human turn must be non-empty`);
      }
      history.push({ role: "user", content });
      continue;
    }
    if (!Array.isArray(content)) {
      throw new ClaudeCodeTranscriptError(`${where}.message.content must be an array`);
    }
    const resultBlocks = content.filter(isRecord).filter((block) => block["type"] === "tool_result");
    if (resultBlocks.length !== 1) {
      throw new ClaudeCodeTranscriptError(`${where}: expected exactly one tool_result block`);
    }
    if (!pending) {
      throw new ClaudeCodeTranscriptError(`${where}: tool_result has no pending tool call`);
    }
    const resultBlock = resultBlocks[0];
    if (resultBlock["tool_use_id"] !== pending.providerCallId) {
      throw new ClaudeCodeTranscriptError(`${where}: tool_result references an unknown tool_use_id`);
    }
    const resultText = resultBlock["content"];
    const timestamp = timestampOf(entry.event, where);
    let resultPart: MessagePart;
    if (resultBlock["is_error"] === true) {
      if (typeof resultText !== "string") {
        throw new ClaudeCodeTranscriptError(`${where}.tool_result.content must be a string`);
      }
      recorder.append("tool_result", {
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        error: resultText,
      }, timestamp);
      resultPart = {
        type: "tool_result",
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        error: resultText,
      };
    } else {
      const result = parseToolResultContent(resultText, `${where}.tool_result`);
      recorder.append("tool_result", {
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        result,
      }, timestamp);
      resultPart = {
        type: "tool_result",
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        result,
      };
    }

    history.push({
      role: "assistant",
      content: [{
        type: "tool_use",
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        toolInput: pending.toolInput,
      }],
    });
    history.push({ role: "user", content: [resultPart] });
    pending = undefined;
  }

  if (pending) {
    throw new ClaudeCodeTranscriptError(
      `transcript ended before result for ${JSON.stringify(pending.toolName)}`,
    );
  }
  if (finalText === undefined || finalTimestamp === undefined) {
    throw new ClaudeCodeTranscriptError("transcript is missing a terminal end_turn assistant text block");
  }

  recorder.append(
    "model_input",
    { messages: history, tools: toolDefs } as unknown as JsonValue,
    finalTimestamp,
  );
  recorder.append("model_output", { type: "final_answer", text: finalText }, finalTimestamp);
  recorder.append(
    "metadata",
    { event: "run_completed", status: "success", result: finalText },
    finalTimestamp,
  );
  return recorder.getTrace();
}
