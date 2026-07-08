// Cassette assertion — turn a committed cassette into a CI regression test (W9-A).
//
// assertCassette composes the EXISTING, unchanged core reads into a single
// PASS/FAIL verdict suitable for `npm run cli -- assert` in an npm script or a
// GitHub Actions step:
//
//   1. verifyTrace(trace)         the four hygiene invariants (schema, hash
//                                 chain, provider neutrality, replayability)
//   2. declared expectations      exact-match checks over the terminal outcome
//                                 and tool-call sequence — created ONLY for the
//                                 expectation flags the caller supplied
//
// It is pure and offline by construction: it only calls verifyTrace /
// terminalOutcome / toolCallSequence (all Trace-in, data-out) and never a model,
// tool, provider, clock, or network. It never mutates the trace, and — like
// verifyTrace — never throws for a bad trace.
//
// Design decisions (locked, W9-A):
//   - Exact string / exact ordered comparison only. No fuzzy, normalized, or
//     semantic matching (consistent with the W7-B outcome diff).
//   - Expectations come from the caller (CLI flags), never from the cassette
//     itself and never from a sidecar file.
//   - Short-circuit like verifyTrace: if the invariants fail, the supplied
//     expectation checks are reported as "skip" (never silently pass), and the
//     outcome/tool reads are not consulted for comparison.
//   - No change to verifyTrace / verifyTraceFile / terminalOutcome /
//     toolCallSequence / replayTrace / the trace schema or hashing.

import type { Trace } from "../trace/TraceTypes.ts";
import { loadTrace } from "../replay/CassetteReplay.ts";
import { verifyTrace, verifyTraceFile, type VerifyReport } from "../trace/verifyTrace.ts";
import { terminalOutcome, toolCallSequence } from "../trace/traceOutcome.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssertExpectations {
  expectStatus?: "success" | "error" | "incomplete";
  expectFinalAnswer?: string;
  expectFailureReason?: string;
  /** Ordered, exact tool-call sequence. `[]` asserts a final-answer-only run. */
  expectTools?: string[];
}

export interface AssertCheck {
  /** Stable row label: "status" | "final_answer" | "failure_reason" | "tools". */
  name: string;
  status: "pass" | "fail" | "skip";
  /** Present for supplied checks; the declared expectation, rendered for display. */
  expected?: string;
  /** Present for supplied checks; the value observed in the cassette. */
  actual?: string;
  detail: string;
}

export interface AssertReport {
  pass: boolean;
  /** The embedded verify verdict, consumed as-is (never recomputed differently). */
  verify: VerifyReport;
  /** One row per SUPPLIED expectation flag (absent flags produce no row). */
  checks: AssertCheck[];
  firstFailure?:
    | { kind: "verify"; report: VerifyReport }
    | { kind: "expectation"; check: AssertCheck };
}

// ---------------------------------------------------------------------------
// Expectation checks — created only for supplied flags, in a stable order
// ---------------------------------------------------------------------------

/** Human display for a tool list: comma-joined, or "(none)" when empty. */
function formatTools(tools: string[]): string {
  return tools.length > 0 ? tools.join(", ") : "(none)";
}

/** Build one skip row per supplied expectation (used when verification failed). */
function skipChecks(exp: AssertExpectations): AssertCheck[] {
  const checks: AssertCheck[] = [];
  const skip = (name: string): AssertCheck => ({
    name,
    status: "skip",
    detail: "skipped (verification failed)",
  });
  if (exp.expectStatus !== undefined) checks.push(skip("status"));
  if (exp.expectFinalAnswer !== undefined) checks.push(skip("final_answer"));
  if (exp.expectFailureReason !== undefined) checks.push(skip("failure_reason"));
  if (exp.expectTools !== undefined) checks.push(skip("tools"));
  return checks;
}

/** Compute exact-match expectation checks over a verified trace's behavior. */
function buildExpectationChecks(trace: Trace, exp: AssertExpectations): AssertCheck[] {
  const checks: AssertCheck[] = [];
  const outcome = terminalOutcome(trace);
  const tools = toolCallSequence(trace);

  if (exp.expectStatus !== undefined) {
    const actual = outcome.status;
    const ok = actual === exp.expectStatus;
    checks.push({
      name: "status",
      status: ok ? "pass" : "fail",
      expected: exp.expectStatus,
      actual,
      detail: ok ? actual : "status mismatch",
    });
  }

  if (exp.expectFinalAnswer !== undefined) {
    const actual = outcome.finalAnswer;
    const ok = actual === exp.expectFinalAnswer;
    checks.push({
      name: "final_answer",
      status: ok ? "pass" : "fail",
      expected: exp.expectFinalAnswer,
      actual: actual ?? "(none)",
      detail: ok ? actual ?? "" : "final answer mismatch",
    });
  }

  if (exp.expectFailureReason !== undefined) {
    const actual = outcome.failureReason;
    const ok = actual === exp.expectFailureReason;
    checks.push({
      name: "failure_reason",
      status: ok ? "pass" : "fail",
      expected: exp.expectFailureReason,
      actual: actual ?? "(none)",
      detail: ok ? actual ?? "" : "failure reason mismatch",
    });
  }

  if (exp.expectTools !== undefined) {
    const expected = exp.expectTools;
    const ok =
      expected.length === tools.length && expected.every((t, i) => t === tools[i]);
    checks.push({
      name: "tools",
      status: ok ? "pass" : "fail",
      expected: formatTools(expected),
      actual: formatTools(tools),
      detail: ok ? formatTools(tools) : "tool sequence mismatch",
    });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// assertCassette — pure, offline. Never throws for a bad trace.
// ---------------------------------------------------------------------------

export function assertCassette(
  trace: Trace,
  expectations: AssertExpectations = {},
): AssertReport {
  const verify = verifyTrace(trace);

  // Invariants gate the expectations: if the cassette is not internally sound,
  // its behavioral outcome cannot be trusted, so supplied expectations skip.
  if (!verify.pass) {
    return {
      pass: false,
      verify,
      checks: skipChecks(expectations),
      firstFailure: { kind: "verify", report: verify },
    };
  }

  const checks = buildExpectationChecks(trace, expectations);
  const failed = checks.find((chk) => chk.status === "fail");
  const report: AssertReport = { pass: !failed, verify, checks };
  if (failed) report.firstFailure = { kind: "expectation", check: failed };
  return report;
}

// ---------------------------------------------------------------------------
// assertCassetteFile — load from disk, then assert. Mirrors verifyTraceFile's
// honest-fail contract: a load / JSON / version failure becomes a structured
// FAIL report (never an uncaught throw), so CI gets exit 1, not a stack trace.
// ---------------------------------------------------------------------------

export async function assertCassetteFile(
  path: string,
  expectations: AssertExpectations = {},
): Promise<AssertReport> {
  let trace: Trace;
  try {
    trace = await loadTrace(path);
  } catch {
    // Delegate the load-failure verdict to verifyTraceFile (unchanged), which
    // maps a load/JSON/version failure onto a schema_version FAIL report.
    const verify = await verifyTraceFile(path);
    return {
      pass: false,
      verify,
      checks: skipChecks(expectations),
      firstFailure: { kind: "verify", report: verify },
    };
  }

  const report = assertCassette(trace, expectations);
  report.verify.path = path;
  return report;
}
