// Unit tests for the composed offline self-check (W4-G).
// runSelfCheck composes record -> verify -> fork -> verify -> diff over the
// fake model + fixture tools. All in-process, fully offline, zero live calls.

import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readdir, rm } from "node:fs/promises";
import { runSelfCheck, type SelfCheckStageName } from "../src/workflow/selfCheck.ts";
import { loadTrace, validateTrace } from "../src/replay/CassetteReplay.ts";
import { verifyTrace } from "../src/trace/verifyTrace.ts";
import { diffTraces } from "../src/fork/diffTraces.ts";

const EXPECTED_ORDER: SelfCheckStageName[] = [
  "record",
  "verify_parent",
  "fork",
  "verify_child",
  "diff",
];

describe("runSelfCheck — default in-memory", () => {
  it("passes with all five stages in order", async () => {
    const report = await runSelfCheck();
    expect(report.pass).toBe(true);
    expect(report.stages.map((s) => s.name)).toEqual(EXPECTED_ORDER);
    expect(report.stages.every((s) => s.status === "pass")).toBe(true);
    expect(report.firstFailure).toBeUndefined();
  });

  it("writes no trace files by default (in-memory, not persisted)", async () => {
    const report = await runSelfCheck();
    expect(report.persisted).toBe(false);
    expect(report.parentPath).toBeUndefined();
    expect(report.childPath).toBeUndefined();
  });

  it("still carries the in-memory parent and child traces", async () => {
    const report = await runSelfCheck();
    expect(report.parentTrace.steps.length).toBeGreaterThan(0);
    expect(report.childTrace.steps.length).toBeGreaterThan(0);
    expect(report.childTrace.parentId).toBe(report.parentTrace.id);
  });

  it("is deterministic across calls (identical stage reports)", async () => {
    const a = await runSelfCheck();
    const b = await runSelfCheck();
    const shape = (r: Awaited<ReturnType<typeof runSelfCheck>>) =>
      r.stages.map((s) => ({ name: s.name, status: s.status, detail: s.detail }));
    expect(shape(a)).toEqual(shape(b));
  });

  it("parent and child each pass verifyTrace independently", async () => {
    const report = await runSelfCheck();
    expect(verifyTrace(report.parentTrace).pass).toBe(true);
    expect(verifyTrace(report.childTrace).pass).toBe(true);
  });

  it("diff stage reports first divergence over a non-empty hash-identical prefix", async () => {
    const report = await runSelfCheck();
    const diff = diffTraces(report.parentTrace, report.childTrace);

    // First divergence at the mutated tool_result step (index 3).
    expect(diff.hasDivergence).toBe(true);
    expect(diff.firstDivergenceIndex).toBe(3);
    expect(diff.sharedPrefixLength).toBeGreaterThan(0);

    // The shared-prefix steps really are hash-identical between parent and child.
    for (let i = 0; i < diff.sharedPrefixLength; i++) {
      expect(report.childTrace.steps[i].hash).toBe(report.parentTrace.steps[i].hash);
    }

    const diffStage = report.stages.find((s) => s.name === "diff");
    expect(diffStage?.status).toBe("pass");
    expect(diffStage?.detail).toContain("first divergence at index 3");
  });
});

describe("runSelfCheck — persisted via outDir", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("writes exactly the parent and child cassettes and nothing else", async () => {
    dir = join(tmpdir(), `blackbox-selfcheck-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const report = await runSelfCheck({ outDir: dir });

    expect(report.persisted).toBe(true);
    expect(report.parentPath).toBe(join(dir, "check-parent.json"));
    expect(report.childPath).toBe(join(dir, "check-child.json"));

    const entries = (await readdir(dir)).sort();
    expect(entries).toEqual(["check-child.json", "check-parent.json"]);
  });

  it("persisted parent and child load, validate, and verify", async () => {
    dir = join(tmpdir(), `blackbox-selfcheck-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const report = await runSelfCheck({ outDir: dir });

    const parent = await loadTrace(report.parentPath!);
    const child = await loadTrace(report.childPath!);

    expect(() => validateTrace(parent)).not.toThrow();
    expect(() => validateTrace(child)).not.toThrow();
    expect(verifyTrace(parent).pass).toBe(true);
    expect(verifyTrace(child).pass).toBe(true);
    expect(child.parentId).toBe(parent.id);
  });

  it("persisting does not change the verdict (identical stages to in-memory)", async () => {
    dir = join(tmpdir(), `blackbox-selfcheck-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const persistedReport = await runSelfCheck({ outDir: dir });
    const memoryReport = await runSelfCheck();
    const shape = (r: Awaited<ReturnType<typeof runSelfCheck>>) =>
      r.stages.map((s) => ({ name: s.name, status: s.status, detail: s.detail }));
    expect(shape(persistedReport)).toEqual(shape(memoryReport));
    expect(persistedReport.pass).toBe(true);
  });
});
