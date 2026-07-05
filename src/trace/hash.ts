// Deterministic canonical serialization and hashing.
//
// The engineering target for Blackbox is canonical-hash-identical replay, not
// raw byte identity. Two payloads that are semantically equal must hash equal
// regardless of object key insertion order; any meaningful value change must
// change the hash.

import { createHash } from "node:crypto";
import type { JsonValue, JsonObject, TraceStepHashInput } from "./TraceTypes.ts";

/**
 * Serialize a JSON value to a canonical string:
 * - object keys sorted lexicographically, recursively
 * - array order preserved
 * - no incidental whitespace
 *
 * Insertion order of object keys does not affect the output.
 */
export function canonicalize(value: JsonValue): string {
  return serialize(value);
}

function serialize(value: JsonValue): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "[" + value.map(serialize).join(",") + "]";
  }

  const type = typeof value;

  if (type === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Cannot canonicalize a non-finite number");
    }
    return JSON.stringify(value);
  }

  if (type === "boolean" || type === "string") {
    return JSON.stringify(value);
  }

  // Plain object: sort keys recursively for a stable representation.
  const obj = value as JsonObject;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((key) => JSON.stringify(key) + ":" + serialize(obj[key]));
  return "{" + parts.join(",") + "}";
}

/** SHA-256 of a value's canonical serialization, as lowercase hex. */
export function hashCanonical(value: JsonValue): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

/**
 * Hash the canonical fields of a trace step. The step's own `hash` and `id`
 * are intentionally excluded so the value is reproducible from content and
 * chain position alone.
 */
export function hashTraceStepInput(input: TraceStepHashInput): string {
  const canonicalInput: JsonObject = {
    index: input.index,
    type: input.type,
    timestamp: input.timestamp,
    payload: input.payload,
    prevHash: input.prevHash,
  };
  return hashCanonical(canonicalInput);
}
