// Cassette verification — one reusable verdict over a trace's hygiene.
//
// verifyTrace composes the existing, unchanged core checks into a single ordered
// pass and returns a structured PASS/FAIL report. It never mutates a trace, never
// throws for a bad trace, and — like replayTrace — takes only an in-memory Trace,
// so it cannot make a live call by construction.
//
// Invariant order (short-circuit at the first FAIL; later invariants → "skip"):
//   1. schema_version       version present and === CURRENT_TRACE_VERSION
//   2. hash_chain           validateTrace (index / prevHash / recomputed hash)
//   3. provider_neutrality  no provider-native markers or key leakage
//   4. replayability        offline replay agrees with any success claim
//
// W4-F. No change to hash.ts, validateTrace, replayTrace, or loadTrace semantics.

import { readFile } from "node:fs/promises";
import { CURRENT_TRACE_VERSION, type Trace } from "./TraceTypes.ts";
import { auditTraceNeutrality } from "./neutrality.ts";
import { loadTrace, validateTrace, replayTrace } from "../replay/CassetteReplay.ts";

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export type VerifyStatus = "pass" | "fail" | "skip";

export type VerifyInvariantName =
  | "schema_version"
  | "hash_chain"
  | "provider_neutrality"
  | "replayability";

export interface VerifyInvariant {
  name: VerifyInvariantName;
  status: VerifyStatus;
  /** Human-readable detail. Never contains a raw SDK object or a key value. */
  detail: string;
  /** Present when the failure is localized to a specific step. */
  stepIndex?: number;
}

export interface VerifyReport {
  pass: boolean;
  /** Set by verifyTraceFile; absent for the pure in-memory verifyTrace. */
  path?: string;
  invariants: VerifyInvariant[];
  firstFailure?: { name: VerifyInvariantName; detail: string; stepIndex?: number };
}

export interface VerifyOptions {
  /** Live key value to also reject if it somehow reached the payload. Never logged. */
  apiKey?: string;
  /** Skip the replay invariant (e.g. for a partial/aborted trace). Default: run it. */
  skipReplay?: boolean;
}

// ---------------------------------------------------------------------------
// Individual invariant checks — each returns pass/fail; the runner sequences them.
// ---------------------------------------------------------------------------

type CheckResult = { ok: true; detail: string } | { ok: false; detail: string; stepIndex?: number };

function checkSchemaVersion(trace: Trace): CheckResult {
  const v = (trace as { version?: unknown }).version;
  if (typeof v !== "number") {
    return { ok: false, detail: "version field is missing" };
  }
  if (v !== CURRENT_TRACE_VERSION) {
    return {
      ok: false,
      detail: `version ${v} is not supported (expected ${CURRENT_TRACE_VERSION})`,
    };
  }
  return { ok: true, detail: `version ${v}` };
}

/** Extract the offending step index from a validateTrace error message. */
function stepIndexFromValidateError(message: string): number | undefined {
  if (/first step/.test(message)) return 0;
  const m = message.match(/step (?:at position )?(\d+)/);
  return m ? Number(m[1]) : undefined;
}

function checkHashChain(trace: Trace): CheckResult {
  try {
    validateTrace(trace);
    return { ok: true, detail: `${trace.steps.length} step(s), chain intact` };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const detail = raw.replace(/^validateTrace:\s*/, "");
    const stepIndex = stepIndexFromValidateError(raw);
    return stepIndex === undefined
      ? { ok: false, detail }
      : { ok: false, detail, stepIndex };
  }
}

function checkNeutrality(trace: Trace, apiKey?: string): CheckResult {
  const audit = auditTraceNeutrality(trace, apiKey);
  if (audit.ok) return { ok: true, detail: "no forbidden markers" };
  return { ok: false, detail: `markers: ${audit.found.join(", ")}` };
}

function checkReplayability(trace: Trace): CheckResult {
  let summary;
  try {
    summary = replayTrace(trace);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: `replay threw: ${msg}` };
  }

  // A well-formed completed run must carry a terminal run_completed/success step,
  // which replayTrace reports as status "success". If the trace *claims* success
  // (a run_completed/success metadata step exists) but replay does not agree, the
  // trace is inconsistent (e.g. the success marker is not terminal). A legitimate
  // error/incomplete run has no such claim, so it passes.
  const hasSuccessClaim = trace.steps.some((s) => {
    if (s.type !== "metadata") return false;
    const p = s.payload as { event?: string; status?: string };
    return p.event === "run_completed" && p.status === "success";
  });

  if (hasSuccessClaim && summary.status !== "success") {
    const last = trace.steps.at(-1);
    return {
      ok: false,
      detail: `trace claims run_completed/success but replay status is "${summary.status}"`,
      stepIndex: last?.index,
    };
  }

  return { ok: true, detail: `status=${summary.status}` };
}

// ---------------------------------------------------------------------------
// verifyTrace — pure, offline. Never throws for a bad trace.
// ---------------------------------------------------------------------------

export function verifyTrace(trace: Trace, opts: VerifyOptions = {}): VerifyReport {
  const invariants: VerifyInvariant[] = [];
  let failed = false;

  const skip = (name: VerifyInvariantName): VerifyInvariant => ({
    name,
    status: "skip",
    detail: "skipped (earlier invariant failed)",
  });

  const run = (name: VerifyInvariantName, check: () => CheckResult): void => {
    if (failed) {
      invariants.push(skip(name));
      return;
    }
    const result = check();
    if (result.ok) {
      invariants.push({ name, status: "pass", detail: result.detail });
    } else {
      failed = true;
      const inv: VerifyInvariant = { name, status: "fail", detail: result.detail };
      if (result.stepIndex !== undefined) inv.stepIndex = result.stepIndex;
      invariants.push(inv);
    }
  };

  run("schema_version", () => checkSchemaVersion(trace));
  run("hash_chain", () => checkHashChain(trace));
  run("provider_neutrality", () => checkNeutrality(trace, opts.apiKey));

  if (opts.skipReplay) {
    invariants.push({
      name: "replayability",
      status: "skip",
      detail: "skipped (skipReplay option)",
    });
  } else {
    run("replayability", () => checkReplayability(trace));
  }

  const report: VerifyReport = { pass: !failed, invariants };
  const firstFailure = invariants.find((i) => i.status === "fail");
  if (firstFailure) {
    report.firstFailure = { name: firstFailure.name, detail: firstFailure.detail };
    if (firstFailure.stepIndex !== undefined) {
      report.firstFailure.stepIndex = firstFailure.stepIndex;
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// verifyTraceFile — load from disk, then verify. Load/JSON/version failures are
// mapped onto a schema_version FAIL rather than an uncaught throw.
// ---------------------------------------------------------------------------

export async function verifyTraceFile(
  path: string,
  opts: VerifyOptions = {},
): Promise<VerifyReport> {
  let trace: Trace;
  try {
    trace = await loadTrace(path);
  } catch (e) {
    const detail = e instanceof Error ? e.message.split("\n")[0] : String(e);
    const invariants: VerifyInvariant[] = [
      { name: "schema_version", status: "fail", detail },
      skipInvariant("hash_chain"),
      skipInvariant("provider_neutrality"),
      skipInvariant("replayability"),
    ];
    return {
      pass: false,
      path,
      invariants,
      firstFailure: { name: "schema_version", detail },
    };
  }

  const report = verifyTrace(trace, opts);
  report.path = path;
  return report;
}

function skipInvariant(name: VerifyInvariantName): VerifyInvariant {
  return { name, status: "skip", detail: "skipped (load failed)" };
}
