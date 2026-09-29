// Pure readers for step payload shapes.
//
// A `model_output` payload has three documented shapes in schema v2:
//
//   { type: "tool_call", toolCallId, toolName, toolInput }      built-in agent loop
//   { type: "tool_calls", calls: [{ toolCallId, toolName, toolInput }], text? }
//                                                                recorded / imported agents
//   { type: "final_answer", text }
//
// `tool_calls` carries one or more calls from a single model turn (parallel tool
// use) plus any narration text the model emitted alongside them. Readers go
// through these helpers so the two tool-call shapes are handled in one place.
//
// Lives in `trace/` so the analysis seam (replay, verify, diff, assert) can use
// it without importing anything from the execution side.

import type { JsonObject, JsonValue } from "./TraceTypes.ts";

export interface ToolCallRef {
  toolCallId: string;
  toolName: string;
  toolInput: JsonValue;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function refOf(value: JsonValue | undefined): ToolCallRef {
  const obj = isObject(value) ? value : {};
  return {
    toolCallId: typeof obj["toolCallId"] === "string" ? obj["toolCallId"] : "",
    toolName: typeof obj["toolName"] === "string" ? obj["toolName"] : "unknown",
    toolInput: obj["toolInput"] ?? null,
  };
}

/**
 * The tool calls requested by a `model_output` payload, in call order. Returns
 * one ref for the single-call shape, every call for the multi-call shape, and
 * an empty array for a final answer or any unrecognized payload.
 */
export function toolCallsOf(payload: JsonValue): ToolCallRef[] {
  if (!isObject(payload)) return [];
  if (payload["type"] === "tool_call") return [refOf(payload)];
  if (payload["type"] === "tool_calls") {
    const calls = payload["calls"];
    return Array.isArray(calls) ? calls.map(refOf) : [];
  }
  return [];
}

/**
 * Text carried by a `model_output` payload: the final answer, or the narration
 * emitted alongside a `tool_calls` turn. Undefined when there is none.
 */
export function modelOutputText(payload: JsonValue): string | undefined {
  if (!isObject(payload)) return undefined;
  const text = payload["text"];
  return typeof text === "string" ? text : undefined;
}
