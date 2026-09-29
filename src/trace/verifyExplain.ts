// Failure explanation for `verify` — presentation only.
//
// verifyExplain turns an already-computed VerifyReport failure into a labelled,
// actionable terminal block. It is pure and disk-free by construction: it reads
// only the facts verifyTrace already produced (invariant name, detail, optional
// step index) and never verifies, mutates, hashes, replays, or touches the
// filesystem, a model, a tool, or a provider. It performs NO parsing of `detail`
// — the expected/actual hash and any offending provider marker are surfaced by
// presenting `detail` verbatim, so a masked secret (`<api-key-value>`) stays
// masked.
//
// W6-B. No change to VerifyReport shape, invariant checks, ordering, or exit
// codes; only the FAIL-path rendering of runVerify moves through here.

import type { VerifyInvariantName, VerifyReport } from "./verifyTrace.ts";

// ---------------------------------------------------------------------------
// Suggested action — single source of truth, one line per invariant
// ---------------------------------------------------------------------------

/**
 * Plain-language "what broke / what to do" guidance for a failed invariant.
 * Exhaustive over VerifyInvariantName with a `never` guard so a future invariant
 * cannot be added without giving it an action.
 */
export function suggestedAction(name: VerifyInvariantName): string {
  switch (name) {
    case "schema_version":
      return (
        "The cassette is missing a version, unsupported, malformed, or unreadable. " +
        "Older cassettes are not migrated — re-record the run (`blackbox record --out <file> -- <command>`)."
      );
    case "hash_chain":
      return (
        "A step's stored hash no longer matches its contents, or the chain links are " +
        "broken — the cassette was edited or corrupted after recording. Do not hand-edit " +
        "cassettes; re-record to regenerate a valid chain."
      );
    case "provider_neutrality":
      return (
        "A provider-native field leaked into the trace (an id prefix, usage/stop metadata, " +
        "or a key). The recorder/adapter boundary let a raw provider object through — never " +
        "commit this cassette; fix the boundary and re-record."
      );
    case "replayability":
      return (
        "The trace does not replay to a consistent verdict — its success marker is not the " +
        "terminal step, or replay could not reconstruct the run (truncated/inconsistent " +
        "trace). Re-record to produce a replayable cassette."
      );
    default: {
      const _exhaustive: never = name;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Labelled failure block
// ---------------------------------------------------------------------------

const LABEL_WIDTH = 10; // "invariant:" is the longest label
const VALUE_COL = 2 + LABEL_WIDTH + 2; // "  " + padded label + "  "
const WRAP_WIDTH = 64; // continuation width for the action text

/** Word-wrap `text` to WRAP_WIDTH; return the wrapped lines (no indentation). */
function wrap(text: string): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= WRAP_WIDTH) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/** Render one `  label:     value` row, aligning the value column. */
function row(label: string, value: string): string {
  return `  ${(label + ":").padEnd(LABEL_WIDTH)}  ${value}`;
}

/**
 * Render the labelled failure block for a FAILing report. Reads only
 * report.firstFailure (name, detail, optional stepIndex) and appends the
 * suggestedAction line. Returns [] when the report has no firstFailure (a PASS
 * report or a defensively-empty one), so callers can print nothing on PASS.
 */
export function formatVerifyFailure(report: VerifyReport): string[] {
  const failure = report.firstFailure;
  if (!failure) return [];

  const lines: string[] = ["Failure"];
  lines.push(row("invariant", failure.name));
  if (failure.stepIndex !== undefined) {
    lines.push(row("at", `step ${failure.stepIndex}`));
  }
  lines.push(row("detail", failure.detail));

  const actionLines = wrap(suggestedAction(failure.name));
  lines.push(row("action", actionLines[0]));
  const pad = " ".repeat(VALUE_COL);
  for (const cont of actionLines.slice(1)) {
    lines.push(pad + cont);
  }

  return lines;
}
