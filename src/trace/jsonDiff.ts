// The leaf-level differences between two JSON values: which paths changed, and
// from what to what. Pure; used to make long divergent values readable.

import { canonicalize } from "./hash.ts";
import type { JsonValue } from "./TraceTypes.ts";

export interface LeafDifference {
  path: string;
  /** Absent (undefined) when the path exists only on the other side. */
  before: JsonValue | undefined;
  after: JsonValue | undefined;
}

function isContainer(value: JsonValue | undefined): value is JsonValue[] | { [key: string]: JsonValue } {
  return value !== null && typeof value === "object";
}

function same(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return canonicalize(a) === canonicalize(b);
}

/** Every differing leaf between `before` and `after`, in document order. */
export function leafDifferences(before: JsonValue | undefined, after: JsonValue | undefined, path = ""): LeafDifference[] {
  if (same(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const out: LeafDifference[] = [];
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      out.push(...leafDifferences(before[i], after[i], `${path}[${i}]`));
    }
    return out;
  }
  if (isContainer(before) && isContainer(after) && !Array.isArray(before) && !Array.isArray(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.flatMap((key) => leafDifferences(before[key], after[key], path ? `${path}.${key}` : key));
  }
  return [{ path: path || "(value)", before, after }];
}
