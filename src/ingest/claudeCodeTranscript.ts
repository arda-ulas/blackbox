// Claude Code transcript adapter.
//
// Converts the message-bearing subset of a Claude Code JSONL session into an
// ordinary provider-neutral Blackbox v2 trace. The source JSONL is retained by
// the caller; this adapter is pure and never reads files, executes tools, calls
// a model, or consults the clock/environment.
//
// Claude Code persists one content block per JSONL line, so a single API
// message (one `message.id`) is spread over several consecutive assistant
// lines, and its tool results arrive as separate user lines — sometimes
// interleaved with, or even ahead of, the tool_use lines they answer. The
// adapter therefore:
//
//   1. merges assistant lines that share a `message.id` into one model turn,
//      positioned at its first line;
//   2. indexes every tool_result block by `tool_use_id`, wherever it appears;
//   3. walks the turns in order: a turn with tool_use blocks becomes a
//      `tool_calls` model output (parallel calls and narration text included),
//      followed by one tool_call/tool_result pair per call in call order; a
//      text-only turn becomes a `final_answer`; human text turns extend the
//      conversation history.
//
// The run is `run_completed` when its last model turn is a final answer and
// incomplete otherwise. Provider ids, model/usage/stop metadata and thinking
// blocks are dropped. Sidechain (subagent) lines are skipped: the subagent's
// work reaches the root session only through its tool result.

import { type Message, type MessagePart, type ToolDefinition } from "../agent/modelClient.ts";
import { type ToolCallRef } from "../trace/payloads.ts";
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

interface SourceLine {
  event: Record<string, unknown>;
  message: Record<string, unknown>;
  sourceIndex: number;
}

type Block = Record<string, unknown>;

interface ModelTurn {
  kind: "model";
  where: string;
  timestamp: number;
  blocks: Block[];
}

interface HumanTurn {
  kind: "human";
  text: string;
}

interface ResultEntry {
  block: Block;
  where: string;
  timestamp: number;
}

function contentBlocks(message: Record<string, unknown>): Block[] {
  const content = message["content"];
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

function sourceLines(input: unknown): SourceLine[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ClaudeCodeTranscriptError("Claude Code transcript must be a non-empty event array");
  }

  const lines: SourceLine[] = [];
  for (let sourceIndex = 0; sourceIndex < input.length; sourceIndex++) {
    const event = input[sourceIndex];
    if (!isRecord(event)) {
      throw new ClaudeCodeTranscriptError(`events[${sourceIndex}] must be an object`);
    }
    if (event["type"] !== "user" && event["type"] !== "assistant") continue;
    if (event["isSidechain"] === true) continue;
    const message = event["message"];
    if (!isRecord(message)) {
      throw new ClaudeCodeTranscriptError(`events[${sourceIndex}].message must be an object`);
    }
    lines.push({ event, message, sourceIndex });
  }

  if (lines.length === 0) {
    throw new ClaudeCodeTranscriptError("Claude Code transcript contains no user/assistant messages");
  }
  return lines;
}

/** Text of a tool_result block's content, JSON-parsed when it is a JSON string. */
function toolResultValue(block: Block, where: string): JsonValue {
  const content = block["content"];
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return parseToolResultContent(content, where);
  if (Array.isArray(content)) {
    return content
      .filter(isRecord)
      .map((part) =>
        part["type"] === "text" && typeof part["text"] === "string"
          ? part["text"]
          : `[${String(part["type"] ?? "content")} omitted]`,
      )
      .join("\n");
  }
  throw new ClaudeCodeTranscriptError(`${where}.content must be a string or an array of blocks`);
}

function toolResultError(block: Block): string {
  const value = toolResultValue(block, "tool_result");
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Human text from a user message: string content or its text blocks. */
function humanText(message: Record<string, unknown>): string {
  const content = message["content"];
  if (typeof content === "string") return content;
  return contentBlocks(message)
    .filter((block) => block["type"] !== "tool_result")
    .map((block) =>
      block["type"] === "text" && typeof block["text"] === "string"
        ? block["text"]
        : `[${String(block["type"] ?? "content")} omitted]`,
    )
    .join("\n");
}

export function adaptClaudeCodeTranscript(
  input: unknown,
  options: AdaptClaudeCodeTranscriptOptions,
): Trace {
  const traceId = options?.traceId;
  if (typeof traceId !== "string" || traceId.length === 0) {
    throw new ClaudeCodeTranscriptError("options.traceId must be a non-empty string");
  }

  const lines = sourceLines(input);

  // Pass 1: merge assistant lines into model turns (by message.id), collect
  // human turns in order, and index every tool_result by the call it answers.
  const turns: Array<ModelTurn | HumanTurn> = [];
  const turnById = new Map<string, ModelTurn>();
  const results = new Map<string, ResultEntry>();

  for (const line of lines) {
    const where = `events[${line.sourceIndex}]`;
    const role = line.message["role"];

    if (role === "assistant") {
      const content = line.message["content"];
      if (!Array.isArray(content)) {
        throw new ClaudeCodeTranscriptError(`${where}.message.content must be an array`);
      }
      const id = line.message["id"];
      const existing = typeof id === "string" ? turnById.get(id) : undefined;
      if (existing) {
        existing.blocks.push(...contentBlocks(line.message));
        continue;
      }
      const turn: ModelTurn = {
        kind: "model",
        where,
        timestamp: timestampOf(line.event, where),
        blocks: contentBlocks(line.message),
      };
      if (typeof id === "string") turnById.set(id, turn);
      turns.push(turn);
      continue;
    }

    if (role !== "user") {
      throw new ClaudeCodeTranscriptError(`${where}.message.role is unsupported`);
    }
    for (const block of contentBlocks(line.message)) {
      if (block["type"] !== "tool_result") continue;
      const callId = block["tool_use_id"];
      if (typeof callId !== "string" || callId.length === 0) {
        throw new ClaudeCodeTranscriptError(`${where}: tool_result.tool_use_id must be a non-empty string`);
      }
      if (results.has(callId)) {
        throw new ClaudeCodeTranscriptError(`${where}: duplicate tool_result for one tool_use_id`);
      }
      results.set(callId, { block, where: `${where}.tool_result`, timestamp: timestampOf(line.event, where) });
    }
    const text = humanText(line.message);
    if (text.length > 0) turns.push({ kind: "human", text });
  }

  const firstModel = turns.find((turn): turn is ModelTurn => turn.kind === "model");
  if (firstModel === undefined) {
    throw new ClaudeCodeTranscriptError("Claude Code transcript contains no assistant messages");
  }

  // Claude Code's persisted transcript does not include the original tool
  // definitions. Preserve only the unique observed names, in first-use order,
  // and label the unavailable definition honestly.
  const toolNames: string[] = [];
  for (const turn of turns) {
    if (turn.kind !== "model") continue;
    for (const block of turn.blocks) {
      const name = block["name"];
      if (block["type"] === "tool_use" && typeof name === "string" && name.length > 0 && !toolNames.includes(name)) {
        toolNames.push(name);
      }
    }
  }
  const toolDefs: ToolDefinition[] = toolNames.map((name) => ({
    name,
    description: "Observed in Claude Code transcript; original definition unavailable.",
  }));

  // Pass 2: emit the trace.
  const firstTimestamp = timestampOf(lines[0].event, `events[${lines[0].sourceIndex}]`);
  const recorder = new TraceRecorder(traceId, { createdAt: firstTimestamp });
  const history: Message[] = [];
  const seenProviderCallIds = new Set<string>();
  const consumedResults = new Set<string>();
  let nextCallIndex = 0;
  let lastFinal: { text: string; timestamp: number } | undefined;

  const lastModelTurn = turns.findLast((turn): turn is ModelTurn => turn.kind === "model");

  for (const turn of turns) {
    if (turn.kind === "human") {
      history.push({ role: "user", content: turn.text });
      continue;
    }

    const where = turn.where;
    const text = turn.blocks
      .filter((block) => block["type"] === "text" && typeof block["text"] === "string")
      .map((block) => block["text"] as string)
      .filter((value) => value.length > 0)
      .join("\n\n");
    const toolUses = turn.blocks.filter((block) => block["type"] === "tool_use");

    if (toolUses.length === 0) {
      // Thinking-only turns carry nothing representable; skip them.
      if (text.length === 0) continue;
      recorder.append("model_input", { messages: history, tools: toolDefs } as unknown as JsonValue, turn.timestamp);
      recorder.append("model_output", { type: "final_answer", text }, turn.timestamp);
      history.push({ role: "assistant", content: text });
      lastFinal = { text, timestamp: turn.timestamp };
      continue;
    }

    const calls: Array<{ providerCallId: string } & ToolCallRef> = [];
    for (const block of toolUses) {
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
      seenProviderCallIds.add(providerCallId);
      calls.push({
        providerCallId,
        toolCallId: toolCallIdForIndex(nextCallIndex++),
        toolName,
        toolInput: toJsonValue(block["input"], `${where}.tool_use.input`),
      });
    }

    const neutralCalls = calls.map(({ toolCallId, toolName, toolInput }) => ({ toolCallId, toolName, toolInput }));
    const output: JsonObject = { type: "tool_calls", calls: neutralCalls as unknown as JsonValue };
    if (text.length > 0) output["text"] = text;
    recorder.append("model_input", { messages: history, tools: toolDefs } as unknown as JsonValue, turn.timestamp);
    recorder.append("model_output", output, turn.timestamp);

    const resultParts: MessagePart[] = [];
    for (const call of calls) {
      const entry = results.get(call.providerCallId);
      if (entry === undefined) {
        // A session cut off while its last tools were running ends here,
        // incomplete. A missing result anywhere earlier is a malformed source.
        if (turn === lastModelTurn) {
          recorder.append("tool_call", { toolCallId: call.toolCallId, toolName: call.toolName, toolInput: call.toolInput }, turn.timestamp);
          return recorder.getTrace();
        }
        throw new ClaudeCodeTranscriptError(
          `transcript has no result for ${JSON.stringify(call.toolName)} (called at ${where})`,
        );
      }
      consumedResults.add(call.providerCallId);
      const timestamp = Math.max(entry.timestamp, turn.timestamp);
      recorder.append("tool_call", { toolCallId: call.toolCallId, toolName: call.toolName, toolInput: call.toolInput }, timestamp);
      if (entry.block["is_error"] === true) {
        const error = toolResultError(entry.block);
        recorder.append("tool_result", { toolCallId: call.toolCallId, toolName: call.toolName, error }, timestamp);
        resultParts.push({ type: "tool_result", toolCallId: call.toolCallId, toolName: call.toolName, error });
      } else {
        const result = toolResultValue(entry.block, entry.where);
        recorder.append("tool_result", { toolCallId: call.toolCallId, toolName: call.toolName, result }, timestamp);
        resultParts.push({ type: "tool_result", toolCallId: call.toolCallId, toolName: call.toolName, result });
      }
    }

    const assistant: MessagePart[] = [];
    if (text.length > 0) assistant.push({ type: "text", text });
    for (const call of neutralCalls) assistant.push({ type: "tool_use", ...call });
    history.push({ role: "assistant", content: assistant });
    history.push({ role: "user", content: resultParts });
    lastFinal = undefined;
  }

  for (const [callId, entry] of results) {
    if (!consumedResults.has(callId)) {
      throw new ClaudeCodeTranscriptError(`${entry.where}: tool_result references an unknown tool_use_id`);
    }
  }

  if (lastFinal !== undefined) {
    recorder.append(
      "metadata",
      { event: "run_completed", status: "success", result: lastFinal.text },
      lastFinal.timestamp,
    );
  }
  return recorder.getTrace();
}
