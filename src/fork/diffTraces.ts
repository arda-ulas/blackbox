// Trace divergence diff: finds the first step where two traces stop sharing
// identical hashes, then formats the result for terminal output.

import type { Trace, TraceStep } from "../trace/TraceTypes.ts";

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

export function diffTraces(parentTrace: Trace, childTrace: Trace): TraceDiff {
  const pSteps = parentTrace.steps;
  const cSteps = childTrace.steps;
  const maxLen = Math.max(pSteps.length, cSteps.length);

  let sharedPrefixLength = 0;

  for (let i = 0; i < maxLen; i++) {
    const pStep: TraceStep | null = pSteps[i] ?? null;
    const cStep: TraceStep | null = cSteps[i] ?? null;

    if (pStep !== null && cStep !== null && pStep.hash === cStep.hash) {
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

function payloadSummary(payload: unknown): string {
  const raw = JSON.stringify(payload);
  return raw.length > 60 ? raw.slice(0, 57) + "..." : raw;
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

  lines.push(`First divergence at index ${diff.firstDivergenceIndex}`);

  if (diff.parentStep !== null) {
    const s = diff.parentStep;
    lines.push(`  parent  ${s.type.padEnd(14)}  ${s.hash.slice(0, 8)}  ${payloadSummary(s.payload)}`);
  } else {
    lines.push("  parent  <no step>");
  }

  if (diff.childStep !== null) {
    const s = diff.childStep;
    lines.push(`  child   ${s.type.padEnd(14)}  ${s.hash.slice(0, 8)}  ${payloadSummary(s.payload)}`);
  } else {
    lines.push("  child   <no step>");
  }

  if (diff.isParentStrictPrefixOfChild) {
    lines.push("  (parent is a strict prefix of child)");
  }
  if (diff.isChildStrictPrefixOfParent) {
    lines.push("  (child is a strict prefix of parent)");
  }

  return lines.join("\n");
}
