// W4-E slice E1 — real-provider tool-use proof (GO / NO-GO GATE).
//
// Requires ANTHROPIC_API_KEY. Opt-in only; NOT in npm test; NO CLI wiring.
//   npm run example:real-tooluse-proof
//
// THE ONE QUESTION THIS ANSWERS:
// Does the live Anthropic Messages API accept Blackbox's synthetic, provider-
// neutral toolCallId ("call-0") as the request-local tool_use.id and matching
// tool_result.tool_use_id in a structured v2 transcript?
//
// How it tests that with a single record:
//   turn 1 — the model returns a tool_use; the adapter DISCARDS the provider's
//            toolu_… id and the loop assigns "call-0".
//   turn 2 — the reconstructed history is sent back with "call-0" as the
//            tool_use.id and tool_result.tool_use_id. If the API accepts turn 2
//            (the run continues to a final answer), the assumption PASSES.
//
// Instrumentation: a thin capturing wrapper around the REAL Anthropic client
// records the request params in memory so we can assert the on-wire ids were
// "call-0". Nothing provider-native is ever written to the trace.
//
// Scope: E1 only. No fork / mutate / continue / diff (E2/E3). A minimal offline
// replay of the saved parent is included because it is trivial and reinforces
// the offline + neutrality guarantees.

import { mkdir } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import {
  AnthropicModelClient,
  type AnthropicLikeClient,
} from "../agent/anthropicModelClient.ts";
import { TraceRecorder } from "../trace/TraceRecorder.ts";
import { runAgentLoop } from "../agent/agentLoop.ts";
import { defaultToolExecutor } from "../agent/fixtureTools.ts";
import { saveTrace, loadTrace, validateTrace, replayTrace } from "../replay/CassetteReplay.ts";
import { CURRENT_TRACE_VERSION } from "../trace/TraceTypes.ts";
import { auditNeutrality, collectToolBlockIds } from "./toolUseProofHelpers.ts";

const TRACES_DIR = new URL("../../traces/", import.meta.url).pathname;
const TRACE_PATH = new URL("../../traces/anthropic-tooluse-parent.json", import.meta.url).pathname;
const MODEL = "claude-haiku-4-5-20251001";

const label = (s: string) => s.padEnd(18);

function fail(message: string): never {
  console.error(`\n[blackbox] ${message}`);
  console.error("[blackbox] No trace written.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Guard: fail fast if no key — before constructing any client or file.
// ---------------------------------------------------------------------------

const apiKey = process.env["ANTHROPIC_API_KEY"];
if (!apiKey) {
  console.error("[blackbox] ANTHROPIC_API_KEY is not set.");
  console.error("[blackbox] Export it in your shell and re-run.");
  console.error("[blackbox] No trace written.");
  process.exit(1);
}

console.log("[blackbox] W4-E E1 — real tool-use proof (synthetic toolCallId gate)\n");

// ---------------------------------------------------------------------------
// Capturing wrapper around the REAL Anthropic client.
// Delegates every call to the live API; records request params in memory only.
// ---------------------------------------------------------------------------

const realClient = new Anthropic({ apiKey });
const capturedRequests: unknown[] = [];
const capturingClient: AnthropicLikeClient = {
  messages: {
    async create(params: unknown): Promise<unknown> {
      capturedRequests.push(params);
      return realClient.messages.create(params as Parameters<typeof realClient.messages.create>[0]);
    },
  },
};

// ---------------------------------------------------------------------------
// Phase 1: record ONE real tool-use run (search → final answer).
// ---------------------------------------------------------------------------

console.log("--- phase 1: record (real Anthropic API, one tool round) ---");

await mkdir(TRACES_DIR, { recursive: true });

const model = new AnthropicModelClient({ client: capturingClient, model: MODEL });
const recorder = new TraceRecorder("anthropic-tooluse-parent-001", { createdAt: Date.now() });
const prompt =
  "Use the `search` tool exactly once to look up weekend hotels in Paris, then " +
  "reply with a single short sentence summarizing what you found. " +
  "Do not call any other tool.";

let finalAnswer: string;
try {
  const result = await runAgentLoop({
    model,
    toolExecutor: defaultToolExecutor(),
    recorder,
    prompt,
    maxSteps: 6,
  });
  finalAnswer = result.finalAnswer;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  // A synthetic-id rejection surfaces here as a normalized ModelCallError.
  fail(`Record phase failed (possible synthetic-id rejection): ${msg}`);
}

// ---------------------------------------------------------------------------
// Gate assertions — all must hold before we write anything.
// ---------------------------------------------------------------------------

const trace = recorder.getTrace();

// (a) A real tool round must have happened, else the gate is inconclusive.
const toolCallSteps = trace.steps.filter((s) => s.type === "tool_call");
if (toolCallSteps.length === 0) {
  fail(
    "INCONCLUSIVE — the model returned a final answer without calling a tool, " +
      "so turn-2 synthetic-id acceptance was never exercised. Re-run.",
  );
}

// (b) The on-wire continuation request must have carried call-0 as BOTH
//     tool_use.id and tool_result.tool_use_id.
const { toolUseIds, toolResultIds } = collectToolBlockIds(capturedRequests);
if (!toolUseIds.includes("call-0")) {
  fail(`Gate failed — no request carried tool_use.id "call-0" (saw: ${JSON.stringify(toolUseIds)}).`);
}
if (!toolResultIds.includes("call-0")) {
  fail(
    `Gate failed — no request carried tool_result.tool_use_id "call-0" (saw: ${JSON.stringify(toolResultIds)}).`,
  );
}

// (c) The cassette must be v2 and carry call-0 in the neutral payloads.
if (trace.version !== CURRENT_TRACE_VERSION) {
  fail(`Gate failed — trace.version is ${trace.version}, expected ${CURRENT_TRACE_VERSION}.`);
}
validateTrace(trace);
const call0InPayloads = trace.steps.some(
  (s) =>
    (s.type === "tool_call" || s.type === "tool_result" || s.type === "model_output") &&
    (s.payload as { toolCallId?: unknown }).toolCallId === "call-0",
);
if (!call0InPayloads) {
  fail('Gate failed — no model_output/tool_call/tool_result payload carries toolCallId "call-0".');
}

// (d) Neutrality — no provider-native data may be in the serialized cassette.
const audit = auditNeutrality(JSON.stringify(trace), apiKey);
if (!audit.ok) {
  fail(`Neutrality violation — forbidden markers in trace: ${audit.found.join(", ")}.`);
}

// ---------------------------------------------------------------------------
// All gates passed — persist the parent cassette.
// ---------------------------------------------------------------------------

await saveTrace(trace, TRACE_PATH);

console.log(label("Provider:"), "Anthropic (real)");
console.log(label("Model:"), MODEL);
console.log(label("Requests sent:"), capturedRequests.length);
console.log(label("Tool rounds:"), toolCallSteps.length);
console.log(label("Turn-2 ids:"), 'tool_use.id="call-0"  tool_result.tool_use_id="call-0"');
console.log(label("Trace version:"), trace.version);
console.log(label("Steps:"), trace.steps.length);
console.log(label("Neutrality:"), "clean (no provider-native data)");
console.log(label("Trace path:"), TRACE_PATH);
console.log(label("Answer:"), finalAnswer);

// ---------------------------------------------------------------------------
// Minimal offline replay of the saved parent (no provider calls).
// ---------------------------------------------------------------------------

console.log("\n--- phase 2: offline replay (no provider calls) ---");

const loaded = await loadTrace(TRACE_PATH);
validateTrace(loaded);
const summary = replayTrace(loaded);

console.log(label("Provider:"), "none (offline)");
console.log(label("Trace ID:"), summary.traceId);
console.log(label("Steps:"), summary.stepCount);
console.log(label("Status:"), summary.status);

const ok = summary.status === "success";
console.log(`\n[blackbox] ${ok ? "PASS" : "FAIL"} — real Anthropic accepted synthetic toolCallId "call-0"`);
console.log("[blackbox] E1 gate complete; W4-E E2/E3 fork-continuation proof is covered by example:real-fork-proof.");
if (!ok) process.exit(1);
