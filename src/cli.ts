// Unified Blackbox CLI entry point.
// Usage: npm run cli -- <subcommand> [flags]
// Subcommands: record, replay, fork, diff

import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { TraceRecorder } from "./trace/TraceRecorder.ts";
import { FakeDeterministicModelClient } from "./agent/modelClient.ts";
import { defaultFixtureTools } from "./agent/fixtureTools.ts";
import { runAgentLoop } from "./agent/agentLoop.ts";
import {
  saveTrace,
  loadTrace,
  validateTrace,
  replayTrace,
} from "./replay/CassetteReplay.ts";
import { forkRun } from "./fork/forkRun.ts";
import { diffTraces, formatFirstDivergence } from "./fork/diffTraces.ts";
import type { JsonValue } from "./trace/TraceTypes.ts";

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
    console.error(
      `[blackbox error] --${name} must be a non-negative integer; got "${raw}"`,
    );
    process.exit(1);
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
  record   Run demo agent traces and save cassettes to disk
  replay   Replay a cassette offline (no model or tool calls)
  fork     Fork a trace with a prompt or tool-result mutation
  diff     Load two cassettes and print the first divergence

Run a command with no flags to use defaults.
`);
}

// ---------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------

async function runRecord(flags: Record<string, string | boolean>): Promise<void> {
  const scenario = str(flags["scenario"], "all");
  const outDir   = str(flags["out-dir"],  "traces");

  if (!["success", "error", "all"].includes(scenario)) {
    die(`--scenario must be success, error, or all; got "${scenario}"`);
  }

  await mkdir(outDir, { recursive: true });

  const label = (s: string) => s.padEnd(14);

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
      tools:    defaultFixtureTools(),
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
        tools:    defaultFixtureTools(),
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

async function runReplay(flags: Record<string, string | boolean>): Promise<void> {
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

  for (const event of summary.events) {
    console.log(`  ${String(event.index).padStart(2)}  ${event.type.padEnd(14)}  ${event.summary}`);
  }

  console.log();
  console.log(label("Status:"), summary.status);
  if (summary.result !== undefined)        console.log(label("Result:"),  summary.result);
  if (summary.failureReason !== undefined) console.log(label("Reason:"),  summary.failureReason);
}

// ---------------------------------------------------------------------------
// fork
// ---------------------------------------------------------------------------

const DEMO_FORK_INDEX     = 4;
const DEMO_MUTATION_STEP  = 3;
const DEMO_SEARCH_MUTATION: JsonValue = {
  results:   [],
  available: false,
  message:   "No hotels available for that date.",
};
const DEMO_FORK_ANSWER =
  "No hotels available for Alice this weekend. The area is fully booked — consider a different date.";

async function runFork(flags: Record<string, string | boolean>): Promise<void> {
  const tracePath = str(flags["trace"], "traces/example-trace.json");
  const mode      = str(flags["mode"],  "tool-result");

  if (!["prompt", "tool-result"].includes(mode)) {
    die(`--mode must be prompt or tool-result; got "${mode}"`);
  }

  const forkIndex = parseIntFlag(flags, "fork-index", DEMO_FORK_INDEX);

  const parentTrace = await loadTrace(tracePath);
  validateTrace(parentTrace);

  const outPath = str(flags["out"], join("traces", `${parentTrace.id}-fork.json`));

  let childTrace: Awaited<ReturnType<typeof forkRun>>["childTrace"];
  let finalAnswer: string;
  let prefixLength: number;

  if (mode === "tool-result") {
    const mutationStep = parseIntFlag(flags, "mutation-step", DEMO_MUTATION_STEP);

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
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: DEMO_FORK_ANSWER },
      ]),
      tools: defaultFixtureTools(),
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
      model: new FakeDeterministicModelClient([
        { type: "final_answer", text: "Prompt-mode fork complete." },
      ]),
      tools: defaultFixtureTools(),
    });
    childTrace   = result.childTrace;
    finalAnswer  = result.finalAnswer;
    prefixLength = result.prefixLength;
  }

  validateTrace(childTrace);
  await mkdir(dirname(outPath) || ".", { recursive: true });
  await saveTrace(childTrace, outPath);

  const diff      = diffTraces(parentTrace, childTrace);
  const formatted = formatFirstDivergence(diff);

  const label = (s: string) => s.padEnd(14);

  console.log("[blackbox] --- fork ---");
  console.log(label("Parent:"),      tracePath);
  console.log(label("Mode:"),        mode);
  console.log(label("Fork index:"),  forkIndex);
  console.log(label("Prefix len:"),  `${prefixLength} step(s)`);
  console.log(label("Child:"),       outPath);
  console.log(label("Result:"),      finalAnswer);
  console.log(label("Validation:"),  "passed");
  console.log();
  console.log(formatted);
}

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

async function runDiff(flags: Record<string, string | boolean>): Promise<void> {
  const parentPath = flags["parent"];
  const childPath  = flags["child"];

  if (!parentPath || parentPath === true) die("Missing required flag: --parent");
  if (!childPath  || childPath  === true) die("Missing required flag: --child");

  const parentTrace = await loadTrace(parentPath as string);
  const childTrace  = await loadTrace(childPath  as string);
  validateTrace(parentTrace);
  validateTrace(childTrace);

  const diff = diffTraces(parentTrace, childTrace);
  console.log(formatFirstDivergence(diff));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const argv = process.argv as string[];
const [,, subcommand, ...rest] = argv;
const flags = parseArgs(rest ?? []);

try {
  switch (subcommand) {
    case "record": await runRecord(flags); break;
    case "replay": await runReplay(flags); break;
    case "fork":   await runFork(flags);   break;
    case "diff":   await runDiff(flags);   break;
    default:
      if (subcommand) {
        console.error(
          `[blackbox error] Unknown subcommand: "${subcommand}". Valid: record, replay, fork, diff`,
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
