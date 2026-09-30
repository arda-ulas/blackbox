// Locate the first place two JSON values differ, for divergence reports.

import { canonicalize } from "../trace/hash.ts";
import type { JsonValue } from "../trace/TraceTypes.ts";

export interface Difference {
  path: string;
  expected: JsonValue | undefined;
  actual: JsonValue | undefined;
}

function isObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

/** The first differing path between two JSON values, or null when canonically equal. */
export function firstDifference(expected: JsonValue | undefined, actual: JsonValue | undefined, path = ""): Difference | null {
  if (expected !== undefined && actual !== undefined && canonicalize(expected) === canonicalize(actual)) return null;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let i = 0; i < length; i++) {
      const found = firstDifference(expected[i], actual[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (isObject(expected) && isObject(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      const found = firstDifference(expected[key], actual[key], path.length > 0 ? `${path}.${key}` : key);
      if (found) return found;
    }
    return null;
  }
  return { path: path.length > 0 ? path : "(root)", expected, actual };
}

/**
 * Compact single-line rendering of a value for a report, elided past `budget`.
 * `mask` runs on the whole text before it is cut, so a secret that straddles
 * the cut is never printed in part.
 */
export function renderValue(value: JsonValue | undefined, budget = 200, mask: (text: string) => string = (text) => text): string {
  if (value === undefined) return "(absent)";
  const raw = mask(JSON.stringify(value));
  return raw.length > budget ? `${raw.slice(0, budget - 1)}…` : raw;
}
