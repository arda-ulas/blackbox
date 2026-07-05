// example:replay — load a saved cassette and replay it fully offline.
//
// npm run example:replay   (run example:record first)
//
// Does not instantiate or call FakeDeterministicModelClient or fixture tools.
// All behavior is derived from the recorded steps in the cassette file.

import { loadTrace, validateTrace, replayTrace } from "../replay/CassetteReplay.ts";

const TRACE_PATH = new URL("../../traces/example-trace.json", import.meta.url).pathname;

console.log("[blackbox] Loading cassette...\n");

const trace = await loadTrace(TRACE_PATH);

// Verify hash-chain integrity before replaying.
validateTrace(trace);

const summary = replayTrace(trace);

const label = (s: string) => s.padEnd(14);
console.log(label("Path:"),       TRACE_PATH);
console.log(label("Validation:"), "passed");
console.log(label("Trace ID:"),   summary.traceId);
console.log(label("Steps:"),      summary.stepCount);

console.log("\n--- replay events ---");
for (const event of summary.events) {
  const idx   = String(event.index).padStart(3);
  const type  = event.type.padEnd(14);
  console.log(`${idx}  ${type}  ${event.summary}`);
}

console.log();
console.log(label("Status:"), summary.status);
if (summary.result !== undefined) {
  console.log(label("Result:"), summary.result);
}
if (summary.failureReason !== undefined) {
  console.log(label("Failure:"), summary.failureReason);
}
