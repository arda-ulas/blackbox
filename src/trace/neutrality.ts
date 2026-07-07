// Provider-neutrality audit — core trace hygiene.
//
// A Blackbox trace must be provider-agnostic: no provider-native ids, no token
// usage accounting, no stop metadata, no credentials. This module is the single
// reusable place that decides whether a serialized trace (or an in-memory Trace)
// leaks any of those. It lives in `trace/` (core), not under `examples/`, so the
// product runtime, the CLI, and `verifyTrace` can all call it.
//
// Relocated from `src/examples/toolUseProofHelpers.ts` in W4-F; that module now
// re-exports `NEUTRALITY_FORBIDDEN` / `auditNeutrality` for the proof scripts.

import type { JsonValue, Trace } from "./TraceTypes.ts";

// ---------------------------------------------------------------------------
// Forbidden markers
// ---------------------------------------------------------------------------

/**
 * Provider-native markers that must never appear in a Blackbox trace.
 *
 * - `toolu_`            — Anthropic tool_use ids
 * - `msg_`              — Anthropic message ids
 * - `usage`            — token-usage accounting
 * - `stop_reason`      — provider stop metadata
 * - `stop_sequence`    — provider stop metadata
 * - `ANTHROPIC_API_KEY` — the env var name should never be serialized
 * - `sk-ant`           — Anthropic API key prefix (a leaked key value)
 *
 * The API key VALUE is checked separately (it is dynamic) via the `apiKey`
 * argument. Raw provider content-block arrays would surface here too — they always
 * carry `stop_reason`/`usage`/`toolu_` siblings, so those markers are a reliable
 * proxy for "a raw provider object leaked into the trace".
 */
export const NEUTRALITY_FORBIDDEN = [
  "toolu_",
  "msg_",
  "usage",
  "stop_reason",
  "stop_sequence",
  "ANTHROPIC_API_KEY",
  "sk-ant",
] as const;

export type NeutralityMarker = (typeof NEUTRALITY_FORBIDDEN)[number];

export interface NeutralityResult {
  ok: boolean;
  /** Forbidden markers that were found (empty when ok). */
  found: string[];
}

// ---------------------------------------------------------------------------
// String-based audit (compatibility surface for the proof scripts)
// ---------------------------------------------------------------------------

/**
 * Scan a serialized trace string for provider-native leakage. Pass the live API
 * key so its literal value is also rejected if it somehow reached the payload.
 *
 * This is a plain substring scan: it flags a marker anywhere in the serialized
 * text. It is intentionally strict and is what the opt-in proof scripts use,
 * where the trace under audit is fully controlled. For product verification of an
 * arbitrary cassette (which may contain benign user text such as the word
 * "usage"), prefer {@link auditTraceNeutrality}, which distinguishes keys from
 * values to reduce false positives.
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
// Structured audit (used by verifyTrace)
// ---------------------------------------------------------------------------

// Markers that leak as OBJECT KEYS in raw provider objects (a real Anthropic
// message has `usage`, `stop_reason`, `stop_sequence` keys). Flagging these only
// as keys avoids false positives from benign prose that merely mentions "usage".
const KEY_FORM_MARKERS: readonly NeutralityMarker[] = [
  "usage",
  "stop_reason",
  "stop_sequence",
  "ANTHROPIC_API_KEY",
];

// Markers that leak inside STRING VALUES: provider id prefixes (`toolu_`, `msg_`),
// the API key prefix (`sk-ant`), or the env-var name serialized as text.
const VALUE_FORM_MARKERS: readonly NeutralityMarker[] = [
  "toolu_",
  "msg_",
  "sk-ant",
  "ANTHROPIC_API_KEY",
];

/**
 * Structured, false-positive-resistant neutrality audit over an in-memory Trace.
 *
 * Traverses the trace as JSON and distinguishes where each marker would actually
 * leak:
 * - key-form markers (`usage`, `stop_reason`, `stop_sequence`, `ANTHROPIC_API_KEY`)
 *   are flagged only when they appear as an OBJECT KEY — the signature of a raw
 *   provider object having been stored — so a prompt or tool result that merely
 *   contains the word "usage" as text does not trip the audit.
 * - value-form markers (`toolu_`, `msg_`, `sk-ant`, `ANTHROPIC_API_KEY`) are
 *   flagged when they appear inside any string value.
 * - the literal `apiKey` value (when supplied) is flagged in any string value and
 *   reported as `<api-key-value>` — the key itself is never echoed.
 *
 * Object KEYS are persisted trace data too, so they are audited as well: a key is
 * flagged for the key-form markers (exact match), for value-form markers appearing
 * anywhere in the key, and for the literal `apiKey` value — this catches a secret
 * or provider id smuggled in as a JSON key (e.g. `{ "<key>": "x" }`).
 */
export function auditTraceNeutrality(trace: Trace, apiKey?: string): NeutralityResult {
  const found = new Set<string>();
  const key = apiKey && apiKey.length > 0 ? apiKey : undefined;

  const visit = (value: JsonValue): void => {
    if (value === null) return;

    if (typeof value === "string") {
      for (const marker of VALUE_FORM_MARKERS) {
        if (value.includes(marker)) found.add(marker);
      }
      if (key && value.includes(key)) found.add("<api-key-value>");
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        // Key-form markers are exact provider-response keys.
        for (const marker of KEY_FORM_MARKERS) {
          if (k === marker) found.add(marker);
        }
        // Object keys are persisted data too — audit them for value-form leakage
        // (an id/key prefix or the env-var name) and for a literal secret used as
        // a key (e.g. `{ "<api-key>": "x" }`), which would otherwise slip past a
        // value-only scan.
        for (const marker of VALUE_FORM_MARKERS) {
          if (k.includes(marker)) found.add(marker);
        }
        if (key && k.includes(key)) found.add("<api-key-value>");
        visit(v);
      }
    }
    // numbers / booleans carry no markers.
  };

  // The Trace is JSON-safe by contract (payloads are JsonValue); traverse it whole
  // so leaks in ids, metadata, or any payload are caught.
  visit(trace as unknown as JsonValue);

  return { ok: found.size === 0, found: [...found] };
}
