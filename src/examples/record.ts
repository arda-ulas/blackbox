// example:record — run a scripted multi-step agent and save the trace to disk.
//
// npm run example:record
//
// Output: traces/example-trace.json (relative to project root)

import { mkdir } from "node:fs/promises";
import { TraceRecorder } from "../trace/TraceRecorder.ts";
import { FakeDeterministicModelClient } from "../agent/modelClient.ts";
import { defaultFixtureTools } from "../agent/fixtureTools.ts";
import { runAgentLoop } from "../agent/agentLoop.ts";
import { saveTrace, validateTrace } from "../replay/CassetteReplay.ts";

// Derive the stable output path relative to this file.
// import.meta.url = file:///…/src/examples/record.ts
// ../../traces/ = <project-root>/traces/
const TRACES_DIR = new URL("../../traces/", import.meta.url).pathname;
const TRACE_PATH = new URL("../../traces/example-trace.json", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Scripted run: search → calendar → booking → final answer
// Three tool calls give a representative multi-step trace.
// ---------------------------------------------------------------------------

const model = new FakeDeterministicModelClient([
  { type: "tool_call", toolName: "search",   toolInput: { query: "weekend hotels" } },
  { type: "tool_call", toolName: "calendar", toolInput: { date: "2024-03-15" } },
  { type: "tool_call", toolName: "booking",  toolInput: { date: "2024-03-15", time: "14:00", name: "Alice" } },
  { type: "final_answer", text: "Hotel booked for Alice on 2024-03-15 at 14:00." },
]);

const recorder = new TraceRecorder("example-run-001", { createdAt: Date.now() });

console.log("[blackbox] Recording agent run...\n");

const result = await runAgentLoop({
  model,
  tools: defaultFixtureTools(),
  recorder,
  prompt: "Book a hotel for Alice this weekend.",
  maxSteps: 10,
});

// Validate hash-chain integrity before writing.
validateTrace(result.trace);

// Persist the trace.
await mkdir(TRACES_DIR, { recursive: true });
await saveTrace(result.trace, TRACE_PATH);

const label = (s: string) => s.padEnd(14);
console.log(label("Trace ID:"),   result.trace.id);
console.log(label("Output:"),     TRACE_PATH);
console.log(label("Steps:"),      result.trace.steps.length);
console.log(label("Validation:"), "passed");
console.log(label("Status:"),     "success");
console.log(label("Result:"),     result.finalAnswer);
