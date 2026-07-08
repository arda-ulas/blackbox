// Behavioral outcome diff (W7-B).
//
// Where diffTraces answers "at which step do the hashes diverge?", diffOutcome
// answers the debugging question one level up: "did the divergence change what
// the run actually DID?" It compares two runs' TERMINAL BEHAVIOR across three
// axes — final status, terminal result (final answer / failure reason), and the
// tool-call sequence — and classifies the delta with a strict precedence.
//
// Pure / offline / deterministic: a function of the two Trace objects only. No
// clock, randomness, I/O, network, or provider / model / tool call; neither
// input Trace is mutated. Comparison is EXACT-STRING (no semantic judge, which
// would require a model call) — the claim is "behavioral difference," not
// "semantic understanding." It runs independently of diffTraces: it does not
// require a hash divergence to exist.

import type { Trace } from "../trace/TraceTypes.ts";
import {
  terminalOutcome,
  toolCallSequence,
  type TerminalOutcome,
} from "../trace/traceOutcome.ts";

export interface OutcomeDiff {
  parentStatus: TerminalOutcome["status"];
  childStatus: TerminalOutcome["status"];
  /** Final status differs (success/error/incomplete). */
  statusChanged: boolean;
  /**
   * The terminal RESULT string differs given the same status: the final answer
   * for a `success` run, or the failure reason for an `error` run. Named
   * finalAnswerChanged for its most common case; for `error` it tracks the
   * failure reason. (undefined vs undefined counts as unchanged.)
   */
  finalAnswerChanged: boolean;
  /** The ordered tool-call sequence differs. */
  toolSequenceChanged: boolean;
  parentTools: string[];
  childTools: string[];
  /** True only when status, terminal result, AND tool sequence all match. */
  behaviorallyEquivalent: boolean;
  /** One-line human verdict (see the precedence in diffOutcome). */
  verdict: string;
}

/** The terminal result string that identifies a run's outcome, by status. */
function terminalResult(o: TerminalOutcome): string | undefined {
  if (o.status === "success") return o.finalAnswer;
  if (o.status === "error") return o.failureReason;
  return undefined; // incomplete
}

function sequencesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Classify the behavioral delta between a parent run and a (forked) child run.
 *
 * Strict precedence — the first matching rule wins:
 *   1. status differs                         → outcome flipped
 *   2. same status, terminal result differs   → answer / failure reason changed
 *   3. same status + same result, tools differ→ same outcome, different tool path
 *   4. all three equal                        → no behavioral change
 */
export function diffOutcome(parentTrace: Trace, childTrace: Trace): OutcomeDiff {
  const parent = terminalOutcome(parentTrace);
  const child = terminalOutcome(childTrace);

  const parentTools = toolCallSequence(parentTrace);
  const childTools = toolCallSequence(childTrace);

  const statusChanged = parent.status !== child.status;
  const finalAnswerChanged = terminalResult(parent) !== terminalResult(child);
  const toolSequenceChanged = !sequencesEqual(parentTools, childTools);

  const behaviorallyEquivalent =
    !statusChanged && !finalAnswerChanged && !toolSequenceChanged;

  let verdict: string;
  if (statusChanged) {
    verdict = `outcome flipped: parent ${parent.status} → child ${child.status}`;
  } else if (finalAnswerChanged) {
    // Same status; the terminal result string changed.
    verdict =
      parent.status === "error"
        ? "same final status (error), but the failure reason changed"
        : "same final status (success), but the final answer changed";
  } else if (toolSequenceChanged) {
    verdict = "same outcome, but the tool-call path changed";
  } else {
    verdict = "no behavioral change: the divergence did not alter the run outcome";
  }

  return {
    parentStatus: parent.status,
    childStatus: child.status,
    statusChanged,
    finalAnswerChanged,
    toolSequenceChanged,
    parentTools,
    childTools,
    behaviorallyEquivalent,
    verdict,
  };
}

/** Render a tool sequence for the diff readout (empty → "(none)"). */
function renderTools(tools: string[]): string {
  return tools.length > 0 ? tools.join(" → ") : "(none)";
}

/**
 * Render the one-line `Outcome:` verdict, followed by the two tool sequences
 * only when they differ. Provider-neutral text.
 */
export function formatOutcomeDiff(outcome: OutcomeDiff): string {
  const lines = [`Outcome:        ${outcome.verdict}`];
  if (outcome.toolSequenceChanged) {
    lines.push(`  parent tools:  ${renderTools(outcome.parentTools)}`);
    lines.push(`  child tools:   ${renderTools(outcome.childTools)}`);
  }
  return lines.join("\n");
}
