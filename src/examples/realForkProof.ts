// W4-E slices E2/E3 — real fork-continuation proof.
//
// Requires ANTHROPIC_API_KEY. Opt-in only; NOT in npm test; NO CLI wiring.
//   npm run example:real-fork-proof
//
// THE QUESTION THIS ANSWERS:
// Can a FRESH AnthropicModelClient (no pending adapter memory) continue from a
// MUTATED structured v2 fork point using only cassette data and neutral
// toolCallId correlation — and does the real API accept that request?
//
// Loop proven here (the active-debugging value proposition):
//   load parent cassette → offline replay → fork at tool_result → mutate result
//   → continue with a fresh AnthropicModelClient → diff parent/child.
//
// E1 (example:real-tooluse-proof) already proved the real API accepts synthetic
// "call-0" as tool_use.id / tool_result.tool_use_id. E2/E3 build the full loop on
// top of that, with the continuation request assembled purely from cassette data
// by a fresh, stateless adapter.
//
// Scope: proof script only. No product-runtime change. Nothing provider-native
// is ever written to a trace. The child is saved ONLY after every gate passes.

import { mkdir } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import {
  AnthropicModelClient,
  type AnthropicLikeClient,
} from "../agent/anthropicModelClient.ts";
import { TraceRecorder } from "../trace/TraceRecorder.ts";
import { runAgentLoop } from "../agent/agentLoop.ts";
import { defaultToolExecutor } from "../agent/fixtureTools.ts";
import { forkRun } from "../fork/forkRun.ts";
import { diffTraces } from "../fork/diffTraces.ts";
import { saveTrace, loadTrace, validateTrace, replayTrace } from "../replay/CassetteReplay.ts";
import { CURRENT_TRACE_VERSION, type JsonValue, type Trace } from "../trace/TraceTypes.ts";
import { auditNeutrality, collectToolBlockIds } from "./toolUseProofHelpers.ts";

const TRACES_DIR = new URL("../../traces/", import.meta.url).pathname;
const PARENT_PATH = new URL("../../traces/anthropic-tooluse-parent.json", import.meta.url).pathname;
const FORK_PATH = new URL("../../traces/anthropic-tooluse-fork.json", import.meta.url).pathname;
const MODEL = "claude-haiku-4-5-20251001";

// The injected no-availability result — meaningfully different from the fixture
// search result, so the mutated tool_result is guaranteed a new hash.
const MUTATION: JsonValue = {
  results: [],
  available: false,
  message: "No hotels available for that date.",
};

const label = (s: string) => s.padEnd(20);

function fail(message: string): never {
  console.error(`\n[blackbox] ${message}`);
  console.error("[blackbox] No child trace written.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Guard: fail fast if no key — before constructing any client or file.
// ---------------------------------------------------------------------------

const apiKey = process.env["ANTHROPIC_API_KEY"];
if (!apiKey) {
  console.error("[blackbox] ANTHROPIC_API_KEY is not set.");
  console.error("[blackbox] Export it in your shell and re-run.");
  console.error("[blackbox] No child trace written.");
  process.exit(1);
}

console.log("[blackbox] W4-E E2/E3 — real fork-continuation proof\n");

// ---------------------------------------------------------------------------
// A fresh AnthropicModelClient wrapping the REAL client, capturing request
// params in memory only (never written to any trace).
// ---------------------------------------------------------------------------

function makeCapturingModel(): { model: AnthropicModelClient; captured: unknown[] } {
  const realClient = new Anthropic({ apiKey });
  const captured: unknown[] = [];
  const client: AnthropicLikeClient = {
    messages: {
      async create(params: unknown): Promise<unknown> {
        captured.push(params);
        return realClient.messages.create(
          params as Parameters<typeof realClient.messages.create>[0],
        );
      },
    },
  };
  return { model: new AnthropicModelClient({ client, model: MODEL }), captured };
}

// ---------------------------------------------------------------------------
// Record a fresh E1-style parent (only when the local parent is absent).
// ---------------------------------------------------------------------------

async function recordFreshParent(): Promise<Trace> {
  console.log("--- parent absent: recording a fresh E1-style parent (real API) ---");
  await mkdir(TRACES_DIR, { recursive: true });
  const { model } = makeCapturingModel();
  const recorder = new TraceRecorder("anthropic-tooluse-parent-001", { createdAt: Date.now() });
  const prompt =
    "Use the `search` tool exactly once to look up weekend hotels in Paris, then " +
    "reply with a single short sentence summarizing what you found. " +
    "Do not call any other tool.";
  try {
    await runAgentLoop({ model, toolExecutor: defaultToolExecutor(), recorder, prompt, maxSteps: 6 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`Parent record failed (possible synthetic-id rejection): ${msg}`);
  }
  const fresh = recorder.getTrace();
  if (!fresh.steps.some((s) => s.type === "tool_call")) {
    fail("Parent record inconclusive — the model did not call a tool. Re-run.");
  }
  validateTrace(fresh);
  const parentAudit = auditNeutrality(JSON.stringify(fresh), apiKey);
  if (!parentAudit.ok) fail(`Parent neutrality violation: ${parentAudit.found.join(", ")}.`);
  await saveTrace(fresh, PARENT_PATH);
  console.log(label("Recorded parent:"), PARENT_PATH);
  return fresh;
}

// ---------------------------------------------------------------------------
// Phase E2: obtain + replay the parent offline.
// ---------------------------------------------------------------------------

console.log("--- phase E2: parent load + offline replay ---");

let parentTrace: Trace;
let parentSource: "loaded" | "recorded";
try {
  parentTrace = await loadTrace(PARENT_PATH);
  parentSource = "loaded";
} catch {
  parentTrace = await recordFreshParent();
  parentSource = "recorded";
}

validateTrace(parentTrace);
if (parentTrace.version !== CURRENT_TRACE_VERSION) {
  fail(`Parent version is ${parentTrace.version}, expected ${CURRENT_TRACE_VERSION}.`);
}

const parentReplay = replayTrace(parentTrace);
if (parentReplay.status !== "success") {
  fail(`Parent offline replay status is "${parentReplay.status}", expected "success".`);
}

const parentAudit = auditNeutrality(JSON.stringify(parentTrace), apiKey);
if (!parentAudit.ok) fail(`Parent neutrality violation: ${parentAudit.found.join(", ")}.`);

console.log(label("Parent:"), `${parentSource} — ${PARENT_PATH}`);
console.log(label("Parent version:"), parentTrace.version);
console.log(label("Parent steps:"), parentTrace.steps.length);
console.log(label("Offline replay:"), parentReplay.status);
console.log(label("Neutrality:"), "clean");

// ---------------------------------------------------------------------------
// Fork geometry — located dynamically, never hardcoded.
// ---------------------------------------------------------------------------

const trIdx = parentTrace.steps.findIndex((s) => s.type === "tool_result");
if (trIdx < 0) fail("Parent has no tool_result step — cannot fork at a tool result.");

const forkIndex = trIdx + 1;
const forkStep = parentTrace.steps[forkIndex];
if (!forkStep || forkStep.type !== "model_input") {
  fail(
    `Unexpected parent shape — step ${forkIndex} is "${forkStep?.type ?? "missing"}", ` +
      `expected "model_input" (fork must be tool_result+1).`,
  );
}

// Defensive: the mutation must actually differ from the parent's result.
const parentResult = (parentTrace.steps[trIdx].payload as { result?: JsonValue }).result;
if (JSON.stringify(parentResult) === JSON.stringify(MUTATION)) {
  fail("Mutation value equals the parent's tool_result — no divergence would occur.");
}

console.log("\n--- phase E3: fork → mutate → continue (fresh adapter) → diff ---");
console.log(label("Mutation target:"), `step ${trIdx} (tool_result)`);
console.log(label("Fork index:"), `${forkIndex} (model_input)`);

// ---------------------------------------------------------------------------
// Phase E3: continue with a FRESH AnthropicModelClient (no pending state).
// ---------------------------------------------------------------------------

const { model: continuationModel, captured } = makeCapturingModel();

let childTrace: Trace;
try {
  const result = await forkRun({
    parentTrace,
    forkIndex,
    childId: `${parentTrace.id}-fork`,
    promptMutation: "(tool-result mutation — promptMutation unused)",
    toolResultMutations: { [trIdx]: MUTATION },
    model: continuationModel,
    toolExecutor: defaultToolExecutor(),
    maxSteps: 4,
  });
  childTrace = result.childTrace;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  fail(`Fork continuation failed (possible synthetic-id rejection): ${msg}`);
}

// (a) The continuation request must have carried call-0 correlation + the mutation.
const { toolUseIds, toolResultIds } = collectToolBlockIds(captured);
if (!toolUseIds.includes("call-0")) {
  fail(`Continuation request missing tool_use.id "call-0" (saw: ${JSON.stringify(toolUseIds)}).`);
}
if (!toolResultIds.includes("call-0")) {
  fail(
    `Continuation request missing tool_result.tool_use_id "call-0" (saw: ${JSON.stringify(toolResultIds)}).`,
  );
}
if (!JSON.stringify(captured).includes(MUTATION.message as string)) {
  fail("Continuation request did not carry the mutated tool_result content.");
}

// (b) Child integrity + version + neutrality (in memory, before any save).
validateTrace(childTrace);
if (childTrace.version !== CURRENT_TRACE_VERSION) {
  fail(`Child version is ${childTrace.version}, expected ${CURRENT_TRACE_VERSION}.`);
}
const childAudit = auditNeutrality(JSON.stringify(childTrace), apiKey);
if (!childAudit.ok) fail(`Child neutrality violation: ${childAudit.found.join(", ")}.`);

// (c) Diff: first divergence at the mutated tool_result; hash-identical prefix.
const diff = diffTraces(parentTrace, childTrace);
if (!diff.hasDivergence) fail("Diff reports no divergence — expected divergence at the mutation.");
if (diff.firstDivergenceIndex !== trIdx) {
  fail(`First divergence at index ${diff.firstDivergenceIndex}, expected ${trIdx}.`);
}
if (diff.sharedPrefixLength !== trIdx) {
  fail(`Shared prefix length is ${diff.sharedPrefixLength}, expected ${trIdx}.`);
}

// (d) Child must replay fully offline.
const childReplay = replayTrace(childTrace);
if (childReplay.status !== "success") {
  fail(`Child offline replay status is "${childReplay.status}", expected "success".`);
}

// ---------------------------------------------------------------------------
// All gates passed — persist the child cassette.
// ---------------------------------------------------------------------------

await saveTrace(childTrace, FORK_PATH);

console.log(label("Continuation ids:"), 'tool_use.id="call-0"  tool_result.tool_use_id="call-0"');
console.log(label("Mutated result:"), "carried into continuation request");
console.log(label("Child version:"), childTrace.version);
console.log(label("Child steps:"), childTrace.steps.length);
console.log(label("First divergence:"), `index ${diff.firstDivergenceIndex} (tool_result)`);
console.log(label("Shared prefix:"), `${diff.sharedPrefixLength} step(s), hash-identical`);
console.log(label("Child neutrality:"), "clean");
console.log(label("Child replay:"), childReplay.status);
console.log(label("Child path:"), FORK_PATH);

console.log(
  `\n[blackbox] PASS — fresh Anthropic adapter continued from a mutated v2 fork point ` +
    `using only cassette data.`,
);
console.log("[blackbox] Full live loop: record → replay → fork → mutate → continue → diff.");
