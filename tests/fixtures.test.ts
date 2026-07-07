// W5-A regression harness: loads the COMMITTED fake/offline v2 trace corpus
// under fixtures/traces/ and asserts every core invariant against those frozen
// artifacts — schema version, hash-chain integrity, frozen expected hashes,
// provider neutrality, offline replay, terminal-error verification, fork-prefix
// hash identity, and a frozen first-divergence index.
//
// Unlike the runtime-only suites (which build a trace and assert on it in the
// same process), these assertions compare against artifacts committed to git, so
// a change to the payload shape, canonical serialization, or hash input fields
// fails loudly instead of silently regenerating. Everything is offline,
// fake/deterministic, zero live calls.

import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadTrace, validateTrace, replayTrace } from "../src/replay/CassetteReplay.ts";
import { verifyTrace } from "../src/trace/verifyTrace.ts";
import { auditTraceNeutrality, NEUTRALITY_FORBIDDEN } from "../src/trace/neutrality.ts";
import { diffTraces } from "../src/fork/diffTraces.ts";
import { CURRENT_TRACE_VERSION, type Trace } from "../src/trace/TraceTypes.ts";
import {
  FIXTURES_DIR,
  FIXTURE_MANIFEST,
  FORK_FIRST_DIVERGENCE_INDEX,
  buildCorpus,
  serializeFixture,
} from "../scripts/generateFixtures.ts";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Frozen expectations. These are hand-verified constants, not values recomputed
// from the fixture at runtime: if a committed fixture's stored hash changes,
// these fail. Regenerate deliberately (see docs/20_week_five_a_plan.md §7).
// ---------------------------------------------------------------------------

/** Final-step hash of each committed fixture. */
const FROZEN_FINAL_HASH: Record<string, string> = {
  "success-final-answer.v2.json":
    "b691b4fdfda8d70769766d0227e4028eedd58f7c7248bba3973424ebd70385ed",
  "success-tool-use.v2.json":
    "ad95eb1808b8dd4d680a57a64d1da3ae568654bad327ccc756aa525e9d3dbc2f",
  "error-unknown-tool.v2.json":
    "3728bf094854fa68466a5370fd68c929a64e65ef2a880eaeea0305a47558103d",
  "fork-parent.v2.json":
    "ad95eb1808b8dd4d680a57a64d1da3ae568654bad327ccc756aa525e9d3dbc2f",
  "fork-child.v2.json":
    "dc359be40a52aa2e1488d5b3233b30a8b8da3d1dc43708b02300e8a819bcf4bc",
};

/** Full per-step hash chain of the smallest fixture (a stronger drift witness). */
const FROZEN_FINAL_ANSWER_CHAIN: string[] = [
  "69f285d56c33b1bc303c46487dabb75cce71ae3cecdbb713b0492780409d608d",
  "92e98ba5d5c743e9fd25db58dea782aad943302530cc91e4e49bcec8e10b70c2",
  "b691b4fdfda8d70769766d0227e4028eedd58f7c7248bba3973424ebd70385ed",
];

/** Expected replay outcomes per fixture. */
const EXPECTED_SUCCESS_RESULT: Record<string, string> = {
  "success-final-answer.v2.json": "The capital of France is Paris.",
  "success-tool-use.v2.json": "Hotel booked for Alice on 2024-03-15 at 14:00.",
  "fork-parent.v2.json": "Hotel booked for Alice on 2024-03-15 at 14:00.",
  "fork-child.v2.json":
    "No hotels available for Alice this weekend. The area is fully booked — consider a different date.",
};

const SUCCESS_FIXTURES = Object.keys(EXPECTED_SUCCESS_RESULT);
const ERROR_FIXTURE = "error-unknown-tool.v2.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fixturePath(name: string): string {
  return join(FIXTURES_DIR, name);
}

async function load(name: string): Promise<Trace> {
  return loadTrace(fixturePath(name));
}

// ---------------------------------------------------------------------------
// Corpus manifest
// ---------------------------------------------------------------------------

describe("fixture corpus — manifest", () => {
  it("contains exactly the expected committed fixtures", async () => {
    const onDisk = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith(".json")).sort();
    expect(onDisk).toEqual([...FIXTURE_MANIFEST]);
  });
});

// ---------------------------------------------------------------------------
// Per-fixture: schema, hash chain, neutrality, frozen final hash
// ---------------------------------------------------------------------------

describe("fixture corpus — schema, chain, neutrality, frozen hashes", () => {
  for (const name of FIXTURE_MANIFEST) {
    describe(name, () => {
      it("loads as a supported v2 cassette", async () => {
        const trace = await load(name);
        expect(trace.version).toBe(CURRENT_TRACE_VERSION);
        expect(trace.version).toBe(2);
      });

      it("has a valid hash chain", async () => {
        const trace = await load(name);
        expect(() => validateTrace(trace)).not.toThrow();
      });

      it("is provider-neutral (structured audit clean)", async () => {
        const trace = await load(name);
        expect(auditTraceNeutrality(trace).ok).toBe(true);
        const report = verifyTrace(trace);
        expect(report.invariants.find((i) => i.name === "provider_neutrality")?.status).toBe("pass");
      });

      it("carries no forbidden provider marker in its serialized text", async () => {
        const raw = await readFile(fixturePath(name), "utf8");
        for (const marker of NEUTRALITY_FORBIDDEN) {
          expect(raw.includes(marker)).toBe(false);
        }
      });

      it("matches its frozen final-step hash", async () => {
        const trace = await load(name);
        expect(trace.steps.at(-1)!.hash).toBe(FROZEN_FINAL_HASH[name]);
      });
    });
  }

  it("success-final-answer matches its full frozen hash chain", async () => {
    const trace = await load("success-final-answer.v2.json");
    expect(trace.steps.map((s) => s.hash)).toEqual(FROZEN_FINAL_ANSWER_CHAIN);
  });
});

// ---------------------------------------------------------------------------
// Offline replay + verify
// ---------------------------------------------------------------------------

describe("fixture corpus — offline replay + verify", () => {
  for (const name of SUCCESS_FIXTURES) {
    it(`${name} replays as success with the expected result and verifies`, async () => {
      const trace = await load(name);
      const summary = replayTrace(trace);
      expect(summary.status).toBe("success");
      expect(summary.result).toBe(EXPECTED_SUCCESS_RESULT[name]);
      expect(verifyTrace(trace).pass).toBe(true);
    });
  }

  it("the terminal error fixture replays as error and still verifies (not falsely rejected)", async () => {
    const trace = await load(ERROR_FIXTURE);
    const summary = replayTrace(trace);
    expect(summary.status).toBe("error");
    expect(summary.failureReason).toBe("unknown_tool");
    // A legitimate run_failed run has no success claim, so replayability passes.
    const report = verifyTrace(trace);
    expect(report.pass).toBe(true);
    expect(report.invariants.find((i) => i.name === "replayability")?.status).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Fork prefix identity + stable first divergence
// ---------------------------------------------------------------------------

describe("fixture corpus — fork prefix identity + first divergence", () => {
  it("child references the parent it was forked from", async () => {
    const parent = await load("fork-parent.v2.json");
    const child = await load("fork-child.v2.json");
    expect(child.parentId).toBe(parent.id);
    expect(child.forkedFromStepId).toBe(`${parent.id}:${FORK_FIRST_DIVERGENCE_INDEX + 1}`);
  });

  it("shares a canonical-hash-identical prefix before divergence", async () => {
    const parent = await load("fork-parent.v2.json");
    const child = await load("fork-child.v2.json");
    const diff = diffTraces(parent, child);

    expect(diff.hasDivergence).toBe(true);
    expect(diff.sharedPrefixLength).toBeGreaterThan(0);

    // Every step in the shared prefix is byte-for-byte hash-identical.
    for (let i = 0; i < diff.sharedPrefixLength; i++) {
      expect(child.steps[i].hash).toBe(parent.steps[i].hash);
    }
  });

  it("first diverges at the frozen mutation index", async () => {
    const parent = await load("fork-parent.v2.json");
    const child = await load("fork-child.v2.json");
    const diff = diffTraces(parent, child);
    expect(diff.firstDivergenceIndex).toBe(FORK_FIRST_DIVERGENCE_INDEX);
    expect(diff.sharedPrefixLength).toBe(FORK_FIRST_DIVERGENCE_INDEX);
  });
});

// ---------------------------------------------------------------------------
// Generator ↔ committed corpus cannot drift apart
// ---------------------------------------------------------------------------

describe("fixture corpus — generator sync", () => {
  it("the in-memory generator build matches every committed fixture byte-for-byte", async () => {
    const corpus = await buildCorpus();
    expect([...corpus.keys()].sort()).toEqual([...FIXTURE_MANIFEST]);
    for (const [name, trace] of corpus) {
      const onDisk = await readFile(fixturePath(name), "utf8");
      expect(onDisk).toBe(serializeFixture(trace));
    }
  });
});

// ---------------------------------------------------------------------------
// .gitignore: corpus tracked, root traces/ ignored
// ---------------------------------------------------------------------------

describe("fixture corpus — gitignore boundaries", () => {
  // git check-ignore exits 0 when a path IS ignored, 1 when it is NOT.
  async function isIgnored(relPath: string): Promise<boolean> {
    try {
      await execFileAsync("git", ["check-ignore", "-q", relPath], { cwd: PROJECT_ROOT });
      return true;
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code === 1) return false;
      throw e;
    }
  }

  it("committed fixtures under fixtures/traces/ are NOT ignored", async () => {
    for (const name of FIXTURE_MANIFEST) {
      expect(await isIgnored(join("fixtures/traces", name))).toBe(false);
    }
  });

  it("the root traces/ output directory remains ignored", async () => {
    expect(await isIgnored("traces/example-trace.json")).toBe(true);
  });

  it("all committed fixtures are tracked by git", async () => {
    const { stdout } = await execFileAsync("git", ["ls-files", "fixtures/traces"], {
      cwd: PROJECT_ROOT,
    });
    const tracked = stdout.split("\n").filter(Boolean).map((p) => p.replace(/^fixtures\/traces\//, "")).sort();
    expect(tracked).toEqual([...FIXTURE_MANIFEST]);
  });
});
