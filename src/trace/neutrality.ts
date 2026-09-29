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
import { findCredentials } from "./secrets.ts";

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

// Keys that leak as OBJECT KEYS in raw provider objects (a real Anthropic message
// has `usage`/`stop_reason`/`stop_sequence`; an OpenAI completion has
// `finish_reason`/`system_fingerprint`). Flagged only at STRUCTURAL positions of
// the trace — never inside user data (see USER_DATA_KEYS) — so a tool that
// returns `{ usage: 42 }` does not trip the audit.
const KEY_FORM_MARKERS: readonly string[] = [
  "usage",
  "stop_reason",
  "stop_sequence",
  "finish_reason",
  "system_fingerprint",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
];

// Payload keys whose values are the user's own data: tool inputs and results and
// tool input schemas. Key-form markers are not checked below them; provider-id
// and credential patterns still are.
const USER_DATA_KEYS: ReadonlySet<string> = new Set(["toolInput", "result", "inputSchema"]);

// Provider-native ids, matched at a word boundary so an identifier that merely
// contains the prefix (`send_msg_to_user`) is not flagged. Anthropic ids are
// `toolu_01…` / `msg_01…`; an id run must contain a digit. OpenAI ids are
// `call_` + 24 alphanumerics, `chatcmpl-…`, `resp_…`. Blackbox's own ids are the
// hyphenated `call-N`, which never match.
const PROVIDER_ID_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "toolu_", pattern: /\btoolu_[A-Za-z0-9]*\d/ },
  { label: "msg_", pattern: /\bmsg_[A-Za-z0-9]*\d/ },
  { label: "call_", pattern: /\bcall_[A-Za-z0-9]{20,}/ },
  { label: "chatcmpl-", pattern: /\bchatcmpl-[A-Za-z0-9]{8,}/ },
  { label: "resp_", pattern: /\bresp_[A-Za-z0-9]{16,}/ },
];

/** Provider-id and credential labels found in one string (a value or a key). */
function stringFindings(text: string, apiKey: string | undefined): string[] {
  const found: string[] = [];
  for (const { label, pattern } of PROVIDER_ID_PATTERNS) {
    if (pattern.test(text)) found.push(label);
  }
  found.push(...findCredentials(text, apiKey ? [apiKey] : []));
  return found;
}

/**
 * Structured, false-positive-resistant neutrality audit over an in-memory Trace.
 *
 * Traverses the trace as JSON and distinguishes where each marker would actually
 * leak:
 * - key-form markers (`usage`, `stop_reason`, `finish_reason`, …) are flagged
 *   only when they appear as an OBJECT KEY at a structural position — the
 *   signature of a raw provider object having been stored. Inside user data
 *   (`toolInput`, `result`, `inputSchema`) they are ordinary keys.
 * - provider ids (`toolu_…`, `msg_…`, `call_…`, `chatcmpl-…`, `resp_…`) and
 *   credentials (`sk-ant-…`, `sk-proj-…`, bearer tokens, the env-var names) are
 *   flagged in any string value or key, anywhere.
 * - the literal `apiKey` value (when supplied) is flagged in any string value or
 *   key and reported as `<api-key-value>` — the key itself is never echoed.
 */
export function auditTraceNeutrality(trace: Trace, apiKey?: string): NeutralityResult {
  const found = new Set<string>();
  const key = apiKey && apiKey.length > 0 ? apiKey : undefined;

  const visit = (value: JsonValue, inUserData: boolean): void => {
    if (value === null) return;

    if (typeof value === "string") {
      for (const label of stringFindings(value, key)) found.add(label);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, inUserData);
      return;
    }

    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (!inUserData && KEY_FORM_MARKERS.includes(k)) found.add(k);
        // Object keys are persisted data too — a provider id or secret smuggled
        // in as a JSON key is caught here.
        for (const label of stringFindings(k, key)) found.add(label);
        visit(v, inUserData || USER_DATA_KEYS.has(k));
      }
    }
    // numbers / booleans carry no markers.
  };

  // The Trace is JSON-safe by contract (payloads are JsonValue); traverse it whole
  // so leaks in ids, metadata, or any payload are caught.
  visit(trace as unknown as JsonValue, false);

  return { ok: found.size === 0, found: [...found] };
}
