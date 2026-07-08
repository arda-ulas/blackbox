// Unified Blackbox CLI entry point.
// Usage: npm run cli -- <subcommand> [flags]
// Subcommands: record, replay, fork, diff, list, inspect

import { mkdir, readdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { TraceRecorder } from "./trace/TraceRecorder.ts";
import { FakeDeterministicModelClient } from "./agent/modelClient.ts";
import { ReactiveDemoModelClient } from "./agent/reactiveDemoModel.ts";
import { defaultToolExecutor } from "./agent/fixtureTools.ts";
import { runAgentLoop } from "./agent/agentLoop.ts";
import {
  saveTrace,
  loadTrace,
  validateTrace,
  replayTrace,
} from "./replay/CassetteReplay.ts";
import { forkRun } from "./fork/forkRun.ts";
import { formatDiffReport } from "./fork/diffTraces.ts";
import { verifyTraceFile, type VerifyReport } from "./trace/verifyTrace.ts";
import { formatVerifyFailure } from "./trace/verifyExplain.ts";
import { runSelfCheck } from "./workflow/selfCheck.ts";
import type { JsonValue, Trace } from "./trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// Arg parser
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    }
    i++;
  }
  return flags;
}

/** Die if any parsed flag is not in the allowed set for this subcommand. */
function checkUnknownFlags(
  flags: Record<string, string | boolean>,
  allowed: string[],
): void {
  for (const key of Object.keys(flags)) {
    if (!allowed.includes(key)) {
      die(`Unknown flag: --${key}`);
    }
  }
}

/**
 * Die if a value-type flag was given without a value (parsed as boolean true).
 * A flag that was not provided at all (undefined) passes this check.
 */
function checkValueFlags(
  flags: Record<string, string | boolean>,
  valueFlags: string[],
): void {
  for (const key of valueFlags) {
    if (flags[key] === true) {
      die(`Missing value for --${key}`);
    }
  }
}

function str(v: string | boolean | undefined, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function parseIntFlag(
  flags: Record<string, string | boolean>,
  name: string,
  defaultValue: number,
): number {
  const raw = flags[name];
  if (raw === undefined || raw === true) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    die(`--${name} must be a non-negative integer; got "${String(raw)}"`);
  }
  return parsed;
}

function die(msg: string): never {
  console.error(`[blackbox error] ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`[blackbox] Usage: npm run cli -- <command> [flags]

Commands:
  record    Run demo agent traces and save cassettes to disk
  replay    Replay a cassette offline (no model or tool calls)
  fork      Fork a trace with a prompt or tool-result mutation
  diff      Load two cassettes and print the first divergence
  verify    Verify a cassette's schema, hash chain, neutrality, and replayability
  check     Run the full offline loop (record→verify→fork→verify→diff) and report one verdict
  list      List all trace cassettes in a directory
  inspect   Print detailed info and step timeline for a cassette

Run a command with no flags to use defaults.
`);
}

// ---------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------

const RECORD_ALLOWED     = ["scenario", "out-dir"];
const RECORD_VALUE_FLAGS = ["scenario", "out-dir"];

async function runRecord(flags: Record<string, string | boolean>): Promise<void> {
  checkUnknownFlags(flags, RECORD_ALLOWED);
  checkValueFlags(flags, RECORD_VALUE_FLAGS);

  const scenario = str(flags["scenario"], "all");
  const outDir   = str(flags["out-dir"],  "traces");

  if (!["success", "error", "all"].includes(scenario)) {
    die(`--scenario must be success, error, or all; got "${scenario}"`);
  }

  await mkdir(outDir, { recursive: true });

  const label = (s: string) => s.padEnd(14);

  console.log("[blackbox] record — generating demo traces\n");

  if (scenario === "success" || scenario === "all") {
    const successScenario = "Book a hotel for Alice this weekend.";
    const successRecorder = new TraceRecorder("example-run-001", { createdAt: Date.now() });
    const successModel = new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "search",   toolInput: { query: "weekend hotels" } },
      { type: "tool_call", toolName: "calendar", toolInput: { date: "2024-03-15" } },
      { type: "tool_call", toolName: "booking",  toolInput: { date: "2024-03-15", time: "14:00", name: "Alice" } },
      { type: "final_answer", text: "Hotel booked for Alice on 2024-03-15 at 14:00." },
    ]);

    const successResult = await runAgentLoop({
      model:    successModel,
      toolExecutor: defaultToolExecutor(),
      recorder: successRecorder,
      prompt:   successScenario,
      maxSteps: 10,
    });

    validateTrace(successResult.trace);
    const successPath = join(outDir, "example-trace.json");
    await saveTrace(successResult.trace, successPath);

    console.log("[blackbox] --- success trace ---");
    console.log(label("Scenario:"),   successScenario);
    console.log(label("Trace ID:"),   successResult.trace.id);
    console.log(label("Output:"),     successPath);
    console.log(label("Steps:"),      successResult.trace.steps.length);
    console.log(label("Validation:"), "passed");
    console.log(label("Result:"),     successResult.finalAnswer);
    console.log();
  }

  if (scenario === "error" || scenario === "all") {
    const errorScenario = "Find the cheapest flight to Tokyo this weekend.";
    const errorRecorder = new TraceRecorder("example-error-run", { createdAt: Date.now() });
    const errorModel = new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "flights", toolInput: { destination: "Tokyo" } },
    ]);

    try {
      await runAgentLoop({
        model:    errorModel,
        toolExecutor: defaultToolExecutor(),
        recorder: errorRecorder,
        prompt:   errorScenario,
        maxSteps: 5,
      });
    } catch {
      // Expected: agent loop aborts when model calls unknown tool "flights".
    }

    const errorTrace   = errorRecorder.getTrace();
    validateTrace(errorTrace);
    const errorPath = join(outDir, "example-error-trace.json");
    await saveTrace(errorTrace, errorPath);

    const errorMeta    = errorTrace.steps.at(-1);
    const errorPayload = errorMeta?.payload as { reason?: string } | undefined;

    console.log("[blackbox] --- error trace ---");
    console.log(label("Scenario:"),   errorScenario);
    console.log(label("Trace ID:"),   errorTrace.id);
    console.log(label("Output:"),     errorPath);
    console.log(label("Steps:"),      errorTrace.steps.length);
    console.log(label("Validation:"), "passed");
    console.log(label("Status:"),     "error");
    console.log(label("Reason:"),     errorPayload?.reason ?? "unknown_tool");
    console.log();
  }
}

// ---------------------------------------------------------------------------
// replay
// ---------------------------------------------------------------------------

const REPLAY_ALLOWED     = ["trace"];
const REPLAY_VALUE_FLAGS = ["trace"];

async function runReplay(flags: Record<string, string | boolean>): Promise<void> {
  checkUnknownFlags(flags, REPLAY_ALLOWED);
  checkValueFlags(flags, REPLAY_VALUE_FLAGS);

  const tracePath = str(flags["trace"], "traces/example-trace.json");

  const trace   = await loadTrace(tracePath);
  validateTrace(trace);
  const summary = replayTrace(trace);

  const label = (s: string) => s.padEnd(14);

  console.log("[blackbox] --- replay ---");
  console.log(label("Path:"),       tracePath);
  console.log(label("Trace ID:"),   trace.id);
  console.log(label("Steps:"),      trace.steps.length);
  console.log(label("Validation:"), "passed");
  console.log();

  console.log("--- events ---");
  for (const event of summary.events) {
    console.log(`  ${String(event.index).padStart(2)}  ${event.type.padEnd(14)}  ${event.summary}`);
  }

  console.log();
  console.log("--- summary ---");
  console.log(label("Status:"), summary.status);
  if (summary.result !== undefined)        console.log(label("Result:"),  summary.result);
  if (summary.failureReason !== undefined) console.log(label("Reason:"),  summary.failureReason);
}

// ---------------------------------------------------------------------------
// fork
// ---------------------------------------------------------------------------

const FORK_ALLOWED = [
  "trace", "out", "fork-index", "mode",
  "prompt", "mutation-step", "payload-json",
];
const FORK_VALUE_FLAGS = [
  "trace", "out", "mode", "prompt",
  "fork-index", "mutation-step", "payload-json",
];

const DEMO_FORK_INDEX    = 4;
const DEMO_MUTATION_STEP = 3;
const DEMO_SEARCH_MUTATION: JsonValue = {
  results:   [],
  available: false,
  message:   "No hotels available for that date.",
};

async function runFork(flags: Record<string, string | boolean>): Promise<void> {
  checkUnknownFlags(flags, FORK_ALLOWED);
  checkValueFlags(flags, FORK_VALUE_FLAGS);

  const tracePath = str(flags["trace"], "traces/example-trace.json");
  const mode      = str(flags["mode"],  "tool-result");

  if (!["prompt", "tool-result"].includes(mode)) {
    die(`--mode must be prompt or tool-result; got "${mode}"`);
  }

  const forkIndex = parseIntFlag(flags, "fork-index", DEMO_FORK_INDEX);

  // Load and validate parent before any further work.
  const parentTrace = await loadTrace(tracePath);
  validateTrace(parentTrace);

  // Default output path: replace .json suffix with -fork.json so that
  // traces/example-trace.json → traces/example-trace-fork.json.
  const defaultOut = tracePath.replace(/\.json$/, "-fork.json");
  const outPath    = str(flags["out"], defaultOut);

  // Guardrail: never write the child over its own parent. This catches both an
  // explicit --out equal to --trace and the footgun where --trace lacks a
  // ".json" suffix (so the derived default output collides with the input).
  // Compare normalized absolute paths so "./a.json" and "a.json" resolve alike.
  if (resolve(outPath) === resolve(tracePath)) {
    die(`Refusing to overwrite the parent trace at ${resolve(tracePath)}. Pass an explicit --out.`);
  }

  let childTrace: Awaited<ReturnType<typeof forkRun>>["childTrace"];
  let finalAnswer: string;
  let prefixLength: number;
  let mutationStep: number | undefined;

  if (mode === "tool-result") {
    mutationStep = parseIntFlag(flags, "mutation-step", DEMO_MUTATION_STEP);

    let payload: JsonValue;
    if (typeof flags["payload-json"] === "string") {
      try {
        payload = JSON.parse(flags["payload-json"]) as JsonValue;
      } catch (e) {
        die(`Invalid JSON for --payload-json: ${String(e)}`);
      }
    } else {
      payload = DEMO_SEARCH_MUTATION;
    }

    const result = await forkRun({
      parentTrace,
      forkIndex,
      childId:             `${parentTrace.id}-fork`,
      promptMutation:      "(tool-result mutation — promptMutation unused)",
      toolResultMutations: { [mutationStep]: payload },
      // Reactive fake: derives the child's answer from the mutated tool_result
      // in the reconstructed transcript, so changing --payload-json changes the
      // answer. Fake/offline — no live call by construction.
      model: new ReactiveDemoModelClient(),
      toolExecutor: defaultToolExecutor(),
    });
    childTrace   = result.childTrace;
    finalAnswer  = result.finalAnswer;
    prefixLength = result.prefixLength;
  } else {
    const prompt = str(flags["prompt"], "");
    if (!prompt) die("--prompt is required when --mode prompt is used");

    const result = await forkRun({
      parentTrace,
      forkIndex,
      childId:        `${parentTrace.id}-fork`,
      promptMutation: prompt,
      // Reactive fake: a prompt-mode fork carries no reconstructed tool rounds
      // (forkRun only rebuilds them under tool-result mutations), so the model
      // hits its rule-4 fallback and derives the answer from the mutated prompt.
      model: new ReactiveDemoModelClient(),
      toolExecutor: defaultToolExecutor(),
    });
    childTrace   = result.childTrace;
    finalAnswer  = result.finalAnswer;
    prefixLength = result.prefixLength;
  }

  validateTrace(childTrace);
  await mkdir(dirname(outPath) || ".", { recursive: true });
  await saveTrace(childTrace, outPath);

  const formatted = formatDiffReport(parentTrace, childTrace);

  const label = (s: string) => s.padEnd(15);

  console.log("[blackbox] --- fork ---\n");

  console.log("--- parent ---");
  console.log(label("Path:"),     tracePath);
  console.log(label("Trace ID:"), parentTrace.id);
  console.log(label("Steps:"),    parentTrace.steps.length);
  console.log();

  console.log("--- mutation ---");
  console.log(label("Mode:"), mode);
  if (mutationStep !== undefined) {
    const verbatimCount = mutationStep; // steps 0..(mutationStep-1) are hash-identical to parent
    console.log(label("Mutation step:"), mutationStep);
    console.log(label("Fork index:"),    forkIndex);
    if (verbatimCount > 0) {
      console.log(
        label("Verbatim:"),
        `steps 0–${verbatimCount - 1}  (${verbatimCount} step(s), hashes identical to parent)`,
      );
    }
    console.log(label("Mutated:"), `step ${mutationStep}  tool_result → new hash`);
  } else {
    console.log(label("Prompt:"),     str(flags["prompt"], ""));
    console.log(label("Fork index:"), forkIndex);
    console.log(
      label("Verbatim:"),
      `steps 0–${forkIndex - 1}  (${forkIndex} step(s), hashes identical to parent)`,
    );
  }
  console.log(label("Prefix len:"), `${prefixLength} step(s)`);
  console.log();

  console.log("--- child ---");
  console.log(label("Path:"),       outPath);
  console.log(label("Trace ID:"),   childTrace.id);
  console.log(label("Steps:"),      childTrace.steps.length);
  console.log(label("Result:"),     finalAnswer);
  console.log(label("Validation:"), "passed");
  console.log();

  console.log(formatted);
}

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

const DIFF_ALLOWED     = ["parent", "child"];
const DIFF_VALUE_FLAGS = ["parent", "child"];

async function runDiff(flags: Record<string, string | boolean>): Promise<void> {
  checkUnknownFlags(flags, DIFF_ALLOWED);
  checkValueFlags(flags, DIFF_VALUE_FLAGS);

  if (!flags["parent"] || flags["parent"] === true) die("Missing required flag: --parent");
  if (!flags["child"]  || flags["child"]  === true) die("Missing required flag: --child");

  const parentTrace = await loadTrace(flags["parent"] as string);
  const childTrace  = await loadTrace(flags["child"]  as string);
  validateTrace(parentTrace);
  validateTrace(childTrace);

  const parentPath = flags["parent"] as string;
  const childPath  = flags["child"]  as string;

  console.log("[blackbox] --- diff ---");
  console.log(`Parent:  ${parentPath}`);
  console.log(`Child:   ${childPath}`);
  console.log();
  console.log(formatDiffReport(parentTrace, childTrace));
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

const VERIFY_ALLOWED     = ["trace"];
const VERIFY_VALUE_FLAGS = ["trace"];

/** Pad an invariant name to a stable column width for the report table. */
function verifyLine(inv: VerifyReport["invariants"][number]): string {
  const name   = inv.name.padEnd(20);
  const status = inv.status === "fail" ? "FAIL" : inv.status;
  const step   = inv.stepIndex !== undefined ? `[step ${inv.stepIndex}] ` : "";
  return `  ${name} ${status.padEnd(5)} ${step}${inv.detail}`;
}

async function runVerify(flags: Record<string, string | boolean>): Promise<void> {
  checkUnknownFlags(flags, VERIFY_ALLOWED);
  checkValueFlags(flags, VERIFY_VALUE_FLAGS);

  const tracePath = str(flags["trace"], "traces/example-trace.json");

  // verifyTraceFile never throws for a bad trace — a load/JSON/version failure
  // is reported as a schema_version FAIL, keeping the verdict honest.
  const report = await verifyTraceFile(tracePath);

  const label = (s: string) => s.padEnd(14);

  console.log("[blackbox] --- verify ---");
  console.log(label("Path:"),   tracePath);
  console.log(label("Result:"), report.pass ? "PASS" : "FAIL");
  console.log();

  for (const inv of report.invariants) {
    console.log(verifyLine(inv));
  }

  if (report.firstFailure) {
    console.log();
    for (const line of formatVerifyFailure(report)) {
      console.log(line);
    }
  }

  // Exit non-zero on FAIL so `verify` is scriptable.
  if (!report.pass) process.exit(1);
}

// ---------------------------------------------------------------------------
// check — run the full offline loop and report one PASS/FAIL verdict
// ---------------------------------------------------------------------------

const CHECK_ALLOWED     = ["out-dir"];
const CHECK_VALUE_FLAGS = ["out-dir"];

async function runCheck(flags: Record<string, string | boolean>): Promise<void> {
  checkUnknownFlags(flags, CHECK_ALLOWED);
  checkValueFlags(flags, CHECK_VALUE_FLAGS);

  const outDir = typeof flags["out-dir"] === "string" ? flags["out-dir"] : undefined;

  // Fully offline: runSelfCheck only instantiates the fake model and fixture
  // tools, so no real model/tool/network call is possible here.
  const report = await runSelfCheck(outDir !== undefined ? { outDir } : {});

  const label = (s: string) => s.padEnd(15);

  console.log("[blackbox] --- check ---");
  console.log(
    label("Mode:"),
    report.persisted
      ? `persisted (--out-dir ${outDir})`
      : "in-memory (no files written; pass --out-dir to persist)",
  );
  if (report.persisted) {
    if (report.parentPath) console.log(label("Parent:"), report.parentPath);
    if (report.childPath)  console.log(label("Child:"),  report.childPath);
  }
  console.log();

  for (const stage of report.stages) {
    const status = stage.status === "fail" ? "FAIL" : stage.status;
    console.log(`  ${stage.name.padEnd(14)} ${status.padEnd(4)}  ${stage.detail}`);
  }

  console.log();
  console.log(label("Result:"), report.pass ? "PASS" : "FAIL");

  if (report.firstFailure) {
    console.log();
    console.log(`First failing stage: ${report.firstFailure.name} — ${report.firstFailure.detail}`);
  }

  // Exit non-zero on FAIL so `check` is scriptable, consistent with `verify`.
  if (!report.pass) process.exit(1);
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

const LIST_ALLOWED     = ["dir"];
const LIST_VALUE_FLAGS = ["dir"];

/** Extract a short status string from a loaded trace without calling replayTrace. */
function extractStatus(trace: Trace): string {
  const last = trace.steps.at(-1);
  if (last?.type !== "metadata") return "incomplete";
  const p = last.payload as { event?: string; status?: string; reason?: string };
  if (p.event === "run_completed" && p.status === "success") return "success";
  if (p.event === "run_failed") return p.reason ? `error/${p.reason}` : "error";
  return "incomplete";
}

async function runList(flags: Record<string, string | boolean>): Promise<void> {
  checkUnknownFlags(flags, LIST_ALLOWED);
  checkValueFlags(flags, LIST_VALUE_FLAGS);

  const dir = str(flags["dir"], "traces");

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    console.log(`[blackbox] No traces found — directory "${dir}" does not exist.`);
    return;
  }

  const jsonFiles = entries.filter((f) => f.endsWith(".json")).sort();

  if (jsonFiles.length === 0) {
    console.log(`[blackbox] No trace files found in "${dir}".`);
    return;
  }

  console.log(`[blackbox] --- list (${dir}) ---\n`);

  let validCount = 0;
  for (const file of jsonFiles) {
    const filePath = join(dir, file);
    try {
      const trace   = await loadTrace(filePath);
      validateTrace(trace);
      const status  = extractStatus(trace);
      const created = new Date(trace.createdAt).toISOString().slice(0, 10);
      const parent  = trace.parentId ? `  parent=${trace.parentId}` : "";

      console.log(`  ${filePath}`);
      console.log(
        `    id=${trace.id}  v=${trace.version}  steps=${trace.steps.length}  status=${status}  created=${created}${parent}`,
      );
      validCount++;
    } catch (e) {
      const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
      const brief = msg.length > 80 ? msg.slice(0, 80) + "…" : msg;
      console.log(`  ${filePath}`);
      console.log(`    [warning] not a valid trace — ${brief}`);
    }
    console.log();
  }

  const warningCount = jsonFiles.length - validCount;
  console.log(`[blackbox] ${validCount} of ${jsonFiles.length} trace(s) valid, ${warningCount} warning(s).`);
}

// ---------------------------------------------------------------------------
// inspect
// ---------------------------------------------------------------------------

const INSPECT_ALLOWED     = ["trace"];
const INSPECT_VALUE_FLAGS = ["trace"];

async function runInspect(flags: Record<string, string | boolean>): Promise<void> {
  checkUnknownFlags(flags, INSPECT_ALLOWED);
  checkValueFlags(flags, INSPECT_VALUE_FLAGS);

  const tracePath = str(flags["trace"], "traces/example-trace.json");

  const trace   = await loadTrace(tracePath);
  validateTrace(trace);
  const summary = replayTrace(trace);

  const label   = (s: string) => s.padEnd(20);
  const created = new Date(trace.createdAt).toISOString();

  console.log("[blackbox] --- inspect ---\n");

  console.log("--- trace ---");
  console.log(label("Path:"),     tracePath);
  console.log(label("Trace ID:"), trace.id);
  console.log(label("Version:"),  trace.version);
  if (trace.parentId)         console.log(label("Parent ID:"),   trace.parentId);
  if (trace.forkedFromStepId) console.log(label("Forked from:"), trace.forkedFromStepId);
  console.log(label("Created:"),  created);
  console.log(label("Steps:"),    trace.steps.length);
  console.log();

  console.log("--- status ---");
  console.log(label("Status:"), summary.status);
  if (summary.result !== undefined)        console.log(label("Result:"), summary.result);
  if (summary.failureReason !== undefined) console.log(label("Reason:"), summary.failureReason);
  console.log();

  console.log("[blackbox] --- steps ---");
  for (const event of summary.events) {
    const step      = trace.steps[event.index];
    const shortHash = step.hash.slice(0, 8);
    console.log(
      `  ${String(event.index).padStart(2)}  ${event.type.padEnd(14)}  ${shortHash}  ${event.summary}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const argv = process.argv as string[];
const [,, subcommand, ...rest] = argv;
const flags = parseArgs(rest ?? []);

try {
  switch (subcommand) {
    case "record":  await runRecord(flags);  break;
    case "replay":  await runReplay(flags);  break;
    case "fork":    await runFork(flags);    break;
    case "diff":    await runDiff(flags);    break;
    case "verify":  await runVerify(flags);  break;
    case "check":   await runCheck(flags);   break;
    case "list":    await runList(flags);    break;
    case "inspect": await runInspect(flags); break;
    default:
      if (subcommand) {
        console.error(
          `[blackbox error] Unknown subcommand: "${subcommand}". Valid: record, replay, fork, diff, verify, check, list, inspect`,
        );
        process.exit(1);
      }
      printUsage();
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[blackbox error] ${msg}`);
  process.exit(1);
}
