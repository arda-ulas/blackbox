// Foreign transcript adapter — adapter-boundary proof (W10-A).
//
// Converts a synthetic, chat-style external agent transcript into a normal
// Blackbox v2 Trace, so the existing offline surfaces (verify / replay / assert /
// diff / inspect) can consume an externally-shaped run without any change to the
// core. This is an ADAPTER BOUNDARY PROOF, not a framework/SDK integration: the
// input shape is a generic synthetic chat transcript (roles, one tool call per
// assistant turn, tool results correlated by id), not any official provider or
// framework wire format, and nothing here imports or depends on an SDK.
//
// Guarantees (all structural, so the proof cannot cheat):
//   - Pure, synchronous, deterministic. No filesystem, network, clock
//     (`Date.now`), environment, model, or tool access. Timestamps and createdAt
//     come only from the source transcript.
//   - Provider-neutral OUTPUT. Foreign message ids, tool-call ids, token usage,
//     finish reasons, model names, and any unrecognized field are NEVER copied
//     into the trace: payloads are built field-by-field and foreign call ids are
//     remapped to Blackbox's deterministic `call-N` ids (toolCallIdForIndex).
//   - Reuses the untouched core primitives (TraceRecorder, toolCallIdForIndex),
//     so id/index/prevHash/hash/schema semantics are inherited, not re-implemented.
//
// Deliberate limitation of the proof: exactly one tool call per assistant turn,
// in a strict sequential `assistant tool call -> matching tool result` loop
// terminated by a final assistant text. Parallel tool calls, interleaved runs,
// and error terminations are out of scope (rejected with a clear error).

import {
  type JsonObject,
  type JsonValue,
  type Trace,
} from "../trace/TraceTypes.ts";
import { type Message } from "../agent/modelClient.ts";
import { TraceRecorder } from "../trace/TraceRecorder.ts";
import { toolCallIdForIndex } from "../agent/toolCallId.ts";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface AdaptForeignTranscriptOptions {
  /** Blackbox trace id for the converted cassette. Never derived from a foreign id. */
  traceId: string;
}

/** Thrown for any malformed/unsupported foreign transcript. Message is deterministic. */
export class ForeignTranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForeignTranscriptError";
  }
}

// ---------------------------------------------------------------------------
// JSON-safe helpers (no dependency, no spreading of foreign objects)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-validate and deep-copy an arbitrary value into a JsonValue, throwing on
 * anything not JSON-safe. This is how foreign inputs (tool inputs, tool results,
 * tool parameter schemas) enter trace payloads: field-by-field, never by
 * spreading or holding a reference to the caller's object.
 */
function toJsonValue(value: unknown, where: string): JsonValue {
  if (value === null) return null;
  const t = typeof value;
  if (t === "string" || t === "boolean") return value as string | boolean;
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new ForeignTranscriptError(`${where}: number must be finite`);
    }
    return value as number;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => toJsonValue(item, `${where}[${i}]`));
  }
  if (isRecord(value)) {
    const out: JsonObject = {};
    for (const key of Object.keys(value)) {
      // Name the key by position: a key from the source may hold anything.
      // defineProperty, not assignment: a "__proto__" key stays an own property.
      const copied = toJsonValue(value[key], `${where}.<key ${Object.keys(value).indexOf(key)}>`);
      Object.defineProperty(out, key, { value: copied, enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  throw new ForeignTranscriptError(`${where}: value is not JSON-safe (${t})`);
}

function readTimestamp(message: Record<string, unknown>, where: string): number {
  const ts = message["timestamp"];
  if (ts === undefined || ts === null) {
    throw new ForeignTranscriptError(`${where}: missing timestamp`);
  }
  if (typeof ts !== "number" || !Number.isInteger(ts) || ts < 0) {
    throw new ForeignTranscriptError(
      `${where}: timestamp must be a non-negative integer epoch-millisecond value; got ` +
        (typeof ts === "number" ? String(ts) : `a ${Array.isArray(ts) ? "array" : typeof ts}`),
    );
  }
  return ts;
}

/** Parse a tool call's JSON-string arguments into a JsonValue tool input. */
function parseArguments(raw: unknown, where: string): JsonValue {
  if (typeof raw !== "string") {
    throw new ForeignTranscriptError(`${where}.arguments must be a JSON string`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ForeignTranscriptError(`${where}.arguments is not valid JSON`);
  }
  return toJsonValue(parsed, `${where}.arguments`);
}

/**
 * A tool result's content is a string in the foreign shape. If it is valid JSON
 * it is parsed into a JsonValue object/array/primitive; otherwise the raw string
 * is preserved as the result. Deterministic either way.
 */
function parseToolResultContent(raw: unknown, where: string): JsonValue {
  if (typeof raw !== "string") {
    throw new ForeignTranscriptError(`${where}.content must be a string`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  return toJsonValue(parsed, `${where}.content`);
}

/**
 * Allowlist-map foreign tool declarations to Blackbox tool definitions. Only
 * `function.name` -> name, `function.description` -> description, and
 * `function.parameters` -> inputSchema cross the boundary; everything else
 * (type, provider extensions) is dropped.
 */
function adaptTools(raw: unknown): JsonValue[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new ForeignTranscriptError("transcript.tools must be an array when present");
  }
  return raw.map((entry, i) => {
    if (!isRecord(entry)) {
      throw new ForeignTranscriptError(`transcript.tools[${i}] must be an object`);
    }
    const fn = entry["function"];
    if (!isRecord(fn)) {
      throw new ForeignTranscriptError(`transcript.tools[${i}].function must be an object`);
    }
    const name = fn["name"];
    if (typeof name !== "string" || name.length === 0) {
      throw new ForeignTranscriptError(
        `transcript.tools[${i}].function.name must be a non-empty string`,
      );
    }
    const def: JsonObject = { name };
    const description = fn["description"];
    def["description"] = typeof description === "string" ? description : "";
    const parameters = fn["parameters"];
    if (parameters !== undefined) {
      def["inputSchema"] = toJsonValue(
        parameters,
        `transcript.tools[${i}].function.parameters`,
      );
    }
    return def;
  });
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function adaptForeignTranscript(
  input: unknown,
  options: AdaptForeignTranscriptOptions,
): Trace {
  const traceId = options?.traceId;
  if (typeof traceId !== "string" || traceId.length === 0) {
    throw new ForeignTranscriptError("options.traceId must be a non-empty string");
  }

  if (!isRecord(input)) {
    throw new ForeignTranscriptError("transcript must be a JSON object");
  }
  const rawMessages = input["messages"];
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw new ForeignTranscriptError("transcript.messages must be a non-empty array");
  }

  const messages: Record<string, unknown>[] = rawMessages.map((m, i) => {
    if (!isRecord(m)) {
      throw new ForeignTranscriptError(`messages[${i}] must be an object`);
    }
    return m;
  });

  // Validate roles and timestamps (non-decreasing) up front.
  const timestamps: number[] = [];
  let prevTs: number | undefined;
  for (let i = 0; i < messages.length; i++) {
    const role = messages[i]["role"];
    if (role !== "user" && role !== "assistant" && role !== "tool") {
      throw new ForeignTranscriptError(
        `messages[${i}] has an unsupported role (expected user, assistant or tool)`,
      );
    }
    const ts = readTimestamp(messages[i], `messages[${i}]`);
    if (prevTs !== undefined && ts < prevTs) {
      throw new ForeignTranscriptError(
        `messages[${i}] timestamp ${ts} is earlier than the previous message timestamp ${prevTs}`,
      );
    }
    timestamps.push(ts);
    prevTs = ts;
  }

  // The transcript must begin with the initial user message.
  if (messages[0]["role"] !== "user") {
    throw new ForeignTranscriptError("transcript must begin with a user message");
  }
  const userContent = messages[0]["content"];
  if (typeof userContent !== "string" || userContent.length === 0) {
    throw new ForeignTranscriptError("the initial user message must have non-empty string content");
  }

  const toolDefs = adaptTools(input["tools"]);
  const recorder = new TraceRecorder(traceId, { createdAt: timestamps[0] });
  const history: Message[] = [{ role: "user", content: userContent }];

  const seenForeignCallIds = new Set<string>();
  let nextCallIndex = 0;

  // Strict sequential tool-round loop: assistant-tool-call -> matching tool-result.
  let pos = 1;
  while (pos < messages.length) {
    const message = messages[pos];
    if (message["role"] !== "assistant") {
      throw new ForeignTranscriptError(
        `messages[${pos}]: expected an assistant message, got role ${JSON.stringify(message["role"])}`,
      );
    }

    const rawToolCalls = message["tool_calls"];
    const hasToolCalls = Array.isArray(rawToolCalls) && rawToolCalls.length > 0;
    const textContent = message["content"];
    const hasText = typeof textContent === "string" && textContent.length > 0;

    if (hasToolCalls && hasText) {
      throw new ForeignTranscriptError(
        `messages[${pos}]: assistant message mixes final text and a tool call`,
      );
    }

    // No tool call → terminal final-answer message; leave the loop.
    if (!hasToolCalls) break;

    const toolCalls = rawToolCalls as unknown[];
    if (toolCalls.length > 1) {
      throw new ForeignTranscriptError(
        `messages[${pos}]: parallel tool calls are not supported (exactly one tool call per assistant message)`,
      );
    }

    const call = toolCalls[0];
    if (!isRecord(call)) {
      throw new ForeignTranscriptError(`messages[${pos}].tool_calls[0] must be an object`);
    }
    const foreignCallId = call["id"];
    if (typeof foreignCallId !== "string" || foreignCallId.length === 0) {
      throw new ForeignTranscriptError(
        `messages[${pos}].tool_calls[0].id must be a non-empty string`,
      );
    }
    if (seenForeignCallIds.has(foreignCallId)) {
      throw new ForeignTranscriptError(
        `messages[${pos}].tool_calls[0].id duplicates an earlier tool call id`,
      );
    }
    seenForeignCallIds.add(foreignCallId);

    const fn = call["function"];
    if (!isRecord(fn)) {
      throw new ForeignTranscriptError(`messages[${pos}].tool_calls[0].function must be an object`);
    }
    const toolName = fn["name"];
    if (typeof toolName !== "string" || toolName.length === 0) {
      throw new ForeignTranscriptError(
        `messages[${pos}].tool_calls[0].function.name must be a non-empty string`,
      );
    }
    const toolInput = parseArguments(fn["arguments"], `messages[${pos}].tool_calls[0].function`);

    // The matching tool result must be the very next message.
    const resultPos = pos + 1;
    if (resultPos >= messages.length) {
      throw new ForeignTranscriptError(
        `messages[${pos}]: tool call is unresolved — no tool result follows it (dangling tool call)`,
      );
    }
    const resultMessage = messages[resultPos];
    if (resultMessage["role"] !== "tool") {
      throw new ForeignTranscriptError(
        `messages[${resultPos}]: expected a tool result, got role ${JSON.stringify(resultMessage["role"])}`,
      );
    }
    const resultRefId = resultMessage["tool_call_id"];
    if (typeof resultRefId !== "string" || resultRefId !== foreignCallId) {
      throw new ForeignTranscriptError(
        `messages[${resultPos}]: tool result's tool_call_id does not match the tool call at messages[${pos}]`,
      );
    }
    const resultValue = parseToolResultContent(resultMessage["content"], `messages[${resultPos}]`);

    // Assign a deterministic, provider-neutral correlation id.
    const toolCallId = toolCallIdForIndex(nextCallIndex);
    nextCallIndex += 1;

    // Record the round in the exact grammar agentLoop emits. TraceRecorder deep-
    // clones each payload at append time, so passing `history` is safe.
    const roundTs = timestamps[pos];
    recorder.append(
      "model_input",
      { messages: history, tools: toolDefs } as unknown as JsonValue,
      roundTs,
    );
    recorder.append("model_output", { type: "tool_call", toolCallId, toolName, toolInput }, roundTs);
    recorder.append("tool_call", { toolCallId, toolName, toolInput }, roundTs);
    recorder.append(
      "tool_result",
      { toolCallId, toolName, result: resultValue },
      timestamps[resultPos],
    );

    // Extend the reconstructed transcript exactly as agentLoop does.
    history.push({
      role: "assistant",
      content: [
        { type: "tool_use", toolCallId, toolName, toolInput: structuredClone(toolInput) },
      ],
    });
    history.push({
      role: "user",
      content: [
        { type: "tool_result", toolCallId, toolName, result: structuredClone(resultValue) },
      ],
    });

    pos = resultPos + 1;
  }

  // Terminal final-answer message.
  if (pos >= messages.length) {
    throw new ForeignTranscriptError("transcript is missing a final assistant message");
  }
  const finalMessage = messages[pos];
  if (finalMessage["role"] !== "assistant") {
    throw new ForeignTranscriptError(
      `messages[${pos}]: expected a final assistant message, got role ${JSON.stringify(finalMessage["role"])}`,
    );
  }
  const finalToolCalls = finalMessage["tool_calls"];
  if (Array.isArray(finalToolCalls) && finalToolCalls.length > 0) {
    throw new ForeignTranscriptError(
      `messages[${pos}]: the final assistant message must not contain a tool call (dangling tool call)`,
    );
  }
  const finalText = finalMessage["content"];
  if (typeof finalText !== "string" || finalText.length === 0) {
    throw new ForeignTranscriptError(
      `messages[${pos}]: the final assistant message must have non-empty string content`,
    );
  }
  if (pos !== messages.length - 1) {
    throw new ForeignTranscriptError(
      `unexpected message(s) after the final assistant message at position ${pos}`,
    );
  }

  const finalTs = timestamps[pos];
  recorder.append(
    "model_input",
    { messages: history, tools: toolDefs } as unknown as JsonValue,
    finalTs,
  );
  recorder.append("model_output", { type: "final_answer", text: finalText }, finalTs);
  recorder.append(
    "metadata",
    { event: "run_completed", status: "success", result: finalText },
    finalTs,
  );

  return recorder.getTrace();
}
