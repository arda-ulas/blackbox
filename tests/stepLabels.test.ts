// W6-A ergonomics: unit coverage for the shared presentation helper
// (`src/trace/stepLabels.ts`), a replay-unchanged parity check proving the
// humanizer was lifted verbatim (replay wording + raw step types are
// identical), and a corpus-based diff-legibility check proving the frozen
// fork-parent/fork-child mutation is actually visible in the rendered diff.
//
// Everything is offline, fake/deterministic, zero live calls: the committed
// corpus is read from disk and no model, tool, or network is touched.

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  stepTypeLabel,
  describeStep,
  describeDivergenceField,
} from "../src/trace/stepLabels.ts";
import { loadTrace, replayTrace } from "../src/replay/CassetteReplay.ts";
import { diffTraces, formatFirstDivergence } from "../src/fork/diffTraces.ts";
import { FIXTURES_DIR } from "../scripts/generateFixtures.ts";
import type { TraceStep, TraceStepType } from "../src/trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// 1. stepTypeLabel — every step type has a human label, exhaustively
// ---------------------------------------------------------------------------

describe("stepTypeLabel", () => {
  const cases: Array<[TraceStepType, string]> = [
    ["model_input", "model input"],
    ["model_output", "model output"],
    ["tool_call", "tool call"],
    ["tool_result", "tool result"],
    ["metadata", "metadata"],
  ];

  it.each(cases)("labels %s as '%s'", (type, label) => {
    expect(stepTypeLabel(type)).toBe(label);
  });

  it("covers every member of the TraceStepType union (exhaustive)", () => {
    // If a new TraceStepType is added, this array (typed as the union) forces a
    // compile error until it is listed, and stepTypeLabel's `never` default
    // guards the runtime side.
    const allTypes: TraceStepType[] = [
      "model_input",
      "model_output",
      "tool_call",
      "tool_result",
      "metadata",
    ];
    for (const t of allTypes) {
      expect(stepTypeLabel(t)).not.toContain("unknown");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. describeStep — one humanized line per step kind
// ---------------------------------------------------------------------------

function step(type: TraceStepType, payload: unknown): TraceStep {
  return {
    id: "x:0",
    index: 0,
    type,
    timestamp: 0,
    payload: payload as TraceStep["payload"],
    prevHash: null,
    hash: "deadbeef",
  };
}

describe("describeStep", () => {
  it("summarizes model_input by message count", () => {
    expect(describeStep(step("model_input", { messages: [1, 2, 3] }))).toBe(
      "Model called with 3 message(s)",
    );
  });

  it("summarizes a tool_call model_output", () => {
    expect(
      describeStep(step("model_output", { type: "tool_call", toolName: "search" })),
    ).toBe("Model → tool_call: search");
  });

  it("summarizes a tool_result ok", () => {
    expect(describeStep(step("tool_result", { toolName: "search", result: {} }))).toBe(
      "Tool result: search → ok",
    );
  });

  it("summarizes a tool_result error", () => {
    expect(
      describeStep(step("tool_result", { toolName: "flights", error: "unknown_tool" })),
    ).toBe("Tool result: flights → ERROR: unknown_tool");
  });

  it("summarizes a run_completed metadata step", () => {
    expect(
      describeStep(step("metadata", { event: "run_completed", result: "Done." })),
    ).toBe('Run completed: "Done."');
  });
});

// ---------------------------------------------------------------------------
// 3. describeDivergenceField — surfaces the changed value
// ---------------------------------------------------------------------------

describe("describeDivergenceField", () => {
  it("names the shared 'result' field and shows both values", () => {
    const parent = step("tool_result", { toolName: "s", result: { available: true } });
    const child = step("tool_result", { toolName: "s", result: { available: false } });
    const lines = describeDivergenceField(parent, child);
    expect(lines[0]).toBe("  changed value (result):");
    expect(lines[1]).toContain('"available":true');
    expect(lines[2]).toContain('"available":false');
  });

  it("names the changed fields when a long nested value is cut off", () => {
    const reading = (value: string, ts: string) => ({
      toolName: "get_telemetry",
      result: {
        vehicle_id: "VAN-14",
        data: [
          { path: "Vehicle.Powertrain.CombustionEngine.EngineCoolant.Temperature", dp: { value, ts } },
          { path: "Vehicle.TraveledDistance", dp: { value: "84391200", ts } },
          { path: "Vehicle.Diagnostics.DTCList", dp: { value: [], ts } },
        ],
      },
    });
    const lines = describeDivergenceField(
      step("tool_result", reading("91", "2026-09-28T17:05:00Z")),
      step("tool_result", reading("124", "2026-09-29T08:52:00Z")),
    );
    expect(lines[1].endsWith("…")).toBe(true);
    expect(lines[3]).toBe("  changed fields:");
    expect(lines[4]).toBe('    result.data[0].dp.value: "91" → "124"');
    expect(lines[5]).toBe('    result.data[0].dp.ts: "2026-09-28T17:05:00Z" → "2026-09-29T08:52:00Z"');
    expect(lines).toHaveLength(8);
  });

  it("keeps short values as they are, without a field list", () => {
    const lines = describeDivergenceField(
      step("tool_result", { toolName: "s", result: { a: 1 } }),
      step("tool_result", { toolName: "s", result: { a: 2 } }),
    );
    expect(lines).toHaveLength(3);
  });

  it("returns no block for a strict-prefix divergence (one side absent)", () => {
    const child = step("tool_result", { toolName: "s", result: {} });
    expect(describeDivergenceField(null, child)).toEqual([]);
    expect(describeDivergenceField(child, null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Replay unchanged — the humanizer was lifted verbatim
//
// For every committed fixture, replayTrace's per-step summary must equal
// describeStep applied to the same step, and the event type must remain the
// RAW TraceStepType (stepTypeLabel must not have leaked into replay data).
// ---------------------------------------------------------------------------

const CORPUS = [
  "success-final-answer.v2.json",
  "success-tool-use.v2.json",
  "error-unknown-tool.v2.json",
  "fork-parent.v2.json",
  "fork-child.v2.json",
];

describe("replay unchanged (humanizer lifted verbatim)", () => {
  it.each(CORPUS)("%s: replay summaries == describeStep, types stay raw", async (name) => {
    const trace = await loadTrace(join(FIXTURES_DIR, name));
    const summary = replayTrace(trace);
    for (const event of summary.events) {
      const src = trace.steps[event.index];
      expect(event.summary).toBe(describeStep(src));
      // Raw enum token preserved (not the humanized label).
      expect(event.type).toBe(src.type);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Diff legibility over the frozen corpus fork pair
// ---------------------------------------------------------------------------

describe("formatFirstDivergence legibility (corpus fork pair)", () => {
  it("shows the fork-child mutation at the frozen divergence index 3", async () => {
    const parent = await loadTrace(join(FIXTURES_DIR, "fork-parent.v2.json"));
    const child = await loadTrace(join(FIXTURES_DIR, "fork-child.v2.json"));

    const diff = diffTraces(parent, child);
    // Computation unchanged: shared prefix 3, first divergence at index 3.
    expect(diff.sharedPrefixLength).toBe(3);
    expect(diff.firstDivergenceIndex).toBe(3);

    const output = formatFirstDivergence(diff);
    expect(output).toContain("Shared prefix:  3 step(s)");
    expect(output).toContain("First divergence at index 3");
    expect(output).toContain("tool result"); // humanized step-type label
    expect(output).toContain("changed value (result):");
    // The actual mutation is visible, not truncated away before it differs.
    expect(output).toContain('"available":false');
    expect(output).toContain("No hotels available for that date.");
  });
});
