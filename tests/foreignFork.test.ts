// Fork foreign cassette proof (W11-A) — tests only, no source change.
//
// W10-A proved a foreign-origin cassette (adapted from a synthetic chat-style
// transcript) passes verify/replay/assert. These tests prove it is NOT
// second-class in the ACTIVE debugging loop either: the committed
// fixtures/external/chat-tool-use.converted.v2.json parent forks, mutates,
// continues, and diffs under the exact same Blackbox semantics as a native
// trace — using the UNCHANGED forkRun, ReactiveDemoModelClient, diffTraces,
// diffOutcome, verifyTrace, and CLI surfaces.
//
// Deliberately NOT frozen here: full child bytes, continuation hashes, and
// child timestamps (continuation steps are stamped at run time). What IS
// frozen: the parent's committed bytes, prefix hash identity against them, the
// structural divergence index, and the derivation of the child's answer from
// the injected mutation. Everything is offline, deterministic where asserted,
// zero live calls.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { forkRun } from "../src/fork/forkRun.ts";
import { diffTraces, formatDiffReport } from "../src/fork/diffTraces.ts";
import { diffOutcome } from "../src/fork/diffOutcome.ts";
import { loadTrace, validateTrace, replayTrace } from "../src/replay/CassetteReplay.ts";
import { verifyTrace } from "../src/trace/verifyTrace.ts";
import { auditTraceNeutrality } from "../src/trace/neutrality.ts";
import { toolCallSequence } from "../src/trace/traceOutcome.ts";
import { ReactiveDemoModelClient } from "../src/agent/reactiveDemoModel.ts";
import type { ToolDefinition, ToolExecutor } from "../src/agent/modelClient.ts";
import type { JsonValue, Trace } from "../src/trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// Paths + fixtures
// ---------------------------------------------------------------------------

const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const EXTERNAL_DIR = join(PROJECT_ROOT, "fixtures", "external");
const PARENT_PATH = join(EXTERNAL_DIR, "chat-tool-use.converted.v2.json");

/** Primary mutation: replace the get_weather result at step 3, fork at 4. */
const WEATHER_MUTATION: JsonValue = {
  city: "Paris",
  temperature_c: -2,
  condition: "Heavy snow",
};

/** Secondary mutation: replace the send_email result at step 7, fork at 8. */
const EMAIL_MUTATION: JsonValue = {
  status: "failed",
  reason: "smtp unavailable",
};

// ---------------------------------------------------------------------------
// Test-local foreign ToolExecutor
//
// definitions() are lifted (deep-cloned) from the parent's recorded step-0
// model_input payload, so the library-level continuation honestly records the
// FOREIGN tool definitions. execute() throws and counts: the reactive
// continuation model always returns final_answer, so no tool must ever run.
// ---------------------------------------------------------------------------

function makeForeignExecutor(parent: Trace): ToolExecutor & { calls: () => number } {
  const payload = parent.steps[0].payload as { tools?: ToolDefinition[] };
  const defs = structuredClone(payload.tools ?? []);
  let executeCalls = 0;
  return {
    definitions: () => structuredClone(defs),
    execute: async (name: string) => {
      executeCalls += 1;
      throw new Error(`foreign executor: execute("${name}") must never be called`);
    },
    calls: () => executeCalls,
  };
}

async function loadParent(): Promise<Trace> {
  return loadTrace(PARENT_PATH);
}

async function forkWeather(parent: Trace, payload: JsonValue = WEATHER_MUTATION) {
  return forkRun({
    parentTrace: parent,
    forkIndex: 4,
    childId: `${parent.id}-fork`,
    promptMutation: "(tool-result mutation — promptMutation unused)",
    toolResultMutations: { 3: payload },
    model: new ReactiveDemoModelClient(),
    toolExecutor: makeForeignExecutor(parent),
  });
}

// ---------------------------------------------------------------------------
// Library-level: primary geometry (mutate step 3, fork at 4)
// ---------------------------------------------------------------------------

describe("foreign cassette fork — primary geometry (mutate 3, fork 4)", () => {
  it("parent cassette loads, validates, and verifies before any fork", async () => {
    const parent = await loadParent();
    expect(() => validateTrace(parent)).not.toThrow();
    expect(verifyTrace(parent).pass).toBe(true);
  });

  it("forkRun does not mutate the parent trace", async () => {
    const parent = await loadParent();
    const snapshot = structuredClone(parent);
    await forkWeather(parent);
    expect(parent).toEqual(snapshot);
  });

  it("returns prefixLength 4 and never executes a tool", async () => {
    const parent = await loadParent();
    const executor = makeForeignExecutor(parent);
    const result = await forkRun({
      parentTrace: parent,
      forkIndex: 4,
      childId: `${parent.id}-fork`,
      promptMutation: "(unused)",
      toolResultMutations: { 3: WEATHER_MUTATION },
      model: new ReactiveDemoModelClient(),
      toolExecutor: executor,
    });
    expect(result.prefixLength).toBe(4);
    expect(executor.calls()).toBe(0);
  });

  it("child steps 0–2 are verbatim copies of the committed parent steps (full object equality)", async () => {
    const parent = await loadParent();
    const { childTrace } = await forkWeather(parent);
    for (let i = 0; i < 3; i += 1) {
      // Full step-object equality — id, index, type, timestamp, payload,
      // prevHash, and hash all verbatim — not just the hash chain fields.
      expect(childTrace.steps[i]).toEqual(parent.steps[i]);
      // Explicit hash identity kept as the headline invariant.
      expect(childTrace.steps[i].hash).toBe(parent.steps[i].hash);
    }
  });

  it("child step 3 is the mutated tool_result: same call id/tool/timestamp, new result, new hash, chained from step 2", async () => {
    const parent = await loadParent();
    const { childTrace } = await forkWeather(parent);
    const step = childTrace.steps[3];
    const payload = step.payload as {
      toolCallId?: string;
      toolName?: string;
      result?: JsonValue;
    };
    expect(step.type).toBe("tool_result");
    expect(payload.toolCallId).toBe("call-0");
    expect(payload.toolName).toBe("get_weather");
    expect(payload.result).toEqual(WEATHER_MUTATION);
    expect(step.timestamp).toBe(parent.steps[3].timestamp);
    expect(step.hash).not.toBe(parent.steps[3].hash);
    expect(step.prevHash).toBe(parent.steps[2].hash);
  });

  it("records fork lineage: parentId and forkedFromStepId", async () => {
    const parent = await loadParent();
    const { childTrace } = await forkWeather(parent);
    expect(childTrace.parentId).toBe(parent.id);
    expect(childTrace.forkedFromStepId).toBe(parent.steps[4].id);
  });

  it("the continuation model_input reconstructs the mutated structured history with the foreign tool definitions", async () => {
    const parent = await loadParent();
    const { childTrace } = await forkWeather(parent);
    const continuation = childTrace.steps[4];
    expect(continuation.type).toBe("model_input");
    const payload = continuation.payload as {
      messages: Array<{ role: string; content: unknown }>;
      tools: ToolDefinition[];
    };
    // Reconstructed history: user prompt + the call-0 tool round with the
    // MUTATED result injected.
    expect(payload.messages).toHaveLength(3);
    expect(payload.messages[0].role).toBe("user");
    const toolResultTurn = payload.messages[2].content as Array<{
      type: string;
      toolCallId: string;
      toolName: string;
      result: JsonValue;
    }>;
    expect(toolResultTurn[0].type).toBe("tool_result");
    expect(toolResultTurn[0].toolCallId).toBe("call-0");
    expect(toolResultTurn[0].toolName).toBe("get_weather");
    expect(toolResultTurn[0].result).toEqual(WEATHER_MUTATION);
    // The library-level continuation records the FOREIGN tool definitions,
    // lifted from the parent's own recorded step-0 model_input.
    const parentTools = (parent.steps[0].payload as { tools: ToolDefinition[] }).tools;
    expect(payload.tools).toEqual(parentTools);
    expect(payload.tools.map((t) => t.name)).toEqual(["get_weather", "send_email"]);
  });

  it("child validates, verifies 4/4, replays to success, and stays provider-neutral", async () => {
    const parent = await loadParent();
    const { childTrace } = await forkWeather(parent);
    expect(() => validateTrace(childTrace)).not.toThrow();
    const report = verifyTrace(childTrace);
    expect(report.pass).toBe(true);
    expect(report.invariants.every((i) => i.status === "pass")).toBe(true);
    const summary = replayTrace(childTrace);
    expect(summary.status).toBe("success");
    expect(auditTraceNeutrality(childTrace).ok).toBe(true);
  });

  it("the child's answer derives from the mutation: embeds the tool name and the injected weather facts", async () => {
    const parent = await loadParent();
    const { childTrace, finalAnswer } = await forkWeather(parent);
    expect(finalAnswer).toContain("get_weather");
    expect(finalAnswer).toContain("Heavy snow");
    expect(finalAnswer).toContain("-2");
    // The recorded trace replays to the same derived answer.
    expect(replayTrace(childTrace).result).toBe(finalAnswer);
  });

  it("changing the mutation changes the answer; repeating it repeats the answer", async () => {
    const parent = await loadParent();
    const a1 = (await forkWeather(parent)).finalAnswer;
    const a2 = (await forkWeather(parent)).finalAnswer;
    const other = (
      await forkWeather(parent, { city: "Paris", temperature_c: 31, condition: "Heatwave" })
    ).finalAnswer;
    expect(a2).toBe(a1);
    expect(other).not.toBe(a1);
    expect(other).toContain("Heatwave");
  });

  it("rejects a stale geometry: mutating step 3 while forking at 8 leaves the model_input at 4 stale", async () => {
    const parent = await loadParent();
    await expect(
      forkRun({
        parentTrace: parent,
        forkIndex: 8,
        childId: `${parent.id}-fork`,
        promptMutation: "(unused)",
        toolResultMutations: { 3: WEATHER_MUTATION },
        model: new ReactiveDemoModelClient(),
        toolExecutor: makeForeignExecutor(parent),
      }),
    ).rejects.toThrow(/stale/);
  });
});

// ---------------------------------------------------------------------------
// Behavioral diff: structural divergence + outcome verdict
// ---------------------------------------------------------------------------

describe("foreign cassette fork — structural and behavioral diff", () => {
  it("diffTraces finds the first divergence at index 3 over a 3-step shared prefix", async () => {
    const parent = await loadParent();
    const { childTrace } = await forkWeather(parent);
    const diff = diffTraces(parent, childTrace);
    expect(diff.sharedPrefixLength).toBe(3);
    expect(diff.firstDivergenceIndex).toBe(3);
  });

  it("diffOutcome: both succeed, answer changed, tool path shortened", async () => {
    const parent = await loadParent();
    const { childTrace } = await forkWeather(parent);
    const outcome = diffOutcome(parent, childTrace);
    expect(outcome.parentStatus).toBe("success");
    expect(outcome.childStatus).toBe("success");
    expect(outcome.statusChanged).toBe(false);
    expect(outcome.finalAnswerChanged).toBe(true);
    expect(outcome.toolSequenceChanged).toBe(true);
    expect(outcome.parentTools).toEqual(["get_weather", "send_email"]);
    expect(outcome.childTools).toEqual(["get_weather"]);
    expect(outcome.behaviorallyEquivalent).toBe(false);
  });

  it("formatDiffReport shows the divergence index and both tool paths", async () => {
    const parent = await loadParent();
    const { childTrace } = await forkWeather(parent);
    const formatted = formatDiffReport(parent, childTrace);
    expect(formatted).toContain("index 3");
    expect(formatted).toContain("Outcome:");
    expect(formatted).toContain("get_weather → send_email");
    expect(formatted).toContain("child tools:");
  });
});

// ---------------------------------------------------------------------------
// Library-level: secondary geometry (mutate step 7, fork at 8)
// ---------------------------------------------------------------------------

describe("foreign cassette fork — secondary geometry (mutate 7, fork 8)", () => {
  async function forkEmail(parent: Trace) {
    return forkRun({
      parentTrace: parent,
      forkIndex: 8,
      childId: `${parent.id}-fork-email`,
      promptMutation: "(unused)",
      toolResultMutations: { 7: EMAIL_MUTATION },
      model: new ReactiveDemoModelClient(),
      toolExecutor: makeForeignExecutor(parent),
    });
  }

  it("diverges first at index 7 with a 7-step shared prefix", async () => {
    const parent = await loadParent();
    const { childTrace } = await forkEmail(parent);
    const diff = diffTraces(parent, childTrace);
    expect(diff.sharedPrefixLength).toBe(7);
    expect(diff.firstDivergenceIndex).toBe(7);
    for (let i = 0; i < 7; i++) {
      expect(childTrace.steps[i].hash).toBe(parent.steps[i].hash);
    }
  });

  it("reconstructs the history across both foreign tool rounds with the second result mutated", async () => {
    const parent = await loadParent();
    const { childTrace } = await forkEmail(parent);
    const continuation = childTrace.steps[8];
    expect(continuation.type).toBe("model_input");
    const payload = continuation.payload as {
      messages: Array<{ role: string; content: unknown }>;
    };
    // user + (tool_use + tool_result) x 2 rounds
    expect(payload.messages).toHaveLength(5);
    const round2Result = payload.messages[4].content as Array<{
      type: string;
      toolCallId: string;
      toolName: string;
      result: JsonValue;
    }>;
    expect(round2Result[0].toolCallId).toBe("call-1");
    expect(round2Result[0].toolName).toBe("send_email");
    expect(round2Result[0].result).toEqual(EMAIL_MUTATION);
  });

  it("changes the final answer while keeping the full foreign tool sequence", async () => {
    const parent = await loadParent();
    const { childTrace, finalAnswer } = await forkEmail(parent);
    expect(verifyTrace(childTrace).pass).toBe(true);
    expect(finalAnswer).toContain("send_email");
    expect(finalAnswer).toContain("smtp unavailable");
    const outcome = diffOutcome(parent, childTrace);
    expect(outcome.finalAnswerChanged).toBe(true);
    expect(outcome.toolSequenceChanged).toBe(false);
    expect(toolCallSequence(childTrace)).toEqual(["get_weather", "send_email"]);
  });
});

// ---------------------------------------------------------------------------
// CLI-level: the existing fork / verify / diff / assert commands, unchanged
//
// The CLI fork continuation runs under the demo harness: it injects
// ReactiveDemoModelClient and defaultToolExecutor(), so the child's
// continuation model_input records the FIXTURE tool definitions — a documented
// demo-harness behavior, distinct from the library-level foreign-defs proof
// above. The child is always written to an explicit --out path (never derived,
// which would land beside the fixture).
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFile);

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[]): Promise<CliResult> {
  try {
    const result = await execFileAsync("npm", ["run", "cli", "--", ...args], {
      cwd: PROJECT_ROOT,
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr), exitCode: 0 };
  } catch (e) {
    const err = e as Record<string, unknown>;
    return {
      stdout: String(err["stdout"] ?? ""),
      stderr: String(err["stderr"] ?? ""),
      exitCode: typeof err["code"] === "number" ? (err["code"] as number) : 1,
    };
  }
}

describe("foreign cassette fork — CLI integration", () => {
  let outDir: string;
  let childPath: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "blackbox-foreign-fork-"));
    childPath = join(outDir, "chat-tool-use-fork.json");
    const r = await runCli([
      "fork",
      "--trace", PARENT_PATH,
      "--out", childPath,
      "--mode", "tool-result",
      "--fork-index", "4",
      "--mutation-step", "3",
      "--payload-json", JSON.stringify(WEATHER_MUTATION),
    ]);
    expect(r.exitCode).toBe(0);
  }, 60_000);

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("cli fork writes a valid child whose answer derives from the mutation", async () => {
    const child = await loadTrace(childPath);
    expect(() => validateTrace(child)).not.toThrow();
    expect(child.parentId).toBe("external-chat-tool-use");
    const summary = replayTrace(child);
    expect(summary.status).toBe("success");
    expect(summary.result).toContain("Heavy snow");
  }, 30_000);

  it("cli fork continuation records the demo-harness (fixture) tool definitions, not the foreign ones", async () => {
    const child = await loadTrace(childPath);
    const continuation = child.steps[4];
    expect(continuation.type).toBe("model_input");
    const tools = (continuation.payload as { tools: ToolDefinition[] }).tools;
    expect(tools.map((t) => t.name)).toEqual(["search", "calendar", "booking"]);
  }, 30_000);

  it("cli verify passes on the forked child", async () => {
    const r = await runCli(["verify", "--trace", childPath]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("PASS");
  }, 30_000);

  it("cli diff reports divergence at index 3 and the outcome verdict", async () => {
    const r = await runCli(["diff", "--parent", PARENT_PATH, "--child", childPath]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("index 3");
    expect(r.stdout).toContain("Outcome:");
    expect(r.stdout).toContain("final answer changed");
  }, 30_000);

  it("cli assert passes on the child with status success and tools get_weather", async () => {
    const r = await runCli([
      "assert",
      "--trace", childPath,
      "--expect-status", "success",
      "--expect-tools", "get_weather",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("PASS");
  }, 30_000);

  it("cli assert fails on the child with the parent's full tool sequence", async () => {
    const r = await runCli([
      "assert",
      "--trace", childPath,
      "--expect-tools", "get_weather,send_email",
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("FAIL");
  }, 30_000);

  it("fixtures/external still contains exactly the two committed W10-A files", async () => {
    const files = (await readdir(EXTERNAL_DIR)).sort();
    expect(files).toEqual([
      "chat-tool-use.converted.v2.json",
      "chat-tool-use.foreign.json",
    ]);
    // The committed parent bytes are untouched by the whole fork exercise.
    const parentRaw = await readFile(PARENT_PATH, "utf8");
    expect(parentRaw).toContain('"id": "external-chat-tool-use"');
  }, 30_000);
});
