// Terminal-outcome extraction for a recorded run (W7-B).
//
// Two pure, offline, deterministic reads over a Trace:
//
//   - terminalOutcome(trace): how the run ended — success / error / incomplete,
//     plus the final answer (success) or failure reason (error). This is the
//     SINGLE SOURCE OF TRUTH for terminal-status parsing: replayTrace consumes
//     it (so replay and the behavioral outcome diff cannot drift), using exactly
//     the semantics replayTrace used inline before W7-B — read the LAST step,
//     and only if it is a `metadata` step do `run_completed`+`status:"success"`
//     → success (finalAnswer = payload.result) and `run_failed` → error
//     (failureReason = payload.reason); anything else (including no terminal
//     metadata) is `incomplete`.
//
//   - toolCallSequence(trace): the ordered list of tool names the agent actually
//     REQUESTED. DECISION (W7-B, locked): the sequence is defined by `tool_call`
//     steps — the agent's executed requests, one per call in agentLoop — NOT by
//     `tool_result` steps. The two differ only when a run aborts between a call
//     and its result; using `tool_call` captures "what the agent tried to do,"
//     which is the behavioral path a debugger cares about. Do not switch this to
//     `tool_result` without re-scoping.
//
// Both functions are pure: no clock, randomness, I/O, network, or provider /
// model / tool call, and they never mutate the input Trace.

import type { Trace } from "./TraceTypes.ts";

export interface TerminalOutcome {
  status: "success" | "error" | "incomplete";
  /** Final answer text, present only when status is "success" (and recorded). */
  finalAnswer?: string;
  /** Failure reason string, present only when status is "error" (and recorded). */
  failureReason?: string;
}

/**
 * Classify how a run ended from its terminal `metadata` step.
 *
 * Mirrors the exact semantics replayTrace used inline before W7-B, so that
 * replayTrace can delegate here without changing its returned fields.
 */
export function terminalOutcome(trace: Trace): TerminalOutcome {
  const last = trace.steps.at(-1);
  if (last?.type === "metadata") {
    const meta = last.payload as {
      event?: string;
      status?: string;
      result?: string;
      reason?: string;
    };
    if (meta.event === "run_completed" && meta.status === "success") {
      const outcome: TerminalOutcome = { status: "success" };
      if (meta.result !== undefined) outcome.finalAnswer = meta.result;
      return outcome;
    }
    if (meta.event === "run_failed") {
      const outcome: TerminalOutcome = { status: "error" };
      if (meta.reason !== undefined) outcome.failureReason = meta.reason;
      return outcome;
    }
  }
  return { status: "incomplete" };
}

/**
 * The ordered list of tool names the agent requested, read from `tool_call`
 * steps (see the module header for why `tool_call`, not `tool_result`).
 * Returns an empty array for a final-answer-only run.
 */
export function toolCallSequence(trace: Trace): string[] {
  const names: string[] = [];
  for (const step of trace.steps) {
    if (step.type === "tool_call") {
      const name = (step.payload as { toolName?: unknown }).toolName;
      names.push(typeof name === "string" ? name : "unknown");
    }
  }
  return names;
}
