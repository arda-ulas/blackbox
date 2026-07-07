// Offline tests for W6-B verify failure explanation.
//
// Everything here is fake/deterministic — no network, no ANTHROPIC_API_KEY. The
// explainer is presentation-only: it renders facts already computed by
// verifyTrace and never verifies, hashes, replays, or touches disk.

import { describe, it, expect } from "vitest";
import {
  suggestedAction,
  formatVerifyFailure,
} from "../src/trace/verifyExplain.ts";
import { verifyTrace } from "../src/trace/verifyTrace.ts";
import type {
  VerifyInvariantName,
  VerifyReport,
} from "../src/trace/verifyTrace.ts";
import { TraceRecorder } from "../src/trace/TraceRecorder.ts";
import { FakeDeterministicModelClient } from "../src/agent/modelClient.ts";
import { defaultToolExecutor } from "../src/agent/fixtureTools.ts";
import { runAgentLoop } from "../src/agent/agentLoop.ts";
import type { JsonValue, Trace } from "../src/trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// Helpers (mirroring verifyTrace.test.ts builders)
// ---------------------------------------------------------------------------

const ALL_INVARIANTS: VerifyInvariantName[] = [
  "schema_version",
  "hash_chain",
  "provider_neutrality",
  "replayability",
];

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

function recordLeakTrace(payload: JsonValue): Trace {
  const recorder = new TraceRecorder("verify-leak", { createdAt: 0 });
  recorder.append("metadata", payload, 0);
  return recorder.getTrace();
}

function buildNonTerminalSuccessTrace(): Trace {
  const recorder = new TraceRecorder("verify-inconsistent", { createdAt: 0 });
  recorder.append("metadata", { event: "run_completed", status: "success", result: "done" }, 0);
  recorder.append("metadata", { event: "note", detail: "trailing step after completion" }, 0);
  return recorder.getTrace();
}

function render(report: VerifyReport): string {
  return formatVerifyFailure(report).join("\n");
}

// ---------------------------------------------------------------------------
// suggestedAction — unit + exhaustiveness
// ---------------------------------------------------------------------------

describe("suggestedAction", () => {
  it("returns a non-empty action for every invariant name", () => {
    for (const name of ALL_INVARIANTS) {
      expect(suggestedAction(name).length).toBeGreaterThan(0);
    }
  });

  it("returns a distinct action per invariant", () => {
    const actions = ALL_INVARIANTS.map(suggestedAction);
    expect(new Set(actions).size).toBe(ALL_INVARIANTS.length);
  });

  it("suggests re-record for schema_version and hash_chain", () => {
    expect(suggestedAction("schema_version")).toMatch(/re-record/i);
    expect(suggestedAction("hash_chain")).toMatch(/re-record/i);
  });

  it("warns against committing a neutrality-leaking cassette", () => {
    expect(suggestedAction("provider_neutrality")).toMatch(/never commit/i);
  });
});

// ---------------------------------------------------------------------------
// formatVerifyFailure — structure + defensive behavior
// ---------------------------------------------------------------------------

describe("formatVerifyFailure — structure", () => {
  it("returns [] for a PASS report (no firstFailure)", async () => {
    const report = verifyTrace(await recordSimpleTrace());
    expect(report.pass).toBe(true);
    expect(formatVerifyFailure(report)).toEqual([]);
  });

  it("returns [] defensively when firstFailure is absent", () => {
    const empty: VerifyReport = { pass: true, invariants: [] };
    expect(formatVerifyFailure(empty)).toEqual([]);
  });

  it("labels invariant, detail, and action, and heads the block with 'Failure'", () => {
    const report = verifyTrace(recordLeakTrace({ note: "toolu_01ABCDEF" }));
    const lines = formatVerifyFailure(report);
    expect(lines[0]).toBe("Failure");
    const text = lines.join("\n");
    expect(text).toMatch(/invariant:\s+provider_neutrality/);
    expect(text).toMatch(/detail:/);
    expect(text).toMatch(/action:/);
  });

  it("omits the 'at:' row when the failure is not step-localized", () => {
    const report = verifyTrace(recordLeakTrace({ note: "toolu_01ABCDEF" }));
    expect(render(report)).not.toMatch(/\bat:/);
  });
});

// ---------------------------------------------------------------------------
// Per-invariant explanations
// ---------------------------------------------------------------------------

describe("formatVerifyFailure — per invariant", () => {
  it("schema_version: names the invariant and carries the detail", async () => {
    const report = verifyTrace({ ...(await recordSimpleTrace()), version: 999 });
    const text = render(report);
    expect(report.firstFailure?.name).toBe("schema_version");
    expect(text).toMatch(/invariant:\s+schema_version/);
    expect(text).toMatch(/re-record/i);
  });

  it("hash_chain: shows the step index and the expected-vs-actual hash detail", async () => {
    const trace = await recordSimpleTrace();
    const tampered = structuredClone(trace);
    (tampered.steps[0].payload as Record<string, unknown>)["__evil"] = true;
    const report = verifyTrace(tampered);
    const text = render(report);
    expect(report.firstFailure?.name).toBe("hash_chain");
    expect(text).toMatch(/at:\s+step 0/);
    // The pre-existing detail carries stored/recomputed hashes; presented verbatim.
    expect(text).toMatch(/detail:.*recomputed/);
    expect(text).toMatch(/re-record/i);
  });

  it("provider_neutrality: surfaces the offending marker from the detail", () => {
    const report = verifyTrace(recordLeakTrace({ usage: {}, note: "toolu_1" }));
    const text = render(report);
    expect(report.firstFailure?.name).toBe("provider_neutrality");
    expect(text).toContain("toolu_");
    expect(text).toContain("usage");
    expect(text).toMatch(/never commit/i);
  });

  it("replayability: explains an inconsistent success claim", () => {
    const report = verifyTrace(buildNonTerminalSuccessTrace());
    const text = render(report);
    expect(report.firstFailure?.name).toBe("replayability");
    expect(text).toMatch(/invariant:\s+replayability/);
    expect(text).toMatch(/replay to a consistent verdict/i);
  });
});

// ---------------------------------------------------------------------------
// Secret masking — the raw key value is never echoed
// ---------------------------------------------------------------------------

describe("formatVerifyFailure — secret masking", () => {
  it("renders <api-key-value> and never the raw secret", () => {
    const secret = "super-secret-key-value-123";
    const report = verifyTrace(recordLeakTrace({ note: `oops ${secret} leaked` }), { apiKey: secret });
    const text = render(report);
    expect(text).toContain("<api-key-value>");
    expect(text).not.toContain(secret);
  });
});
