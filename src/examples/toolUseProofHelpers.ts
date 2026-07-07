// W4-E slice E1 — pure, offline helpers for the real tool-use proof.
//
// These functions never touch the network, the filesystem, or process.env, so
// they are unit-testable without ANTHROPIC_API_KEY. The live proof script
// (realToolUseProof.ts) composes them around a real Anthropic call.

// ---------------------------------------------------------------------------
// Neutrality audit
//
// The neutrality audit moved to core in W4-F (`src/trace/neutrality.ts`) so the
// CLI and `verifyTrace` can reach it. These re-exports keep the proof scripts and
// their tests importing from their original path unchanged.
// ---------------------------------------------------------------------------

export {
  NEUTRALITY_FORBIDDEN,
  auditNeutrality,
  auditTraceNeutrality,
  type NeutralityMarker,
  type NeutralityResult,
} from "../trace/neutrality.ts";

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
