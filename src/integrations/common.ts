// Shared pieces of the provider integrations.
//
// An integration translates one provider's wire format (the JSON body the
// official SDK sends through `fetch`, and the JSON it receives back) to and
// from Blackbox's provider-neutral step payloads. Integrations are pure: no
// I/O, no clock, no SDK runtime import.

import { BlackboxUnsupportedError } from "../errors.ts";
import type { JsonObject, JsonValue } from "../trace/TraceTypes.ts";

/** Neutral model output recorded in a `model_output` step. */
export type NeutralOutput =
  | {
      type: "tool_calls";
      calls: Array<{ toolCallId: string; toolName: string; toolInput: JsonValue }>;
      text?: string;
      stop?: "length";
    }
  | { type: "final_answer"; text: string; stop?: "length" | "refusal" };

/**
 * Maps provider tool-call ids to Blackbox's `call-N` ids for one session.
 *
 * Ids are assigned in the order the model produced the calls, so a recording
 * and its replay assign identical ids. During replay and fork playback the
 * session hands the neutral id itself back to the agent as the provider id,
 * so the mapping is the identity for those calls.
 */
export class ToolCallIds {
  #next = 0;
  readonly #byProviderId = new Map<string, { toolCallId: string; toolName: string }>();

  /** Assign the next `call-N` to a tool call the model just produced. */
  assign(providerId: string, toolName: string): string {
    const known = this.#byProviderId.get(providerId);
    if (known) return known.toolCallId;
    const toolCallId = `call-${this.#next++}`;
    this.#byProviderId.set(providerId, { toolCallId, toolName });
    return toolCallId;
  }

  /** Register a served (replayed) call whose provider id is its neutral id. */
  register(toolCallId: string, toolName: string): void {
    this.#byProviderId.set(toolCallId, { toolCallId, toolName });
    const match = /^call-(\d+)$/.exec(toolCallId);
    if (match) this.#next = Math.max(this.#next, Number(match[1]) + 1);
  }

  /** Resolve a provider id seen in request history (assigning one if unseen). */
  resolve(providerId: string, toolName?: string): { toolCallId: string; toolName: string } {
    const known = this.#byProviderId.get(providerId);
    if (known) return known;
    const toolCallId = this.assign(providerId, toolName ?? "unknown");
    return { toolCallId, toolName: toolName ?? "unknown" };
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Copy a parsed JSON value, dropping `undefined` members. */
export function json(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(json);
  if (isRecord(value)) {
    const copy: JsonObject = {};
    for (const key of Object.keys(value)) {
      if (value[key] !== undefined) copy[key] = json(value[key]);
    }
    return copy;
  }
  return null;
}

export function unsupported(what: string, advice: string): never {
  throw new BlackboxUnsupportedError(`${what} is not supported yet; ${advice}`);
}

export const STREAMING_ADVICE =
  "streaming isn't supported yet; use the non-streaming call (messages.create / " +
  "chat.completions.create without stream: true) while recording and replaying";

/** Copy the listed request fields into a neutral `params` object (undefined when empty). */
export function pickParams(body: Record<string, unknown>, mapping: Record<string, string>): JsonObject | undefined {
  const params: JsonObject = {};
  for (const [from, to] of Object.entries(mapping)) {
    if (body[from] !== undefined && body[from] !== null) params[to] = json(body[from]);
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

/** Text of a list of `{type:"text", text}` blocks; other block types are unsupported. */
export function joinTextBlocks(blocks: unknown[], where: string): string {
  return blocks
    .map((block) => {
      if (isRecord(block) && block["type"] === "text" && typeof block["text"] === "string") return block["text"];
      const kind = isRecord(block) ? String(block["type"]) : typeof block;
      return unsupported(`${kind} content in ${where}`, "only text content can be recorded in this version");
    })
    .join("\n\n");
}
