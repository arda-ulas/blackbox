// Deterministic, provider-neutral tool-call correlation ids (W4-D structured
// transcript).
//
// A toolCallId is a Blackbox-generated key that correlates a tool_use message
// part with its matching tool_result part inside a cassette. It is a pure
// function of the tool call's run-local index, so recorded traces are
// reproducible and forked prefixes stay canonical-hash-identical.
//
// It is NOT a provider-native id (e.g. Anthropic's tool_use_id). Provider ids
// must never be persisted in trace payloads.
//
// NOTE (W4-D1): this helper is defined but not yet wired into the agent loop.
// W4-D2 begins emitting structured transcript parts using these ids.

const PREFIX = "call-";

/**
 * Return the deterministic tool-call id for a zero-based run-local index.
 *
 *   toolCallIdForIndex(0) -> "call-0"
 *   toolCallIdForIndex(1) -> "call-1"
 *
 * Throws on a negative, non-integer, or non-finite index — an invalid index
 * signals a sequencing bug at the call site and must fail loudly rather than
 * produce a malformed id.
 */
export function toolCallIdForIndex(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(
      `toolCallIdForIndex: index must be a non-negative integer; got ${String(index)}`,
    );
  }
  return `${PREFIX}${index}`;
}
