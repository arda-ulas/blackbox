// Integration tests for the unified Blackbox CLI (W3-A).
// Each test spawns `npm run cli -- <subcommand>` as a child process and
// asserts on exit code, stdout, and/or the files written to a temp directory.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, rm, writeFile } from "node:fs/promises";
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
// Temp directory shared across most tests
// ---------------------------------------------------------------------------

const TEMP_DIR      = join(tmpdir(), `blackbox-cli-test-${Date.now()}`);
const SUCCESS_PATH  = join(TEMP_DIR, "example-trace.json");
const ERROR_PATH    = join(TEMP_DIR, "example-error-trace.json");
const FORK_OUT_PATH = join(TEMP_DIR, "fork-out.json");

let recordResult: CliResult;
let forkResult:   CliResult;

beforeAll(async () => {
  await mkdir(TEMP_DIR, { recursive: true });

  // Record both demo traces into TEMP_DIR.
  recordResult = await runCli(["record", "--out-dir", TEMP_DIR]);

  // Fork the success trace with an explicit --out path.
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
  it("exits 0 for the success trace", async () => {
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
// fork (explicit --out path)
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
// diff (explicit paths)
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
// Error handling — subcommand and required-flag errors
// ---------------------------------------------------------------------------

describe("cli errors", () => {
  it("unknown subcommand exits 1 and prints Unknown subcommand", async () => {
    const result = await runCli(["badcmd"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown subcommand");
  }, 15_000);

  it("diff with no flags exits 1 and prints Missing required flag", async () => {
    const result = await runCli(["diff"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required flag");
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Flag validation — unknown flags and missing values
// ---------------------------------------------------------------------------

describe("cli flag validation", () => {
  it("replay --bogus exits 1 and prints Unknown flag: --bogus", async () => {
    const result = await runCli(["replay", "--bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag: --bogus");
  }, 15_000);

  it("record --bogus exits 1 and prints Unknown flag: --bogus", async () => {
    const result = await runCli(["record", "--bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag: --bogus");
  }, 15_000);

  it("fork --bogus exits 1 and prints Unknown flag: --bogus", async () => {
    const result = await runCli(["fork", "--bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag: --bogus");
  }, 15_000);

  it("diff --bogus exits 1 and prints Unknown flag: --bogus", async () => {
    const result = await runCli(["diff", "--bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag: --bogus");
  }, 15_000);

  it("replay --trace with no value exits 1 and prints Missing value", async () => {
    const result = await runCli(["replay", "--trace"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing value for --trace");
  }, 15_000);

  it("fork --payload-json with bad JSON exits 1 and prints Invalid JSON", async () => {
    // Use an explicit --trace so we exercise JSON parsing, not file-not-found.
    const result = await runCli([
      "fork",
      "--trace",        SUCCESS_PATH,
      "--payload-json", "{bad",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid JSON");
  }, 15_000);

  it("fork --fork-index nope exits 1 and prints a clear error", async () => {
    // parseIntFlag runs before loadTrace, so no --trace needed.
    const result = await runCli(["fork", "--fork-index", "nope"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--fork-index");
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Default fork path: no-flag fork writes traces/example-trace-fork.json
// ---------------------------------------------------------------------------

describe("cli default fork path", () => {
  let defaultForkResult: CliResult;

  beforeAll(async () => {
    // Ensure the project-root traces/example-trace.json exists.
    await runCli(["record", "--scenario", "success"]);
    // Fork with no flags → should derive output as traces/example-trace-fork.json.
    defaultForkResult = await runCli(["fork"]);
  }, 60_000);

  it("fork with no flags exits 0", () => {
    expect(defaultForkResult.exitCode).toBe(0);
  });

  it("fork with no flags writes traces/example-trace-fork.json and it validates", async () => {
    const forkPath = join(PROJECT_ROOT, "traces", "example-trace-fork.json");
    const trace    = await loadTrace(forkPath);
    expect(() => validateTrace(trace)).not.toThrow();
  });

  it("diff --parent traces/example-trace.json --child traces/example-trace-fork.json exits 0 and shows First divergence", async () => {
    const result = await runCli([
      "diff",
      "--parent", join(PROJECT_ROOT, "traces", "example-trace.json"),
      "--child",  join(PROJECT_ROOT, "traces", "example-trace-fork.json"),
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("First divergence");
  }, 15_000);
});

// ---------------------------------------------------------------------------
// W3-B: list command
// ---------------------------------------------------------------------------

describe("cli list", () => {
  it("after record, lists success and error trace files", async () => {
    const result = await runCli(["list", "--dir", TEMP_DIR]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("example-trace.json");
    expect(result.stdout).toContain("example-error-trace.json");
  }, 15_000);

  it("shows trace id and status for valid traces", async () => {
    const result = await runCli(["list", "--dir", TEMP_DIR]);
    expect(result.stdout).toContain("example-run-001");
    expect(result.stdout).toContain("success");
  }, 15_000);

  it("on an empty directory exits 0 with an empty-state message", async () => {
    const emptyDir = join(tmpdir(), `blackbox-empty-${Date.now()}`);
    await mkdir(emptyDir, { recursive: true });
    try {
      const result = await runCli(["list", "--dir", emptyDir]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBeTruthy();
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  }, 15_000);

  it("on a non-existent directory exits 0 with an empty-state message", async () => {
    const result = await runCli(["list", "--dir", "/tmp/blackbox-no-such-dir-w3b"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBeTruthy();
  }, 15_000);
});

// ---------------------------------------------------------------------------
// W3-B: inspect command
// ---------------------------------------------------------------------------

describe("cli inspect", () => {
  it("prints trace id, version, step count, and status for the success trace", async () => {
    const result = await runCli(["inspect", "--trace", SUCCESS_PATH]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("example-run-001"); // trace id
    expect(result.stdout).toContain("1");               // version
    expect(result.stdout).toContain("15");              // step count
    expect(result.stdout).toContain("success");         // status
  }, 15_000);

  it("prints a step timeline with step types", async () => {
    const result = await runCli(["inspect", "--trace", SUCCESS_PATH]);
    expect(result.stdout).toContain("model_input");
    expect(result.stdout).toContain("tool_result");
    expect(result.stdout).toContain("metadata");
  }, 15_000);

  it("exits 1 for a missing trace path", async () => {
    const result = await runCli(["inspect", "--trace", "/tmp/blackbox-no-such-trace.json"]);
    expect(result.exitCode).toBe(1);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// W3-B: usage includes list and inspect
// ---------------------------------------------------------------------------

describe("cli usage", () => {
  it("usage output includes list and inspect", async () => {
    const result = await runCli([]); // no subcommand → printUsage()
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("inspect");
  }, 15_000);
});

// ---------------------------------------------------------------------------
// W3-B audit: list validates hash chains; createdAt in output
// ---------------------------------------------------------------------------

describe("cli list integrity", () => {
  let tamperedPath: string;
  let badJsonPath: string;

  beforeAll(async () => {
    // Hash-tampered trace: valid JSON structure but corrupted step hash.
    const raw  = await import("node:fs/promises").then((m) => m.readFile(SUCCESS_PATH, "utf8"));
    const data = JSON.parse(raw) as Record<string, unknown>;
    const steps = data["steps"] as Array<Record<string, unknown>>;
    steps[5]["hash"] = "0".repeat(64); // corrupt step 5's hash
    tamperedPath = join(TEMP_DIR, "tampered-trace.json");
    await writeFile(tamperedPath, JSON.stringify(data, null, 2), "utf8");

    // Malformed JSON: not parseable at all.
    badJsonPath = join(TEMP_DIR, "not-json.json");
    await writeFile(badJsonPath, "{ this is not valid json }", "utf8");
  });

  it("list shows [warning] for hash-tampered trace", async () => {
    const result = await runCli(["list", "--dir", TEMP_DIR]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("tampered-trace.json");
    expect(result.stdout).toContain("[warning]");
  }, 15_000);

  it("list does not count hash-tampered trace as successfully loaded", async () => {
    const result = await runCli(["list", "--dir", TEMP_DIR]);
    // TEMP_DIR has: example-trace, example-error-trace, fork-out,
    // tampered-trace, not-json → 5 JSON files, but only 3 are valid.
    expect(result.stdout).toContain("3 of 5");
  }, 15_000);

  it("list output includes createdAt for valid traces", async () => {
    const result = await runCli(["list", "--dir", TEMP_DIR]);
    expect(result.stdout).toContain("created=");
  }, 15_000);

  it("list shows [warning] for malformed JSON file", async () => {
    const result = await runCli(["list", "--dir", TEMP_DIR]);
    expect(result.stdout).toContain("not-json.json");
    expect(result.stdout).toContain("[warning]");
  }, 15_000);

  it("inspect exits 1 for a hash-tampered trace", async () => {
    const result = await runCli(["inspect", "--trace", tamperedPath]);
    expect(result.exitCode).toBe(1);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// W3-B audit: list/inspect flag validation
// ---------------------------------------------------------------------------

describe("cli list/inspect flag validation", () => {
  it("list --bogus exits 1 and prints Unknown flag: --bogus", async () => {
    const result = await runCli(["list", "--bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag: --bogus");
  }, 15_000);

  it("inspect --bogus exits 1 and prints Unknown flag: --bogus", async () => {
    const result = await runCli(["inspect", "--bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag: --bogus");
  }, 15_000);

  it("list --dir with no value exits 1 and prints Missing value for --dir", async () => {
    const result = await runCli(["list", "--dir"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing value for --dir");
  }, 15_000);

  it("inspect --trace with no value exits 1 and prints Missing value for --trace", async () => {
    const result = await runCli(["inspect", "--trace"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing value for --trace");
  }, 15_000);
});
