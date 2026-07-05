// Integration tests for the unified Blackbox CLI (W3-A).
// Each test spawns `npm run cli -- <subcommand>` as a child process and
// asserts on exit code, stdout, and/or the files written to a temp directory.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, rm } from "node:fs/promises";
import { loadTrace, validateTrace } from "../src/replay/CassetteReplay.ts";

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Helper: run CLI as a subprocess
// ---------------------------------------------------------------------------

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[]): Promise<CliResult> {
  try {
    const result = await execFileAsync(
      "npm",
      ["run", "cli", "--", ...args],
      { cwd: PROJECT_ROOT },
    );
    return {
      stdout:   String(result.stdout),
      stderr:   String(result.stderr),
      exitCode: 0,
    };
  } catch (e) {
    const err = e as Record<string, unknown>;
    return {
      stdout:   String(err["stdout"] ?? ""),
      stderr:   String(err["stderr"] ?? ""),
      exitCode: typeof err["code"] === "number" ? err["code"] : 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Temp directory shared across all tests
// ---------------------------------------------------------------------------

const TEMP_DIR        = join(tmpdir(), `blackbox-cli-test-${Date.now()}`);
const SUCCESS_PATH    = join(TEMP_DIR, "example-trace.json");
const ERROR_PATH      = join(TEMP_DIR, "example-error-trace.json");
const FORK_OUT_PATH   = join(TEMP_DIR, "fork-out.json");

let recordResult: CliResult;
let forkResult:   CliResult;

beforeAll(async () => {
  await mkdir(TEMP_DIR, { recursive: true });

  // Run record (creates both traces in TEMP_DIR)
  recordResult = await runCli(["record", "--out-dir", TEMP_DIR]);

  // Run fork on the success trace (needs record to have completed first)
  if (recordResult.exitCode === 0) {
    forkResult = await runCli([
      "fork",
      "--trace", SUCCESS_PATH,
      "--out",   FORK_OUT_PATH,
    ]);
  }
}, 60_000);

afterAll(async () => {
  await rm(TEMP_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------

describe("cli record", () => {
  it("exits 0", () => {
    expect(recordResult.exitCode).toBe(0);
  });

  it("creates example-trace.json that loads and validates", async () => {
    const trace = await loadTrace(SUCCESS_PATH);
    expect(() => validateTrace(trace)).not.toThrow();
    expect(trace.id).toBe("example-run-001");
  });

  it("creates example-error-trace.json that loads and validates", async () => {
    const trace = await loadTrace(ERROR_PATH);
    expect(() => validateTrace(trace)).not.toThrow();
    expect(trace.id).toBe("example-error-run");
  });

  it("prints the success trace section header", () => {
    expect(recordResult.stdout).toContain("success trace");
  });

  it("prints the error trace section header", () => {
    expect(recordResult.stdout).toContain("error trace");
  });

  it("--scenario success creates only the success trace", async () => {
    const result = await runCli(["record", "--scenario", "success", "--out-dir", TEMP_DIR]);
    expect(result.exitCode).toBe(0);
    const trace = await loadTrace(SUCCESS_PATH);
    expect(() => validateTrace(trace)).not.toThrow();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// replay
// ---------------------------------------------------------------------------

describe("cli replay", () => {
  it("exits 0 for the default success trace", async () => {
    const result = await runCli(["replay", "--trace", SUCCESS_PATH]);
    expect(result.exitCode).toBe(0);
  }, 15_000);

  it("stdout contains the word 'success'", async () => {
    const result = await runCli(["replay", "--trace", SUCCESS_PATH]);
    expect(result.stdout).toContain("success");
  }, 15_000);

  it("stdout contains the step count", async () => {
    const trace  = await loadTrace(SUCCESS_PATH);
    const result = await runCli(["replay", "--trace", SUCCESS_PATH]);
    expect(result.stdout).toContain(String(trace.steps.length));
  }, 15_000);
});

// ---------------------------------------------------------------------------
// fork
// ---------------------------------------------------------------------------

describe("cli fork", () => {
  it("exits 0", () => {
    expect(forkResult.exitCode).toBe(0);
  });

  it("creates a child cassette that loads and validates", async () => {
    const trace = await loadTrace(FORK_OUT_PATH);
    expect(() => validateTrace(trace)).not.toThrow();
  });

  it("stdout contains 'First divergence'", () => {
    expect(forkResult.stdout).toContain("First divergence");
  });

  it("child trace has a parentId referencing the parent", async () => {
    const trace = await loadTrace(FORK_OUT_PATH);
    expect(trace.parentId).toBe("example-run-001");
  });
});

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

describe("cli diff", () => {
  it("exits 0 when given valid parent and child paths", async () => {
    const result = await runCli([
      "diff",
      "--parent", SUCCESS_PATH,
      "--child",  FORK_OUT_PATH,
    ]);
    expect(result.exitCode).toBe(0);
  }, 15_000);

  it("stdout contains 'First divergence'", async () => {
    const result = await runCli([
      "diff",
      "--parent", SUCCESS_PATH,
      "--child",  FORK_OUT_PATH,
    ]);
    expect(result.stdout).toContain("First divergence");
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("cli errors", () => {
  it("unknown subcommand exits 1", async () => {
    const result = await runCli(["badcmd"]);
    expect(result.exitCode).toBe(1);
  }, 15_000);

  it("unknown subcommand stderr contains 'Unknown subcommand'", async () => {
    const result = await runCli(["badcmd"]);
    expect(result.stderr).toContain("Unknown subcommand");
  }, 15_000);

  it("diff with no flags exits 1", async () => {
    const result = await runCli(["diff"]);
    expect(result.exitCode).toBe(1);
  }, 15_000);

  it("diff with no flags stderr contains 'Missing required flag'", async () => {
    const result = await runCli(["diff"]);
    expect(result.stderr).toContain("Missing required flag");
  }, 15_000);
});
