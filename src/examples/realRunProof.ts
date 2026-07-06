// W4-C3 real-provider proof: record → offline replay.
//
// Requires ANTHROPIC_API_KEY. Not in npm test. Run with:
//   npm run example:real-proof
//
// Phase 1: runs one minimal prompt against the real Anthropic API and saves the
// trace to disk. No tool calls are made — final-text-only keeps the proof narrow.
//
// Phase 2: loads and replays that trace fully offline. No model or tool calls are
// made during replay; replayTrace() accepts only a Trace (structurally offline).
//
// The API key is never printed or stored in the trace. Raw SDK objects are
// normalized to ModelCallError before they reach the agent loop or trace payload.

import { mkdir } from "node:fs/promises";
import { AnthropicModelClient } from "../agent/anthropicModelClient.ts";
import { TraceRecorder } from "../trace/TraceRecorder.ts";
import { runAgentLoop } from "../agent/agentLoop.ts";
import { saveTrace, loadTrace, validateTrace, replayTrace } from "../replay/CassetteReplay.ts";
import type { ToolExecutor } from "../agent/modelClient.ts";
import type { JsonValue } from "../trace/TraceTypes.ts";

const TRACES_DIR = new URL("../../traces/", import.meta.url).pathname;
const TRACE_PATH = new URL("../../traces/anthropic-proof-trace.json", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Guard: fail fast if no key — before creating any file.
// ---------------------------------------------------------------------------

const apiKey = process.env["ANTHROPIC_API_KEY"];
if (!apiKey) {
  console.error("[blackbox] ANTHROPIC_API_KEY is not set.");
  console.error("[blackbox] Export it in your shell and re-run.");
  console.error("[blackbox] No trace written.");
  process.exit(1);
}

const label = (s: string) => s.padEnd(16);

// ---------------------------------------------------------------------------
// No-tool executor — proof uses a final-text-only prompt.
// Tool-use proof is explicitly out of scope for W4-C3; deferred until
// structured transcript migration (Path B in docs/13_adapter_contract.md).
// ---------------------------------------------------------------------------

const noTools: ToolExecutor = {
  definitions: () => [],
  execute: async (_name: string, _input: JsonValue): Promise<JsonValue> => {
    throw new Error("no tools configured for this proof");
  },
};

// ---------------------------------------------------------------------------
// Phase 1: record — real Anthropic API
// ---------------------------------------------------------------------------

console.log("[blackbox] W4-C3 — real-provider record → offline replay proof\n");
console.log("--- phase 1: record (real Anthropic API) ---");

await mkdir(TRACES_DIR, { recursive: true });

const model = new AnthropicModelClient({ apiKey });
const recorder = new TraceRecorder("anthropic-proof-001", { createdAt: Date.now() });
const prompt = "Reply with exactly one sentence confirming you received this message.";

let finalAnswer: string;
try {
  const result = await runAgentLoop({
    model,
    toolExecutor: noTools,
    recorder,
    prompt,
    maxSteps: 3,
  });
  finalAnswer = result.finalAnswer;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n[blackbox] Record phase failed: ${msg}`);
  console.error("[blackbox] No trace written.");
  process.exit(1);
}

const recorded = recorder.getTrace();
validateTrace(recorded);
await saveTrace(recorded, TRACE_PATH);

console.log(label("Provider:"), "Anthropic (real)");
console.log(label("Model:"), "claude-haiku-4-5-20251001");
console.log(label("Steps:"), recorded.steps.length);
console.log(label("Trace path:"), TRACE_PATH);
console.log(label("Validation:"), "passed");
console.log(label("Answer:"), finalAnswer);

// ---------------------------------------------------------------------------
// Phase 2: replay — fully offline
// ---------------------------------------------------------------------------

console.log("\n--- phase 2: replay (offline — no provider calls) ---");

const loaded = await loadTrace(TRACE_PATH);
validateTrace(loaded);
const summary = replayTrace(loaded);

console.log(label("Provider:"), "none (offline)");
console.log(label("Trace path:"), TRACE_PATH);
console.log(label("Trace ID:"), summary.traceId);
console.log(label("Steps:"), summary.stepCount);

console.log("\n--- replay events ---");
for (const event of summary.events) {
  const idx = String(event.index).padStart(3);
  const type = event.type.padEnd(14);
  console.log(`${idx}  ${type}  ${event.summary}`);
}

// ---------------------------------------------------------------------------
// Final verdict
// ---------------------------------------------------------------------------

const ok = summary.status === "success";
console.log(`\n[blackbox] ${ok ? "PASS" : "FAIL"} — record → offline replay`);
console.log(label("Status:"), summary.status);
if (summary.result !== undefined) {
  console.log(label("Result:"), summary.result);
}
if (!ok) process.exit(1);
