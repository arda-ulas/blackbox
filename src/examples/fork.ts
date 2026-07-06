// example:fork — load a parent trace, inject a different tool result at the
// search step, continue locally with the fake deterministic model, save the
// child trace, and print the first divergence.
//
// Run example:record first to create traces/example-trace.json, then:
//   npm run example:fork
//
// Demo question: "What if the hotel search had returned no availability?"
// We mutate step 3 (search tool_result) and fork at step 4 (the next
// model_input). Steps 0–2 are copied verbatim; step 3 gets a new hash.

import { mkdir } from "node:fs/promises";
import { loadTrace, saveTrace, validateTrace } from "../replay/CassetteReplay.ts";
import { FakeDeterministicModelClient } from "../agent/modelClient.ts";
import { defaultToolExecutor } from "../agent/fixtureTools.ts";
import { forkRun } from "../fork/forkRun.ts";
import { diffTraces, formatFirstDivergence } from "../fork/diffTraces.ts";

const PARENT_PATH = new URL("../../traces/example-trace.json", import.meta.url).pathname;
const FORK_PATH   = new URL("../../traces/example-trace-fork.json", import.meta.url).pathname;
const TRACES_DIR  = new URL("../../traces/", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Parent trace step layout (15 steps, search → calendar → booking):
//   0  model_input   4  model_input   8  model_input   12  model_input
//   1  model_output  5  model_output  9  model_output  13  model_output
//   2  tool_call     6  tool_call    10  tool_call     14  metadata
//   3  tool_result   7  tool_result  11  tool_result
//
// Mutation: step 3 (search tool_result) → inject "no hotels available"
// Fork point: step 4 (second model_input — first step the agent sees with
//             the mutated search result in its message history)
// ---------------------------------------------------------------------------

const MUTATION_INDEX = 3;
const FORK_INDEX     = 4;

// The value injected as the search tool result.
const SEARCH_MUTATION = {
  results:   [],
  available: false,
  message:   "No hotels available for that date.",
};

// ---------------------------------------------------------------------------

const parentTrace = await loadTrace(PARENT_PATH);
validateTrace(parentTrace);

// Extract the original prompt from the first model_input payload.
const firstPayload = parentTrace.steps[0].payload as {
  messages?: Array<{ role: string; content: string }>;
};
const originalPrompt = firstPayload.messages?.[0]?.content ?? "(unknown)";

// Extract the original final answer from the metadata step.
const metaStep = parentTrace.steps.find((s) => s.type === "metadata");
const metaPayload = metaStep?.payload as { result?: string } | undefined;
const originalResult = metaPayload?.result ?? "(unknown)";

const label = (s: string) => s.padEnd(13);

console.log("[blackbox] Forking trace: tool-result mutation\n");

console.log("--- original run ---");
console.log(label("ID:"),     parentTrace.id);
console.log(label("Prompt:"), `"${originalPrompt}"`);
console.log(label("Tools:"),  "search → calendar → booking");
console.log(label("Result:"), originalResult);
console.log();

console.log("--- mutation ---");
console.log(label("Inject at:"),  `step ${MUTATION_INDEX}  (tool_result: search)`);
console.log(label("Value:"),      JSON.stringify(SEARCH_MUTATION));
console.log(label("Fork point:"), `step ${FORK_INDEX}  (model_input — agent sees mutated search result)`);
console.log();

// ---------------------------------------------------------------------------
// Fork: verbatim steps 0–2, mutated step 3, fresh run from step 4 onward.
// ---------------------------------------------------------------------------

const childId = `${parentTrace.id}-fork`;

const { childTrace, finalAnswer, prefixLength } = await forkRun({
  parentTrace,
  forkIndex:           FORK_INDEX,
  childId,
  promptMutation:      "(tool-result mutation — promptMutation unused)",
  toolResultMutations: { [MUTATION_INDEX]: SEARCH_MUTATION },
  model: new FakeDeterministicModelClient([
    {
      type: "final_answer",
      text: "No hotels available for Alice this weekend. The area is fully booked — consider a different date.",
    },
  ]),
  toolExecutor: defaultToolExecutor(),
});

// ---------------------------------------------------------------------------
// Validate child, persist, and diff.
// ---------------------------------------------------------------------------

validateTrace(childTrace);
await mkdir(TRACES_DIR, { recursive: true });
await saveTrace(childTrace, FORK_PATH);

const verbatimCount = MUTATION_INDEX; // steps 0..(MUTATION_INDEX-1)

console.log("--- prefix ---");
console.log(label("Verbatim:"),  `steps 0–${verbatimCount - 1}  (${verbatimCount} step(s), hashes identical to parent)`);
console.log(label("Mutated:"),   `step ${MUTATION_INDEX}  tool_result (search) → new hash`);
console.log(label("Prefix len:"), `${prefixLength} step(s) total`);
console.log();

console.log("--- child run ---");
console.log(label("ID:"),         childTrace.id);
console.log(label("Result:"),     finalAnswer);
console.log(label("Steps:"),      childTrace.steps.length);
console.log(label("Output:"),     FORK_PATH);
console.log(label("Validation:"), "passed");
console.log();

const diff      = diffTraces(parentTrace, childTrace);
const formatted = formatFirstDivergence(diff);
console.log(formatted);
