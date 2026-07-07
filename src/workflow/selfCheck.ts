// Composed offline self-check of the active-debugging loop (W4-G).
//
// runSelfCheck runs the canonical loop — record -> verify(parent) -> fork ->
// verify(child) -> diff — end to end and returns a single structured PASS/FAIL
// report. It COMPOSES existing, already-tested functions (runAgentLoop, forkRun,
// verifyTrace, diffTraces) over the deterministic fake model and fixture tools —
// it adds no new record/replay/fork/diff/verify logic and changes none of their
// semantics.
//
// It cannot make a real model, tool, or network call by construction: the only
// clients it instantiates are FakeDeterministicModelClient and
// defaultToolExecutor(), exactly like the existing CLI demo.
//
// Persistence is controlled solely by opts.outDir:
//   - default (no outDir): in-memory / self-contained; writes NO trace files.
//   - with outDir:         persist parent + child cassettes under that directory
//                          (the report is otherwise identical — persistence never
//                          changes the verdict).
// There is no --keep flag.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { JsonValue, Trace } from "../trace/TraceTypes.ts";
import { TraceRecorder } from "../trace/TraceRecorder.ts";
import { FakeDeterministicModelClient } from "../agent/modelClient.ts";
import { defaultToolExecutor } from "../agent/fixtureTools.ts";
import { runAgentLoop } from "../agent/agentLoop.ts";
import { saveTrace, validateTrace } from "../replay/CassetteReplay.ts";
import { forkRun } from "../fork/forkRun.ts";
import { diffTraces } from "../fork/diffTraces.ts";
import { verifyTrace } from "../trace/verifyTrace.ts";

// ---------------------------------------------------------------------------
// Demo geometry — mirrors the CLI demo (record + tool-result fork) so the
// self-check exercises the same success path the walkthrough documents.
// ---------------------------------------------------------------------------

const DEMO_PROMPT = "Book a hotel for Alice this weekend.";
const DEMO_FORK_INDEX = 4;
const DEMO_MUTATION_STEP = 3;
const DEMO_SEARCH_MUTATION: JsonValue = {
  results: [],
  available: false,
  message: "No hotels available for that date.",
};
const DEMO_FORK_ANSWER =
  "No hotels available for Alice this weekend. The area is fully booked — consider a different date.";

const PARENT_FILE = "check-parent.json";
const CHILD_FILE = "check-child.json";

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export type SelfCheckStageName =
  | "record"
  | "verify_parent"
  | "fork"
  | "verify_child"
  | "diff";

export type SelfCheckStatus = "pass" | "fail";

export interface SelfCheckStage {
  name: SelfCheckStageName;
  status: SelfCheckStatus;
  /** Human-readable detail. Never contains a key value or a raw SDK object. */
  detail: string;
}

export interface SelfCheckReport {
  pass: boolean;
  stages: SelfCheckStage[];
  firstFailure?: { name: SelfCheckStageName; detail: string };
  /** Whether cassettes were written (true only when opts.outDir was provided). */
  persisted: boolean;
  /** Absolute/joined path of the persisted parent cassette (present iff persisted). */
  parentPath?: string;
  /** Absolute/joined path of the persisted child cassette (present iff persisted). */
  childPath?: string;
  /** In-memory traces, so an outDir persist can write without re-running the loop. */
  parentTrace: Trace;
  childTrace: Trace;
}

export interface SelfCheckOptions {
  /** When set, persist parent + child cassettes under this directory. */
  outDir?: string;
}

// ---------------------------------------------------------------------------
// runSelfCheck
// ---------------------------------------------------------------------------

/** Summarize a verifyTrace report into a one-line detail + pass/fail. */
function summarizeVerify(trace: Trace): { ok: boolean; detail: string } {
  const report = verifyTrace(trace);
  const passCount = report.invariants.filter((i) => i.status === "pass").length;
  const total = report.invariants.length;
  if (report.pass) {
    return { ok: true, detail: `${passCount}/${total} invariants` };
  }
  const f = report.firstFailure;
  const where = f?.stepIndex !== undefined ? ` at step ${f.stepIndex}` : "";
  return { ok: false, detail: f ? `${f.name} FAIL${where}` : "verification failed" };
}

export async function runSelfCheck(
  opts: SelfCheckOptions = {},
): Promise<SelfCheckReport> {
  const stages: SelfCheckStage[] = [];
  const add = (name: SelfCheckStageName, status: SelfCheckStatus, detail: string): void => {
    stages.push({ name, status, detail });
  };

  // --- Stage 1: record (fake model + fixture tools; no real call) -----------
  const recorder = new TraceRecorder("selfcheck-parent-001");
  const recordResult = await runAgentLoop({
    model: new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "search", toolInput: { query: "weekend hotels" } },
      { type: "tool_call", toolName: "calendar", toolInput: { date: "2024-03-15" } },
      { type: "tool_call", toolName: "booking", toolInput: { date: "2024-03-15", time: "14:00", name: "Alice" } },
      { type: "final_answer", text: "Hotel booked for Alice on 2024-03-15 at 14:00." },
    ]),
    toolExecutor: defaultToolExecutor(),
    recorder,
    prompt: DEMO_PROMPT,
    maxSteps: 10,
  });
  const parentTrace = recordResult.trace;
  add("record", "pass", `success trace, ${parentTrace.steps.length} step(s)`);

  // --- Stage 2: verify(parent) ----------------------------------------------
  {
    const v = summarizeVerify(parentTrace);
    add("verify_parent", v.ok ? "pass" : "fail", v.detail);
  }

  // --- Stage 3: fork (tool-result mutation at the demo step) ----------------
  const forkResult = await forkRun({
    parentTrace,
    forkIndex: DEMO_FORK_INDEX,
    childId: `${parentTrace.id}-fork`,
    promptMutation: "(tool-result mutation — promptMutation unused)",
    toolResultMutations: { [DEMO_MUTATION_STEP]: DEMO_SEARCH_MUTATION },
    model: new FakeDeterministicModelClient([
      { type: "final_answer", text: DEMO_FORK_ANSWER },
    ]),
    toolExecutor: defaultToolExecutor(),
  });
  const childTrace = forkResult.childTrace;
  try {
    validateTrace(childTrace);
    add(
      "fork",
      "pass",
      `child valid, ${childTrace.steps.length} step(s), tool_result mutation at step ${DEMO_MUTATION_STEP}`,
    );
  } catch (e) {
    add("fork", "fail", e instanceof Error ? e.message.split("\n")[0] : String(e));
  }

  // --- Stage 4: verify(child) -----------------------------------------------
  {
    const v = summarizeVerify(childTrace);
    add("verify_child", v.ok ? "pass" : "fail", v.detail);
  }

  // --- Stage 5: diff (first divergence over a hash-identical prefix) ---------
  {
    const diff = diffTraces(parentTrace, childTrace);
    const ok =
      diff.hasDivergence &&
      diff.firstDivergenceIndex === DEMO_MUTATION_STEP &&
      diff.sharedPrefixLength > 0;
    const detail = diff.hasDivergence
      ? `first divergence at index ${diff.firstDivergenceIndex}, shared prefix ${diff.sharedPrefixLength} step(s)`
      : "no divergence (expected a mutated tool_result)";
    add("diff", ok ? "pass" : "fail", detail);
  }

  // --- Optional persistence (opt-in via outDir; never changes the verdict) ---
  let persisted = false;
  let parentPath: string | undefined;
  let childPath: string | undefined;
  if (opts.outDir !== undefined) {
    await mkdir(opts.outDir, { recursive: true });
    parentPath = join(opts.outDir, PARENT_FILE);
    childPath = join(opts.outDir, CHILD_FILE);
    await saveTrace(parentTrace, parentPath);
    await saveTrace(childTrace, childPath);
    persisted = true;
  }

  const pass = stages.every((s) => s.status === "pass");
  const firstFailed = stages.find((s) => s.status === "fail");

  const report: SelfCheckReport = {
    pass,
    stages,
    persisted,
    parentTrace,
    childTrace,
  };
  if (firstFailed) report.firstFailure = { name: firstFailed.name, detail: firstFailed.detail };
  if (parentPath !== undefined) report.parentPath = parentPath;
  if (childPath !== undefined) report.childPath = childPath;
  return report;
}
