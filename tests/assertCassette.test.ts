// Unit tests for the cassette assertion harness (W9-A).
//
// Pure, offline, deterministic. Valid-trace cases load the COMMITTED fixture
// corpus (real hash chains) so the invariants genuinely pass; failure cases use
// a fabricated broken-chain trace. Zero live calls, no model/tool/network.

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  assertCassette,
  assertCassetteFile,
} from "../src/workflow/assertCassette.ts";
import { loadTrace } from "../src/replay/CassetteReplay.ts";
import { CURRENT_TRACE_VERSION, type Trace } from "../src/trace/TraceTypes.ts";

const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const FIXTURES_DIR = join(PROJECT_ROOT, "fixtures", "traces");
const fixture = (name: string): string => join(FIXTURES_DIR, name);

const SUCCESS_TOOL_USE = fixture("success-tool-use.v2.json");
const SUCCESS_FINAL_ANSWER = fixture("success-final-answer.v2.json");
const ERROR_UNKNOWN_TOOL = fixture("error-unknown-tool.v2.json");

// A version-2 trace with a deliberately wrong stored hash: schema_version passes
// but hash_chain fails when validateTrace recomputes the hash.
function brokenChainTrace(): Trace {
  return {
    version: CURRENT_TRACE_VERSION,
    id: "broken",
    createdAt: 0,
    steps: [
      {
        id: "s0",
        index: 0,
        type: "model_input",
        timestamp: 0,
        payload: { messages: [] },
        prevHash: null,
        hash: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Passing expectations over real cassettes
// ---------------------------------------------------------------------------

describe("assertCassette — passing expectations", () => {
  it("passes for expected status", async () => {
    const report = assertCassette(await loadTrace(SUCCESS_TOOL_USE), {
      expectStatus: "success",
    });
    expect(report.pass).toBe(true);
    expect(report.firstFailure).toBeUndefined();
    expect(report.checks.map((c) => [c.name, c.status])).toEqual([["status", "pass"]]);
  });

  it("passes for expected final answer", async () => {
    const report = assertCassette(await loadTrace(SUCCESS_FINAL_ANSWER), {
      expectFinalAnswer: "The capital of France is Paris.",
    });
    expect(report.pass).toBe(true);
    expect(report.checks[0]).toMatchObject({ name: "final_answer", status: "pass" });
  });

  it("passes for expected failure reason", async () => {
    const report = assertCassette(await loadTrace(ERROR_UNKNOWN_TOOL), {
      expectFailureReason: "unknown_tool",
    });
    expect(report.pass).toBe(true);
    expect(report.checks[0]).toMatchObject({ name: "failure_reason", status: "pass" });
  });

  it("passes for expected ordered tools", async () => {
    const report = assertCassette(await loadTrace(SUCCESS_TOOL_USE), {
      expectTools: ["search", "calendar", "booking"],
    });
    expect(report.pass).toBe(true);
    expect(report.checks[0]).toMatchObject({
      name: "tools",
      status: "pass",
      actual: "search, calendar, booking",
    });
  });

  it("empty expectTools passes for a final-answer-only cassette", async () => {
    const report = assertCassette(await loadTrace(SUCCESS_FINAL_ANSWER), {
      expectTools: [],
    });
    expect(report.pass).toBe(true);
    expect(report.checks[0]).toMatchObject({
      name: "tools",
      status: "pass",
      actual: "(none)",
    });
  });

  it("no expectations mode passes invariants-only (no check rows)", async () => {
    const report = assertCassette(await loadTrace(SUCCESS_TOOL_USE), {});
    expect(report.pass).toBe(true);
    expect(report.checks).toEqual([]);
    expect(report.verify.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Failing expectations (clean fail, never a throw)
// ---------------------------------------------------------------------------

describe("assertCassette — failing expectations", () => {
  it("wrong status fails", async () => {
    const report = assertCassette(await loadTrace(SUCCESS_TOOL_USE), {
      expectStatus: "error",
    });
    expect(report.pass).toBe(false);
    expect(report.firstFailure).toEqual({
      kind: "expectation",
      check: expect.objectContaining({ name: "status", status: "fail" }),
    });
    expect(report.checks[0]).toMatchObject({ expected: "error", actual: "success" });
  });

  it("wrong final answer fails cleanly", async () => {
    const report = assertCassette(await loadTrace(SUCCESS_FINAL_ANSWER), {
      expectFinalAnswer: "Something else entirely.",
    });
    expect(report.pass).toBe(false);
    expect(report.checks[0]).toMatchObject({ name: "final_answer", status: "fail" });
  });

  it("wrong failure reason fails cleanly", async () => {
    const report = assertCassette(await loadTrace(ERROR_UNKNOWN_TOOL), {
      expectFailureReason: "model_error",
    });
    expect(report.pass).toBe(false);
    expect(report.checks[0]).toMatchObject({ name: "failure_reason", status: "fail" });
  });

  it("wrong tools fail", async () => {
    const report = assertCassette(await loadTrace(SUCCESS_TOOL_USE), {
      expectTools: ["search", "booking"],
    });
    expect(report.pass).toBe(false);
    expect(report.checks[0]).toMatchObject({ name: "tools", status: "fail" });
  });

  it("tool order mismatch fails", async () => {
    const report = assertCassette(await loadTrace(SUCCESS_TOOL_USE), {
      expectTools: ["calendar", "search", "booking"],
    });
    expect(report.pass).toBe(false);
    expect(report.checks[0]).toMatchObject({ name: "tools", status: "fail" });
  });

  it("missing tool (too few) fails", async () => {
    const report = assertCassette(await loadTrace(SUCCESS_TOOL_USE), {
      expectTools: ["search", "calendar"],
    });
    expect(report.pass).toBe(false);
    expect(report.checks[0]).toMatchObject({ name: "tools", status: "fail" });
  });

  it("extra tool (too many) fails", async () => {
    const report = assertCassette(await loadTrace(SUCCESS_TOOL_USE), {
      expectTools: ["search", "calendar", "booking", "extra"],
    });
    expect(report.pass).toBe(false);
    expect(report.checks[0]).toMatchObject({ name: "tools", status: "fail" });
  });

  it("final-answer expectation on an error trace fails (no invented answer)", async () => {
    const report = assertCassette(await loadTrace(ERROR_UNKNOWN_TOOL), {
      expectFinalAnswer: "anything",
    });
    expect(report.pass).toBe(false);
    expect(report.checks[0]).toMatchObject({
      name: "final_answer",
      status: "fail",
      actual: "(none)",
    });
  });
});

// ---------------------------------------------------------------------------
// Invariant failure gates expectations → skip
// ---------------------------------------------------------------------------

describe("assertCassette — invariant failure", () => {
  it("supplied expectations skip when verification fails", () => {
    const report = assertCassette(brokenChainTrace(), {
      expectStatus: "success",
      expectTools: ["search"],
    });
    expect(report.pass).toBe(false);
    expect(report.verify.pass).toBe(false);
    expect(report.firstFailure).toEqual({ kind: "verify", report: report.verify });
    expect(report.checks.map((c) => [c.name, c.status])).toEqual([
      ["status", "skip"],
      ["tools", "skip"],
    ]);
  });

  it("no skip rows are created for absent expectations", () => {
    const report = assertCassette(brokenChainTrace(), {});
    expect(report.pass).toBe(false);
    expect(report.checks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// assertCassetteFile — honest fail, no throw
// ---------------------------------------------------------------------------

describe("assertCassetteFile", () => {
  it("returns a FAIL report for a missing file (no throw)", async () => {
    const report = await assertCassetteFile(fixture("does-not-exist.json"), {
      expectStatus: "success",
    });
    expect(report.pass).toBe(false);
    expect(report.verify.invariants[0]).toMatchObject({
      name: "schema_version",
      status: "fail",
    });
    expect(report.firstFailure?.kind).toBe("verify");
    expect(report.checks.map((c) => c.status)).toEqual(["skip"]);
  });

  it("passes over a committed fixture with correct expectations", async () => {
    const report = await assertCassetteFile(SUCCESS_TOOL_USE, {
      expectStatus: "success",
      expectTools: ["search", "calendar", "booking"],
    });
    expect(report.pass).toBe(true);
    expect(report.verify.path).toBe(SUCCESS_TOOL_USE);
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe("assertCassette — purity", () => {
  it("does not mutate the input trace", async () => {
    const trace = await loadTrace(SUCCESS_TOOL_USE);
    const before = structuredClone(trace);
    assertCassette(trace, {
      expectStatus: "success",
      expectTools: ["search", "calendar", "booking"],
    });
    expect(trace).toEqual(before);
  });
});
