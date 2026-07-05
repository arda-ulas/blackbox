// example:record — run scripted agent demos and save the traces to disk.
//
// npm run example:record
//
// Outputs:
//   traces/example-trace.json       — success path (search → calendar → booking)
//   traces/example-error-trace.json — error path (model calls unknown tool "flights")

import { mkdir } from "node:fs/promises";
import { TraceRecorder } from "../trace/TraceRecorder.ts";
import { FakeDeterministicModelClient } from "../agent/modelClient.ts";
import { defaultFixtureTools } from "../agent/fixtureTools.ts";
import { runAgentLoop } from "../agent/agentLoop.ts";
import { saveTrace, validateTrace } from "../replay/CassetteReplay.ts";

const TRACES_DIR       = new URL("../../traces/", import.meta.url).pathname;
const TRACE_PATH       = new URL("../../traces/example-trace.json", import.meta.url).pathname;
const ERROR_TRACE_PATH = new URL("../../traces/example-error-trace.json", import.meta.url).pathname;

await mkdir(TRACES_DIR, { recursive: true });

const label = (s: string) => s.padEnd(14);

// ---------------------------------------------------------------------------
// Demo 1: success path — search → calendar → booking → final answer
// ---------------------------------------------------------------------------

const SUCCESS_SCENARIO = "Book a hotel for Alice this weekend.";

const successModel = new FakeDeterministicModelClient([
  { type: "tool_call", toolName: "search",   toolInput: { query: "weekend hotels" } },
  { type: "tool_call", toolName: "calendar", toolInput: { date: "2024-03-15" } },
  { type: "tool_call", toolName: "booking",  toolInput: { date: "2024-03-15", time: "14:00", name: "Alice" } },
  { type: "final_answer", text: "Hotel booked for Alice on 2024-03-15 at 14:00." },
]);

const successRecorder = new TraceRecorder("example-run-001", { createdAt: Date.now() });

console.log("[blackbox] Recording agent run demos...\n");
console.log("--- success trace ---");
console.log(label("Scenario:"),  SUCCESS_SCENARIO);
console.log(label("Tools:"),     "search → calendar → booking");

const successResult = await runAgentLoop({
  model:    successModel,
  tools:    defaultFixtureTools(),
  recorder: successRecorder,
  prompt:   SUCCESS_SCENARIO,
  maxSteps: 10,
});

validateTrace(successResult.trace);
await saveTrace(successResult.trace, TRACE_PATH);

console.log(label("Trace ID:"),   successResult.trace.id);
console.log(label("Output:"),     TRACE_PATH);
console.log(label("Steps:"),      successResult.trace.steps.length);
console.log(label("Validation:"), "passed");
console.log(label("Status:"),     "success");
console.log(label("Result:"),     successResult.finalAnswer);

// ---------------------------------------------------------------------------
// Demo 2: error path — model hallucinates "flights" tool, which doesn't exist.
// Demonstrates the unknown_tool failure recorded in the trace metadata.
// ---------------------------------------------------------------------------

const ERROR_SCENARIO = "Find the cheapest flight to Tokyo this weekend.";

const errorModel = new FakeDeterministicModelClient([
  { type: "tool_call", toolName: "flights", toolInput: { destination: "Tokyo" } },
]);

const errorRecorder = new TraceRecorder("example-error-run", { createdAt: Date.now() });

try {
  await runAgentLoop({
    model:    errorModel,
    tools:    defaultFixtureTools(),
    recorder: errorRecorder,
    prompt:   ERROR_SCENARIO,
    maxSteps: 5,
  });
} catch {
  // Expected: agent loop aborts when the model calls unknown tool "flights".
}

const errorTrace = errorRecorder.getTrace();
validateTrace(errorTrace);
await saveTrace(errorTrace, ERROR_TRACE_PATH);

const errorMeta    = errorTrace.steps.at(-1);
const errorPayload = errorMeta?.payload as { reason?: string; toolName?: string } | undefined;

console.log("\n--- error trace ---");
console.log(label("Scenario:"),   ERROR_SCENARIO);
console.log(label("Failure:"),    `unknown tool: "flights"`);
console.log(label("Trace ID:"),   errorTrace.id);
console.log(label("Output:"),     ERROR_TRACE_PATH);
console.log(label("Steps:"),      errorTrace.steps.length);
console.log(label("Validation:"), "passed");
console.log(label("Status:"),     "error");
console.log(label("Reason:"),     errorPayload?.reason ?? "unknown_tool");
