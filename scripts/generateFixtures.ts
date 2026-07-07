// Deterministic generator for the committed trace fixture corpus (W5-A).
//
// The corpus under fixtures/traces/ is a frozen, fake/offline regression
// baseline for the core loop (schema, hash chain, neutrality, replay, fork
// prefix identity, first divergence). This script (re)builds that corpus.
//
// It COMPOSES existing fake/offline functions — FakeDeterministicModelClient,
// defaultToolExecutor, runAgentLoop, forkRun — plus a local normalizeTrace
// helper that rebuilds each trace through a standard TraceRecorder with a fixed
// timestamp so the existing hash chain recomputes deterministically. It changes
// no runtime semantics and cannot make a real model/tool/network call by
// construction.
//
// Modes:
//   (default)   check   — regenerate in memory, compare to committed files,
//                         exit 1 on any drift, write NOTHING.
//   --write             — write the corpus to disk (deliberate updates only).

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TraceRecorder } from "../src/trace/TraceRecorder.ts";
import { FakeDeterministicModelClient } from "../src/agent/modelClient.ts";
import { defaultToolExecutor } from "../src/agent/fixtureTools.ts";
import { runAgentLoop } from "../src/agent/agentLoop.ts";
import { forkRun } from "../src/fork/forkRun.ts";
import type { JsonValue, Trace } from "../src/trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// Paths + constants
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
/** Absolute path to the committed corpus directory. */
export const FIXTURES_DIR = resolve(HERE, "..", "fixtures", "traces");

/** Fixed timestamp for every step and createdAt so output is byte-reproducible. */
export const FIXTURE_BASE_TIMESTAMP = 0;

/** The demo fork geometry (mirrors the CLI demo / self-check). */
const DEMO_PROMPT = "Book a hotel for Alice this weekend.";
const DEMO_FORK_INDEX = 4;
const DEMO_MUTATION_STEP = 3;
const DEMO_SEARCH_MUTATION: JsonValue = {
  results: [],
  available: false,
  message: "No hotels available for that date.",
};
const DEMO_FORK_ANSWER =
  "No hotels available for Alice this weekend. The area is fully booked — consider a different date.";

/** The stable first-divergence index of the committed fork pair. Frozen. */
export const FORK_FIRST_DIVERGENCE_INDEX = DEMO_MUTATION_STEP;

// ---------------------------------------------------------------------------
// Normalization — fixture tooling only (no runtime semantic change).
// ---------------------------------------------------------------------------

/**
 * Rebuild a trace through a fresh TraceRecorder, pinning every step timestamp
 * and createdAt to `base` so the hash chain recomputes deterministically.
 * Preserves the trace-level identity fields (id, parentId, forkedFromStepId).
 *
 * runAgentLoop / TraceRecorder stamp Date.now(), so raw recorded traces are not
 * byte-reproducible; this makes them so, using only existing primitives.
 */
export function normalizeTrace(trace: Trace, base: number = FIXTURE_BASE_TIMESTAMP): Trace {
  const recorder = new TraceRecorder(trace.id, {
    parentId: trace.parentId,
    forkedFromStepId: trace.forkedFromStepId,
    createdAt: base,
  });
  for (const step of trace.steps) {
    recorder.append(step.type, step.payload, base);
  }
  return recorder.getTrace();
}

// ---------------------------------------------------------------------------
// Corpus builders — all fake/offline, deterministic.
// ---------------------------------------------------------------------------

async function buildSuccessFinalAnswer(): Promise<Trace> {
  const recorder = new TraceRecorder("fixture-success-final-answer", {
    createdAt: FIXTURE_BASE_TIMESTAMP,
  });
  await runAgentLoop({
    model: new FakeDeterministicModelClient([
      { type: "final_answer", text: "The capital of France is Paris." },
    ]),
    toolExecutor: defaultToolExecutor(),
    recorder,
    prompt: "What is the capital of France?",
    maxSteps: 5,
  });
  return normalizeTrace(recorder.getTrace());
}

/** The demo tool-use success run (search → calendar → booking → final). */
async function buildToolUseSuccess(id: string): Promise<Trace> {
  const recorder = new TraceRecorder(id, { createdAt: FIXTURE_BASE_TIMESTAMP });
  await runAgentLoop({
    model: new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "search", toolInput: { query: "weekend hotels" } },
      { type: "tool_call", toolName: "calendar", toolInput: { date: "2024-03-15" } },
      { type: "tool_call", toolName: "booking", toolInput: { date: "2024-03-15", time: "14:00", name: "Alice" } },
      { type: "final_answer", text: "Hotel booked for Alice on 2024-03-15 at 14:00." },
    ]),
    toolExecutor: defaultToolExecutor(),
    recorder,
    prompt: DEMO_PROMPT,
    maxSteps: 10,
  });
  return normalizeTrace(recorder.getTrace());
}

/** Fork the (already normalized) parent with a tool-result mutation, then normalize the child. */
async function buildForkChild(normalizedParent: Trace): Promise<Trace> {
  const result = await forkRun({
    parentTrace: normalizedParent,
    forkIndex: DEMO_FORK_INDEX,
    childId: `${normalizedParent.id}-fork`,
    promptMutation: "(tool-result mutation — promptMutation unused)",
    toolResultMutations: { [DEMO_MUTATION_STEP]: DEMO_SEARCH_MUTATION },
    model: new FakeDeterministicModelClient([{ type: "final_answer", text: DEMO_FORK_ANSWER }]),
    toolExecutor: defaultToolExecutor(),
  });
  return normalizeTrace(result.childTrace);
}

async function buildErrorUnknownTool(): Promise<Trace> {
  const recorder = new TraceRecorder("fixture-error-unknown-tool", {
    createdAt: FIXTURE_BASE_TIMESTAMP,
  });
  try {
    await runAgentLoop({
      model: new FakeDeterministicModelClient([
        { type: "tool_call", toolName: "flights", toolInput: { destination: "Tokyo" } },
      ]),
      toolExecutor: defaultToolExecutor(),
      recorder,
      prompt: "Find the cheapest flight to Tokyo this weekend.",
      maxSteps: 5,
    });
  } catch {
    // Expected: the agent loop aborts when the model calls the unknown tool
    // "flights". The recorder still captured the terminal run_failed step.
  }
  return normalizeTrace(recorder.getTrace());
}

/**
 * Build the full corpus in memory as an ordered filename → Trace map.
 * Consumed by both the CLI entry (check/write) and tests/fixtures.test.ts.
 */
export async function buildCorpus(): Promise<Map<string, Trace>> {
  const forkParent = await buildToolUseSuccess("fixture-fork-parent");
  const forkChild = await buildForkChild(forkParent);

  const corpus = new Map<string, Trace>();
  corpus.set("success-final-answer.v2.json", await buildSuccessFinalAnswer());
  corpus.set("success-tool-use.v2.json", await buildToolUseSuccess("fixture-success-tool-use"));
  corpus.set("error-unknown-tool.v2.json", await buildErrorUnknownTool());
  corpus.set("fork-parent.v2.json", forkParent);
  corpus.set("fork-child.v2.json", forkChild);
  return corpus;
}

/** The canonical committed fixture filenames (sorted). */
export const FIXTURE_MANIFEST: readonly string[] = [
  "error-unknown-tool.v2.json",
  "fork-child.v2.json",
  "fork-parent.v2.json",
  "success-final-answer.v2.json",
  "success-tool-use.v2.json",
];

/** Serialize a trace exactly as saveTrace would (pretty JSON), for byte comparison. */
export function serializeFixture(trace: Trace): string {
  return JSON.stringify(trace, null, 2);
}

// ---------------------------------------------------------------------------
// CLI entry — check by default; --write to persist.
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  const write = argv.includes("--write");
  const corpus = await buildCorpus();

  if (write) {
    await mkdir(FIXTURES_DIR, { recursive: true });
    for (const [name, trace] of corpus) {
      await writeFile(join(FIXTURES_DIR, name), serializeFixture(trace), "utf8");
    }
    console.log(`[fixtures] wrote ${corpus.size} fixture(s) to ${FIXTURES_DIR}`);
    return;
  }

  // Check mode: compare the in-memory corpus to the committed files.
  const drift: string[] = [];

  let existing: string[] = [];
  try {
    existing = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    drift.push(`fixtures directory not found: ${FIXTURES_DIR}`);
  }

  const expected = [...corpus.keys()].sort();
  if (existing.length > 0 || drift.length === 0) {
    const extra = existing.filter((f) => !expected.includes(f));
    const missing = expected.filter((f) => !existing.includes(f));
    for (const f of missing) drift.push(`missing committed fixture: ${f}`);
    for (const f of extra) drift.push(`unexpected committed fixture: ${f}`);
  }

  for (const [name, trace] of corpus) {
    let onDisk: string;
    try {
      onDisk = await readFile(join(FIXTURES_DIR, name), "utf8");
    } catch {
      continue; // already reported as missing above
    }
    if (onDisk !== serializeFixture(trace)) {
      drift.push(`content drift: ${name} differs from the generated fixture`);
    }
  }

  if (drift.length > 0) {
    console.error("[fixtures] corpus is OUT OF SYNC with the generator:");
    for (const d of drift) console.error(`  - ${d}`);
    console.error(
      "\nIf this change is deliberate, regenerate with `npm run fixtures:generate -- --write` " +
        "and update the frozen hashes in tests/fixtures.test.ts (see docs/20_week_five_a_plan.md §7).",
    );
    process.exit(1);
  }

  console.log(`[fixtures] corpus in sync (${corpus.size} fixture(s) match).`);
}

const isMain =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`[fixtures] error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
