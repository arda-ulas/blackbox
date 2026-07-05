// example:fork — load a parent trace, fork at a chosen step with a mutated
// prompt, continue locally with the fake deterministic model, save the child
// trace, and print the first divergence.
//
// Run example:record first to create traces/example-trace.json, then:
//   npm run example:fork

import { mkdir } from "node:fs/promises";
import { loadTrace, saveTrace, validateTrace } from "../replay/CassetteReplay.ts";
import { FakeDeterministicModelClient } from "../agent/modelClient.ts";
import { defaultFixtureTools } from "../agent/fixtureTools.ts";
import { forkRun } from "../fork/forkRun.ts";
import { diffTraces, formatFirstDivergence } from "../fork/diffTraces.ts";

const PARENT_PATH = new URL("../../traces/example-trace.json", import.meta.url).pathname;
const FORK_PATH   = new URL("../../traces/example-trace-fork.json", import.meta.url).pathname;
const TRACES_DIR  = new URL("../../traces/", import.meta.url).pathname;

// Fork at index 8: the third model_input, after search + calendar tool calls
// but before booking. Steps 0-7 are copied verbatim (identical hashes).
// The mutated prompt steers the child toward a different outcome.
const FORK_INDEX      = 8;
const PROMPT_MUTATION = "Actually, skip the hotel — find available train tickets instead.";

// ---------------------------------------------------------------------------

console.log("[blackbox] Loading parent trace...\n");

const parentTrace = await loadTrace(PARENT_PATH);
validateTrace(parentTrace);

const label = (s: string) => s.padEnd(20);
console.log(label("Parent trace ID:"),  parentTrace.id);
console.log(label("Parent steps:"),     parentTrace.steps.length);
console.log(label("Fork at index:"),    FORK_INDEX);
console.log(label("Mutated prompt:"),   `"${PROMPT_MUTATION}"`);
console.log();

// ---------------------------------------------------------------------------
// Fork: copy prefix [0, FORK_INDEX) verbatim then run with mutated prompt.
// ---------------------------------------------------------------------------

const childId = `${parentTrace.id}-fork`;

const { childTrace, finalAnswer, prefixLength } = await forkRun({
  parentTrace,
  forkIndex:       FORK_INDEX,
  childId,
  promptMutation:  PROMPT_MUTATION,
  model: new FakeDeterministicModelClient([
    { type: "final_answer", text: "Trains fully booked on that date. No alternative found." },
  ]),
  tools: defaultFixtureTools(),
});

// ---------------------------------------------------------------------------
// Validate child, persist, and diff.
// ---------------------------------------------------------------------------

validateTrace(childTrace);
await mkdir(TRACES_DIR, { recursive: true });
await saveTrace(childTrace, FORK_PATH);

const diff      = diffTraces(parentTrace, childTrace);
const formatted = formatFirstDivergence(diff);

console.log(label("Child trace ID:"),   childTrace.id);
console.log(label("Prefix copied:"),    `${prefixLength} step(s)`);
console.log(label("Child steps:"),      childTrace.steps.length);
console.log(label("Child result:"),     finalAnswer);
console.log(label("Child output:"),     FORK_PATH);
console.log(label("Child validation:"), "passed");
console.log();
console.log(formatted);
