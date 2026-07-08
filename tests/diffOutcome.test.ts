// Unit tests for the behavioral outcome diff (W7-B).
// Pure, offline, deterministic. Covers the four-branch precedence, the
// no-behavioral-change case, no-divergence pairs, determinism / no input
// mutation, and the formatDiffReport composition (structural block verbatim,
// then the Outcome block).

import { describe, it, expect } from "vitest";
import { diffOutcome, formatOutcomeDiff } from "../src/fork/diffOutcome.ts";
import { diffTraces, formatFirstDivergence, formatDiffReport } from "../src/fork/diffTraces.ts";
import { CURRENT_TRACE_VERSION, type Trace, type TraceStep, type JsonValue } from "../src/trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// Minimal trace builder (diffOutcome reads only step.type / step.payload).
// ---------------------------------------------------------------------------

function step(type: TraceStep["type"], payload: JsonValue): TraceStep {
  return { id: "s", index: 0, type, timestamp: 0, payload, prevHash: null, hash: "h" };
}

function trace(id: string, steps: TraceStep[]): Trace {
  return { version: CURRENT_TRACE_VERSION, id, createdAt: 0, steps };
}

const succeeded = (result: string, tools: string[] = []): Trace =>
  trace("run", [
    ...tools.map((t) => step("tool_call", { toolCallId: "c", toolName: t, toolInput: {} })),
    step("metadata", { event: "run_completed", status: "success", result }),
  ]);

const failed = (reason: string): Trace =>
  trace("run", [step("metadata", { event: "run_failed", status: "error", reason })]);

const incomplete = (): Trace => trace("run", [step("model_input", { messages: [] })]);

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

describe("diffOutcome — precedence", () => {
  it("rule 1: status differs → outcome flipped", () => {
    const o = diffOutcome(succeeded("Booked."), failed("model_error"));
    expect(o.statusChanged).toBe(true);
    expect(o.behaviorallyEquivalent).toBe(false);
    expect(o.verdict).toContain("outcome flipped");
    expect(o.verdict).toContain("success");
    expect(o.verdict).toContain("error");
  });

  it("rule 2 (success): same status, final answer changed", () => {
    const o = diffOutcome(succeeded("Booked."), succeeded("No availability."));
    expect(o.statusChanged).toBe(false);
    expect(o.finalAnswerChanged).toBe(true);
    expect(o.behaviorallyEquivalent).toBe(false);
    expect(o.verdict).toContain("success");
    expect(o.verdict).toContain("final answer changed");
  });

  it("rule 2 (error): same status, failure reason changed", () => {
    const o = diffOutcome(failed("model_error"), failed("max_steps_exceeded"));
    expect(o.statusChanged).toBe(false);
    expect(o.finalAnswerChanged).toBe(true);
    expect(o.verdict).toContain("error");
    expect(o.verdict).toContain("failure reason changed");
  });

  it("rule 3: same status + same result, tool path differs", () => {
    const o = diffOutcome(
      succeeded("Booked.", ["search", "calendar", "booking"]),
      succeeded("Booked.", ["search", "booking"]),
    );
    expect(o.statusChanged).toBe(false);
    expect(o.finalAnswerChanged).toBe(false);
    expect(o.toolSequenceChanged).toBe(true);
    expect(o.behaviorallyEquivalent).toBe(false);
    expect(o.verdict).toContain("tool-call path changed");
  });

  it("rule 4: all equal → no behavioral change", () => {
    const o = diffOutcome(
      succeeded("Booked.", ["search", "booking"]),
      succeeded("Booked.", ["search", "booking"]),
    );
    expect(o.statusChanged).toBe(false);
    expect(o.finalAnswerChanged).toBe(false);
    expect(o.toolSequenceChanged).toBe(false);
    expect(o.behaviorallyEquivalent).toBe(true);
    expect(o.verdict).toContain("no behavioral change");
  });

  it("incomplete vs incomplete → no behavioral change (both terminal results undefined)", () => {
    const o = diffOutcome(incomplete(), incomplete());
    expect(o.behaviorallyEquivalent).toBe(true);
  });

  it("success → incomplete is a status flip", () => {
    const o = diffOutcome(succeeded("Booked."), incomplete());
    expect(o.statusChanged).toBe(true);
    expect(o.verdict).toContain("outcome flipped");
  });
});

// ---------------------------------------------------------------------------
// Determinism & purity
// ---------------------------------------------------------------------------

describe("diffOutcome — determinism & purity", () => {
  it("identical inputs twice → identical OutcomeDiff", () => {
    const p = succeeded("Booked.", ["search", "booking"]);
    const c = succeeded("No availability.", ["search"]);
    expect(diffOutcome(p, c)).toEqual(diffOutcome(p, c));
  });

  it("does not mutate its input traces", () => {
    const p = succeeded("Booked.", ["search"]);
    const c = succeeded("Nope.", ["search"]);
    const ps = structuredClone(p);
    const cs = structuredClone(c);
    diffOutcome(p, c);
    expect(p).toEqual(ps);
    expect(c).toEqual(cs);
  });
});

// ---------------------------------------------------------------------------
// formatOutcomeDiff
// ---------------------------------------------------------------------------

describe("formatOutcomeDiff", () => {
  it("shows the tool sequences only when they differ", () => {
    const changed = formatOutcomeDiff(
      diffOutcome(succeeded("Booked.", ["search", "booking"]), succeeded("Booked.", ["search"])),
    );
    expect(changed).toContain("Outcome:");
    expect(changed).toContain("parent tools:");
    expect(changed).toContain("child tools:");

    const same = formatOutcomeDiff(
      diffOutcome(succeeded("Booked.", ["search"]), succeeded("No.", ["search"])),
    );
    expect(same).toContain("Outcome:");
    expect(same).not.toContain("parent tools:");
  });
});

// ---------------------------------------------------------------------------
// formatDiffReport composition
// ---------------------------------------------------------------------------

describe("formatDiffReport", () => {
  it("contains the full formatFirstDivergence output verbatim as a prefix, then the Outcome block", () => {
    const parent = succeeded("Booked.", ["search", "booking"]);
    const child = succeeded("No availability.", ["search"]);

    const structural = formatFirstDivergence(diffTraces(parent, child));
    const report = formatDiffReport(parent, child);

    expect(report.startsWith(structural)).toBe(true);
    expect(report).toContain("Outcome:");
    // The structural layer itself is untouched (no Outcome text leaked into it).
    expect(structural).not.toContain("Outcome:");
  });

  it("works on an identical pair (no divergence) — reports no behavioral change", () => {
    const t = succeeded("Booked.", ["search"]);
    const report = formatDiffReport(t, t);
    expect(report).toContain("Traces are identical (no divergence)");
    expect(report).toContain("no behavioral change");
  });
});
