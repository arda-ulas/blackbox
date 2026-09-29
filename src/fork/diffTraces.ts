// Trace divergence diff: finds the first step where two traces stop sharing
// identical hashes, then formats the result for terminal output.

import type { Trace, TraceStep } from "../trace/TraceTypes.ts";
import {
  describeStep,
  describeDivergenceField,
  stepTypeLabel,
} from "../trace/stepLabels.ts";
import { diffOutcome, formatOutcomeDiff } from "./diffOutcome.ts";
import { canonicalize } from "../trace/hash.ts";

export interface TraceDiff {
  parentTraceId: string;
  childTraceId: string;
  /** Steps with matching hashes before the first divergence (or total steps if identical). */
  sharedPrefixLength: number;
  /** True if at least one step differs by hash, or the traces have different lengths. */
  hasDivergence: boolean;
  /**
   * Zero-based index of the first divergent step, or null when traces are identical.
   * Divergence occurs when hashes differ OR one trace has no step at this index.
   */
  firstDivergenceIndex: number | null;
  /** Parent step at firstDivergenceIndex, or null when parent has no step there. */
  parentStep: TraceStep | null;
  /** Child step at firstDivergenceIndex, or null when child has no step there. */
  childStep: TraceStep | null;
  /** True when all parent steps match the child's opening prefix and child is strictly longer. */
  isParentStrictPrefixOfChild: boolean;
  /** True when all child steps match the parent's opening prefix and parent is strictly longer. */
  isChildStrictPrefixOfParent: boolean;
}

function compareTraces(
  parentTrace: Trace,
  childTrace: Trace,
  stepsEqual: (parent: TraceStep, child: TraceStep) => boolean,
): TraceDiff {
  const pSteps = parentTrace.steps;
  const cSteps = childTrace.steps;
  const maxLen = Math.max(pSteps.length, cSteps.length);

  let sharedPrefixLength = 0;

  for (let i = 0; i < maxLen; i++) {
    const pStep: TraceStep | null = pSteps[i] ?? null;
    const cStep: TraceStep | null = cSteps[i] ?? null;

    if (pStep !== null && cStep !== null && stepsEqual(pStep, cStep)) {
      sharedPrefixLength += 1;
      continue;
    }

    // Divergence at index i. By this point all prior steps matched, so the
    // strict-prefix flags are determined solely by which side ran out.
    return {
      parentTraceId: parentTrace.id,
      childTraceId: childTrace.id,
      sharedPrefixLength,
      hasDivergence: true,
      firstDivergenceIndex: i,
      parentStep: pStep,
      childStep: cStep,
      isParentStrictPrefixOfChild: pStep === null,
      isChildStrictPrefixOfParent: cStep === null,
    };
  }

  // All steps matched — traces are identical.
  return {
    parentTraceId: parentTrace.id,
    childTraceId: childTrace.id,
    sharedPrefixLength,
    hasDivergence: false,
    firstDivergenceIndex: null,
    parentStep: null,
    childStep: null,
    isParentStrictPrefixOfChild: false,
    isChildStrictPrefixOfParent: false,
  };
}

/**
 * Integrity comparison: step hashes must match exactly. Because timestamps and
 * the previous hash are part of each integrity hash, independent recordings of
 * the same behavior normally diverge at step 0. This remains the default for
 * fork-prefix proofs and tamper-sensitive comparisons.
 */
export function diffTraces(parentTrace: Trace, childTrace: Trace): TraceDiff {
  return compareTraces(parentTrace, childTrace, (parent, child) => parent.hash === child.hash);
}

/**
 * Semantic comparison for independent recordings. Compares only the ordered
 * step type and canonical payload, deliberately ignoring timestamps, ids,
 * prevHash, and integrity hashes. It never changes or weakens cassette hash
 * validation; callers should verify each trace separately before comparing.
 */
export function diffTracesSemantic(parentTrace: Trace, childTrace: Trace): TraceDiff {
  return compareTraces(
    parentTrace,
    childTrace,
    (parent, child) =>
      parent.type === child.type && canonicalize(parent.payload) === canonicalize(child.payload),
  );
}

function humanSummary(diff: TraceDiff): string {
  const idx = diff.firstDivergenceIndex as number;
  if (diff.isParentStrictPrefixOfChild) return `parent ended before child at index ${idx}`;
  if (diff.isChildStrictPrefixOfParent) return `child ended before parent at index ${idx}`;
  const pType = diff.parentStep?.type ?? "unknown";
  const cType = diff.childStep?.type ?? "unknown";
  if (pType === cType) return `${pType} differs at index ${idx}`;
  return `${pType} vs ${cType} at index ${idx}`;
}

export function formatFirstDivergence(diff: TraceDiff): string {
  const lines: string[] = [
    "--- trace diff ---",
    `Parent:         ${diff.parentTraceId}`,
    `Child:          ${diff.childTraceId}`,
    `Shared prefix:  ${diff.sharedPrefixLength} step(s)`,
    "",
  ];

  if (!diff.hasDivergence) {
    lines.push("Traces are identical (no divergence)");
    return lines.join("\n");
  }

  lines.push(`Summary:        ${humanSummary(diff)}`);
  lines.push(`First divergence at index ${diff.firstDivergenceIndex}`);

  // Per-side lines carry a humanized step label + one-line summary (shared with
  // `inspect`/`replay` wording) instead of a raw JSON dump.
  if (diff.parentStep !== null) {
    const s = diff.parentStep;
    lines.push(`  parent  ${stepTypeLabel(s.type).padEnd(14)}  ${s.hash.slice(0, 8)}  ${describeStep(s)}`);
  } else {
    lines.push("  parent  <no step>");
  }

  if (diff.childStep !== null) {
    const s = diff.childStep;
    lines.push(`  child   ${stepTypeLabel(s.type).padEnd(14)}  ${s.hash.slice(0, 8)}  ${describeStep(s)}`);
  } else {
    lines.push("  child   <no step>");
  }

  // Surface the value that actually changed so the difference is readable —
  // rather than a JSON dump truncated mid-key before the difference appears.
  // Empty for strict-prefix divergences (the `<no step>` marker covers those).
  for (const line of describeDivergenceField(diff.parentStep, diff.childStep)) {
    lines.push(line);
  }

  if (diff.isParentStrictPrefixOfChild) {
    lines.push("  (parent is a strict prefix of child)");
  }
  if (diff.isChildStrictPrefixOfParent) {
    lines.push("  (child is a strict prefix of parent)");
  }

  return lines.join("\n");
}

/**
 * Full diff report: the STRUCTURAL divergence block (verbatim from
 * `formatFirstDivergence`) followed by the BEHAVIORAL `Outcome:` block.
 *
 * This wrapper exists because `formatFirstDivergence` receives only a
 * `TraceDiff` — which carries no full traces and no terminal outcomes — so it
 * cannot compute the behavioral verdict itself. `diffOutcome` needs the two
 * full `Trace` objects. `formatDiffReport` composes them without touching the
 * structural layer: `diffTraces`, the `TraceDiff` shape, and
 * `formatFirstDivergence` are all unchanged. Both `runDiff` and `runFork`
 * render through this one wrapper, so both surfaces gain the outcome verdict.
 */
export interface DiffReportOptions {
  /** Default: integrity (hash equality). Semantic ignores volatile trace fields. */
  comparison?: "integrity" | "semantic";
}

export function formatDiffReport(
  parentTrace: Trace,
  childTrace: Trace,
  options: DiffReportOptions = {},
): string {
  const comparison = options.comparison ?? "integrity";
  const traceDiff = comparison === "semantic"
    ? diffTracesSemantic(parentTrace, childTrace)
    : diffTraces(parentTrace, childTrace);
  const structural = formatFirstDivergence(traceDiff);
  const outcome = diffOutcome(parentTrace, childTrace);
  const comparisonNote = comparison === "semantic"
    ? "Comparison:      semantic (step type + payload; timestamps and hash-chain fields ignored)"
    : undefined;
  return [comparisonNote, structural, formatOutcomeDiff(outcome)].filter(Boolean).join("\n\n");
}
