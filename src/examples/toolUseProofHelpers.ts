// W4-E slice E1 — pure, offline helpers for the real tool-use proof.
//
// These functions never touch the network, the filesystem, or process.env, so
// they are unit-testable without ANTHROPIC_API_KEY. The live proof script
// (realToolUseProof.ts) composes them around a real Anthropic call.

// ---------------------------------------------------------------------------
// Neutrality audit
// ---------------------------------------------------------------------------

/**
 * Provider-native markers that must never appear in a Blackbox trace.
 *
 * - `toolu_`         — Anthropic tool_use ids
 * - `msg_`           — Anthropic message ids
 * - `usage`          — token-usage accounting
 * - `stop_reason`    — provider stop metadata
 * - `stop_sequence`  — provider stop metadata
 * - `ANTHROPIC_API_KEY` — the env var name should never be serialized
 *
 * The API key VALUE is checked separately (it is dynamic) via `auditNeutrality`'s
 * `apiKey` argument. Raw provider content-block arrays would surface here too —
 * they always carry `stop_reason`/`usage`/`toolu_` siblings, so those markers
 * are a reliable proxy for "a raw provider object leaked into the trace".
 */
export const NEUTRALITY_FORBIDDEN = [
  "toolu_",
  "msg_",
  "usage",
  "stop_reason",
  "stop_sequence",
  "ANTHROPIC_API_KEY",
] as const;

export interface NeutralityResult {
  ok: boolean;
  /** Forbidden markers that were found (empty when ok). */
  found: string[];
}

/**
 * Scan a serialized trace for provider-native leakage. Pass the live API key so
 * its literal value is also rejected if it somehow reached the payload.
 */
export function auditNeutrality(serialized: string, apiKey?: string): NeutralityResult {
  const found: string[] = [];
  for (const marker of NEUTRALITY_FORBIDDEN) {
    if (serialized.includes(marker)) found.push(marker);
  }
  if (apiKey && apiKey.length > 0 && serialized.includes(apiKey)) {
    found.push("<api-key-value>");
  }
  return { ok: found.length === 0, found };
}

// ---------------------------------------------------------------------------
// Request inspection
// ---------------------------------------------------------------------------

export interface ToolBlockIds {
  /** `id` values of every assistant `tool_use` block across the captured requests. */
  toolUseIds: string[];
  /** `tool_use_id` values of every user `tool_result` block across the captured requests. */
  toolResultIds: string[];
}

/**
 * Extract the tool-use / tool-result correlation ids from the request params
 * captured on the wire (Anthropic `messages.create` params). Used to assert that
 * the continuation request carried Blackbox's synthetic `call-0` as both
 * `tool_use.id` and `tool_result.tool_use_id` — the exact W4-E gate.
 *
 * Reads only the id fields; it never returns provider content, so nothing from
 * here can leak into a trace.
 */
export function collectToolBlockIds(requests: readonly unknown[]): ToolBlockIds {
  const toolUseIds: string[] = [];
  const toolResultIds: string[] = [];

  for (const req of requests) {
    const messages = (req as { messages?: unknown }).messages;
    if (!Array.isArray(messages)) continue;

    for (const message of messages) {
      const content = (message as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;

      for (const block of content as Array<Record<string, unknown>>) {
        if (block["type"] === "tool_use" && typeof block["id"] === "string") {
          toolUseIds.push(block["id"]);
        }
        if (block["type"] === "tool_result" && typeof block["tool_use_id"] === "string") {
          toolResultIds.push(block["tool_use_id"] as string);
        }
      }
    }
  }

  return { toolUseIds, toolResultIds };
}
