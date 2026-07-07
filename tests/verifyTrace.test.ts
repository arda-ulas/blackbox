// Offline tests for W4-F cassette verification.
//
// Everything here is fake/deterministic — no network, no ANTHROPIC_API_KEY. The
// invariants run in order (schema_version → hash_chain → provider_neutrality →
// replayability) and short-circuit at the first failure.

import { describe, it, expect, afterAll } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm, writeFile } from "node:fs/promises";
import { verifyTrace, verifyTraceFile } from "../src/trace/verifyTrace.ts";
import { auditTraceNeutrality, NEUTRALITY_FORBIDDEN } from "../src/trace/neutrality.ts";
import { TraceRecorder } from "../src/trace/TraceRecorder.ts";
import { FakeDeterministicModelClient, type ModelClient } from "../src/agent/modelClient.ts";
import { defaultToolExecutor } from "../src/agent/fixtureTools.ts";
import { runAgentLoop } from "../src/agent/agentLoop.ts";
import { saveTrace } from "../src/replay/CassetteReplay.ts";
import type { JsonValue, Trace } from "../src/trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempFiles: string[] = [];
let fileCounter = 0;

afterAll(async () => {
  await Promise.all(tempFiles.map((f) => rm(f, { force: true })));
});

function tmpPath(): string {
  fileCounter += 1;
  const p = join(tmpdir(), `blackbox-verify-test-${fileCounter}.json`);
  tempFiles.push(p);
  return p;
}

async function recordSimpleTrace(): Promise<Trace> {
  const recorder = new TraceRecorder("verify-simple", { createdAt: 0 });
  const result = await runAgentLoop({
    model: new FakeDeterministicModelClient([{ type: "final_answer", text: "Simple answer." }]),
    toolExecutor: defaultToolExecutor(),
    recorder,
    prompt: "Simple question.",
  });
  return result.trace;
}

async function recordToolTrace(): Promise<Trace> {
  const recorder = new TraceRecorder("verify-tool", { createdAt: 0 });
  const result = await runAgentLoop({
    model: new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "search", toolInput: { query: "weekend hotels" } },
      { type: "final_answer", text: "Found something." },
    ]),
    toolExecutor: defaultToolExecutor(),
    recorder,
    prompt: "Search for something.",
  });
  return result.trace;
}

/** A validly-hashed one-step trace whose single metadata payload is caller-supplied. */
function recordLeakTrace(payload: JsonValue): Trace {
  const recorder = new TraceRecorder("verify-leak", { createdAt: 0 });
  recorder.append("metadata", payload, 0);
  return recorder.getTrace();
}

// ---------------------------------------------------------------------------
// Success cases
// ---------------------------------------------------------------------------

describe("verifyTrace — success", () => {
  it("passes a valid final-answer trace with all four invariants pass", async () => {
    const trace = await recordSimpleTrace();
    const report = verifyTrace(trace);
    expect(report.pass).toBe(true);
    expect(report.firstFailure).toBeUndefined();
    expect(report.invariants.map((i) => i.name)).toEqual([
      "schema_version",
      "hash_chain",
      "provider_neutrality",
      "replayability",
    ]);
    expect(report.invariants.every((i) => i.status === "pass")).toBe(true);
  });

  it("passes a valid tool-using trace", async () => {
    const trace = await recordToolTrace();
    const report = verifyTrace(trace);
    expect(report.pass).toBe(true);
    expect(report.invariants.every((i) => i.status === "pass")).toBe(true);
  });

  it("does not falsely reject a valid terminal-error trace", async () => {
    const recorder = new TraceRecorder("verify-error", { createdAt: 0 });
    const throwingModel: ModelClient = {
      async complete() {
        throw new Error("fake provider timeout");
      },
    };
    await expect(
      runAgentLoop({ model: throwingModel, toolExecutor: defaultToolExecutor(), recorder, prompt: "go" }),
    ).rejects.toThrow();

    const report = verifyTrace(recorder.getTrace());
    // The run legitimately failed (run_failed terminal). No success claim exists,
    // so replayability must PASS, not FAIL.
    expect(report.pass).toBe(true);
    const replay = report.invariants.find((i) => i.name === "replayability");
    expect(replay?.status).toBe("pass");
    expect(replay?.detail).toContain("error");
  });
});

// ---------------------------------------------------------------------------
// schema_version failures
// ---------------------------------------------------------------------------

describe("verifyTrace — schema_version", () => {
  it("fails an unsupported version", async () => {
    const trace = await recordSimpleTrace();
    const report = verifyTrace({ ...trace, version: 999 });
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.name).toBe("schema_version");
    // Later invariants short-circuit to skip.
    expect(report.invariants.find((i) => i.name === "hash_chain")?.status).toBe("skip");
  });

  it("fails a missing version field", async () => {
    const trace = await recordSimpleTrace();
    const { version: _drop, ...withoutVersion } = trace;
    const report = verifyTrace(withoutVersion as unknown as Trace);
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.name).toBe("schema_version");
    expect(report.firstFailure?.detail).toMatch(/missing/i);
  });
});

// ---------------------------------------------------------------------------
// verifyTraceFile — load / JSON / legacy-version failures
// ---------------------------------------------------------------------------

describe("verifyTraceFile — load failures", () => {
  it("round-trips a saved valid trace to PASS with the path set", async () => {
    const trace = await recordSimpleTrace();
    const path = tmpPath();
    await saveTrace(trace, path);
    const report = await verifyTraceFile(path);
    expect(report.pass).toBe(true);
    expect(report.path).toBe(path);
  });

  it("fails a legacy v1 cassette with a re-record message (no throw)", async () => {
    const trace = await recordSimpleTrace();
    const path = tmpPath();
    await writeFile(path, JSON.stringify({ ...trace, version: 1 }), "utf8");
    const report = await verifyTraceFile(path);
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.name).toBe("schema_version");
    expect(report.firstFailure?.detail).toMatch(/re-record/i);
  });

  it("fails malformed JSON on disk as schema_version, not an uncaught throw", async () => {
    const path = tmpPath();
    await writeFile(path, "{ this is not valid json }", "utf8");
    const report = await verifyTraceFile(path);
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.name).toBe("schema_version");
  });

  it("fails a missing file cleanly", async () => {
    const report = await verifyTraceFile("/tmp/blackbox-no-such-verify-trace.json");
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.name).toBe("schema_version");
  });
});

// ---------------------------------------------------------------------------
// hash_chain failures (localized to a step)
// ---------------------------------------------------------------------------

describe("verifyTrace — hash_chain", () => {
  it("fails a tampered payload with a stale hash, reporting the step index", async () => {
    const trace = await recordSimpleTrace();
    const tampered = structuredClone(trace);
    (tampered.steps[0].payload as Record<string, unknown>)["__evil"] = true;
    const report = verifyTrace(tampered);
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.name).toBe("hash_chain");
    expect(report.firstFailure?.stepIndex).toBe(0);
  });

  it("fails a broken prevHash on step 1 with stepIndex 1", async () => {
    const trace = await recordSimpleTrace();
    const broken = structuredClone(trace);
    broken.steps[1].prevHash = "0".repeat(64);
    const report = verifyTrace(broken);
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.name).toBe("hash_chain");
    expect(report.firstFailure?.stepIndex).toBe(1);
  });

  it("fails an index gap", async () => {
    const trace = await recordSimpleTrace();
    const broken = structuredClone(trace);
    broken.steps[1].index = 99;
    const report = verifyTrace(broken);
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.name).toBe("hash_chain");
  });
});

// ---------------------------------------------------------------------------
// provider_neutrality failures
// ---------------------------------------------------------------------------

describe("verifyTrace — provider_neutrality", () => {
  it("flags a provider tool_use id (toolu_) leaked into a value", () => {
    const trace = recordLeakTrace({ note: "toolu_01ABCDEF" });
    const report = verifyTrace(trace);
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.name).toBe("provider_neutrality");
    expect(report.firstFailure?.detail).toContain("toolu_");
  });

  it("flags a message id (msg_) leaked into a value", () => {
    const report = verifyTrace(recordLeakTrace({ note: "msg_01XYZ" }));
    expect(report.firstFailure?.name).toBe("provider_neutrality");
    expect(report.firstFailure?.detail).toContain("msg_");
  });

  it("flags key-form provider markers (usage / stop_reason)", () => {
    const report = verifyTrace(recordLeakTrace({ usage: { input: 1 }, stop_reason: "end_turn" }));
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.name).toBe("provider_neutrality");
    expect(report.firstFailure?.detail).toContain("usage");
  });

  it("reports multiple distinct markers at once", () => {
    const report = verifyTrace(recordLeakTrace({ usage: {}, note: "toolu_1" }));
    const detail = report.firstFailure?.detail ?? "";
    expect(detail).toContain("usage");
    expect(detail).toContain("toolu_");
  });

  it("flags the env-var name ANTHROPIC_API_KEY", () => {
    const report = verifyTrace(recordLeakTrace({ note: "ANTHROPIC_API_KEY" }));
    expect(report.firstFailure?.name).toBe("provider_neutrality");
    expect(report.firstFailure?.detail).toContain("ANTHROPIC_API_KEY");
  });

  it("flags an sk-ant key prefix", () => {
    const report = verifyTrace(recordLeakTrace({ note: "sk-ant-api03-abc" }));
    expect(report.firstFailure?.name).toBe("provider_neutrality");
    expect(report.firstFailure?.detail).toContain("sk-ant");
  });

  it("flags a literal key value as <api-key-value> without echoing it", () => {
    const secret = "super-secret-key-value-123";
    const report = verifyTrace(recordLeakTrace({ note: `oops ${secret} leaked` }), { apiKey: secret });
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.name).toBe("provider_neutrality");
    expect(report.firstFailure?.detail).toContain("<api-key-value>");
    expect(report.firstFailure?.detail).not.toContain(secret);
  });

  it("flags a literal key value smuggled in as an OBJECT KEY without echoing it", () => {
    const secret = "super-secret-key-value-123";
    const report = verifyTrace(recordLeakTrace({ [secret]: "x" }), { apiKey: secret });
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.name).toBe("provider_neutrality");
    expect(report.firstFailure?.detail).toContain("<api-key-value>");
    expect(report.firstFailure?.detail).not.toContain(secret);
  });

  it("flags an sk-ant prefix appearing as an object key", () => {
    const report = verifyTrace(recordLeakTrace({ "sk-ant-api03-xyz": "x" }));
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.name).toBe("provider_neutrality");
    expect(report.firstFailure?.detail).toContain("sk-ant");
  });

  it("flags provider id prefixes (toolu_ / msg_) appearing as object keys", () => {
    const report = verifyTrace(recordLeakTrace({ "toolu_01ABC": {}, "msg_02DEF": {} }));
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.name).toBe("provider_neutrality");
    expect(report.firstFailure?.detail).toContain("toolu_");
    expect(report.firstFailure?.detail).toContain("msg_");
  });

  it("does NOT flag benign prose containing the word 'usage' as a value", () => {
    const trace = recordLeakTrace({ text: "What is the usage of this endpoint?" });
    const report = verifyTrace(trace);
    // usage is a key-form marker; as free text it must not trip the audit.
    const neutrality = report.invariants.find((i) => i.name === "provider_neutrality");
    expect(neutrality?.status).toBe("pass");
    expect(report.pass).toBe(true);
  });

  it("auditTraceNeutrality is clean for a normal recorded trace", async () => {
    const trace = await recordToolTrace();
    expect(auditTraceNeutrality(trace).ok).toBe(true);
  });

  it("exposes sk-ant in the exported forbidden-marker list", () => {
    expect(NEUTRALITY_FORBIDDEN).toContain("sk-ant");
  });
});

// ---------------------------------------------------------------------------
// replayability failures + skipReplay
// ---------------------------------------------------------------------------

describe("verifyTrace — replayability", () => {
  // A valid-hash trace whose run_completed/success marker is NOT the terminal
  // step: replay reports "incomplete" while the trace claims success.
  function buildNonTerminalSuccessTrace(): Trace {
    const recorder = new TraceRecorder("verify-inconsistent", { createdAt: 0 });
    recorder.append("metadata", { event: "run_completed", status: "success", result: "done" }, 0);
    recorder.append("metadata", { event: "note", detail: "trailing step after completion" }, 0);
    return recorder.getTrace();
  }

  it("fails when a success claim is not terminal (replay disagrees)", () => {
    const report = verifyTrace(buildNonTerminalSuccessTrace());
    expect(report.pass).toBe(false);
    expect(report.firstFailure?.name).toBe("replayability");
  });

  it("skipReplay bypasses the replay invariant (marked skip)", () => {
    const report = verifyTrace(buildNonTerminalSuccessTrace(), { skipReplay: true });
    const replay = report.invariants.find((i) => i.name === "replayability");
    expect(replay?.status).toBe("skip");
    // schema/hash/neutrality all pass, so with replay skipped the report passes.
    expect(report.pass).toBe(true);
  });

  it("skipReplay still runs the earlier invariants", async () => {
    const trace = await recordSimpleTrace();
    const report = verifyTrace(trace, { skipReplay: true });
    expect(report.invariants.find((i) => i.name === "hash_chain")?.status).toBe("pass");
    expect(report.invariants.find((i) => i.name === "replayability")?.status).toBe("skip");
    expect(report.pass).toBe(true);
  });
});
