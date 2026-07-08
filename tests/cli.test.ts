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

  it("stdout contains 'Summary:' human-readable divergence line", () => {
    expect(forkResult.stdout).toContain("Summary:");
  });

  it("inline trace diff surfaces the changed value (not a truncated JSON dump)", () => {
    // W6-A: the fork command's inline `--- trace diff ---` block must make the
    // injected mutation legible, not truncate it away mid-key.
    expect(forkResult.stdout).toContain("changed value (result):");
    expect(forkResult.stdout).toContain("tool result");
    expect(forkResult.stdout).toContain('"available":false');
    expect(forkResult.stdout).toContain("No hotels available for that date.");
  });

  it("child trace has a parentId referencing the parent", async () => {
    const trace = await loadTrace(FORK_OUT_PATH);
    expect(trace.parentId).toBe("example-run-001");
  });

  it("prints a behavioral Outcome line (W7-B): same success status, final answer changed", () => {
    expect(forkResult.stdout).toContain("Outcome:");
    expect(forkResult.stdout).toContain("same final status (success), but the final answer changed");
    // Tool sequences shown because the child's path is shorter than the parent's.
    expect(forkResult.stdout).toContain("parent tools:");
    expect(forkResult.stdout).toContain("child tools:");
  });

  it("Result line is the derived answer embedding the mutation message (W7-A)", () => {
    // The reactive continuation computes the answer from the mutated tool_result
    // — the default payload's message is embedded verbatim in the Result line.
    expect(forkResult.stdout).toMatch(
      /Result:\s+Based on the search result, no options are available: "No hotels available for that date\."/,
    );
  });

  it("a custom --payload-json marker appears in the child answer and differs from the default", async () => {
    // Kept OUTSIDE TEMP_DIR so this child cassette is not counted by the `list`
    // integrity tests.
    const markerOut = join(tmpdir(), `blackbox-fork-marker-${Date.now()}.json`);
    try {
      const custom = await runCli([
        "fork",
        "--trace",        SUCCESS_PATH,
        "--out",          markerOut,
        "--payload-json", JSON.stringify({ results: [], available: false, message: "MARKER-ZED-77 no rooms" }),
      ]);
      expect(custom.exitCode).toBe(0);
      // Derived: the child answer embeds the custom marker...
      expect(custom.stdout).toMatch(/Result:\s+.*MARKER-ZED-77 no rooms/);
      // ...and differs from the default fork answer (mutation → different answer).
      expect(custom.stdout).not.toContain("No hotels available for that date.");
    } finally {
      await rm(markerOut, { force: true });
    }
  }, 30_000);
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

  it("stdout contains 'Summary:' human-readable line", async () => {
    const result = await runCli([
      "diff",
      "--parent", SUCCESS_PATH,
      "--child",  FORK_OUT_PATH,
    ]);
    expect(result.stdout).toContain("Summary:");
  }, 15_000);

  it("surfaces the changed value at the divergence (frozen corpus fork pair)", async () => {
    // W6-A: standalone diff shows the mutated tool result value legibly. Uses
    // the committed hash-identical fork pair so the divergence is deterministic
    // (the temp SUCCESS_PATH is re-recorded by another test, so its prefix is
    // not stable for this assertion).
    const result = await runCli([
      "diff",
      "--parent", "fixtures/traces/fork-parent.v2.json",
      "--child",  "fixtures/traces/fork-child.v2.json",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("First divergence at index 3");
    expect(result.stdout).toContain("changed value (result):");
    expect(result.stdout).toContain('"available":false');
    expect(result.stdout).toContain("No hotels available for that date.");
  }, 15_000);

  it("prints a behavioral Outcome line for the frozen corpus fork pair (W7-B)", async () => {
    const result = await runCli([
      "diff",
      "--parent", "fixtures/traces/fork-parent.v2.json",
      "--child",  "fixtures/traces/fork-child.v2.json",
    ]);
    expect(result.exitCode).toBe(0);
    // Both runs succeed; the mutation changed the final answer (not the status).
    expect(result.stdout).toContain("Outcome:");
    expect(result.stdout).toContain("same final status (success), but the final answer changed");
    expect(result.stdout).toContain("parent tools:  search → calendar → booking");
    expect(result.stdout).toContain("child tools:   search");
    // The structural divergence block is still present and unchanged.
    expect(result.stdout).toContain("First divergence at index 3");
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
// W4-F: verify command
// ---------------------------------------------------------------------------

describe("cli verify", () => {
  // Kept OUTSIDE TEMP_DIR so it is not counted by the `list` integrity tests.
  const verifyTamperedPath = join(tmpdir(), `blackbox-verify-tampered-${Date.now()}.json`);

  beforeAll(async () => {
    // Build a hash-tampered copy of the recorded success trace.
    const raw   = await import("node:fs/promises").then((m) => m.readFile(SUCCESS_PATH, "utf8"));
    const data  = JSON.parse(raw) as Record<string, unknown>;
    const steps = data["steps"] as Array<Record<string, unknown>>;
    steps[3]["hash"] = "0".repeat(64); // corrupt step 3's hash
    await writeFile(verifyTamperedPath, JSON.stringify(data, null, 2), "utf8");
  });

  afterAll(async () => {
    await rm(verifyTamperedPath, { force: true });
  });

  it("verify on a valid trace exits 0 and prints PASS", async () => {
    const result = await runCli(["verify", "--trace", SUCCESS_PATH]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("PASS");
    expect(result.stdout).toContain("schema_version");
    expect(result.stdout).toContain("replayability");
    // PASS prints no failure block.
    expect(result.stdout).not.toContain("Failure");
    expect(result.stdout).not.toContain("action:");
  }, 15_000);

  it("verify on a hash-tampered trace exits 1 and explains the failed invariant", async () => {
    const result = await runCli(["verify", "--trace", verifyTamperedPath]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("FAIL");
    // W6-B: labelled failure block with a suggested action.
    expect(result.stdout).toContain("Failure");
    expect(result.stdout).toMatch(/invariant:\s+hash_chain/);
    expect(result.stdout).toMatch(/action:/);
    expect(result.stdout).toMatch(/re-record/i);
  }, 15_000);

  it("verify on a missing trace exits 1", async () => {
    const result = await runCli(["verify", "--trace", "/tmp/blackbox-no-such-verify.json"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("FAIL");
  }, 15_000);

  it("verify --bogus exits 1 and prints Unknown flag: --bogus", async () => {
    const result = await runCli(["verify", "--bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag: --bogus");
  }, 15_000);
});

// ---------------------------------------------------------------------------
// W4-G: check command (composed offline self-check)
// ---------------------------------------------------------------------------

describe("cli check", () => {
  it("default check exits 0 and prints PASS with all stage names", async () => {
    const result = await runCli(["check"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[blackbox] --- check ---");
    expect(result.stdout).toContain("PASS");
    for (const stage of ["record", "verify_parent", "fork", "verify_child", "diff"]) {
      expect(result.stdout).toContain(stage);
    }
  }, 30_000);

  it("default check reports in-memory mode and writes no files", async () => {
    const result = await runCli(["check"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("in-memory");
    expect(result.stdout).toContain("no files written");
  }, 30_000);

  it("check --out-dir exits 0 and writes exactly the two cassettes", async () => {
    const outDir = join(tmpdir(), `blackbox-check-out-${Date.now()}`);
    try {
      const result = await runCli(["check", "--out-dir", outDir]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("persisted");

      const parentPath = join(outDir, "check-parent.json");
      const childPath  = join(outDir, "check-child.json");
      expect(result.stdout).toContain(parentPath);
      expect(result.stdout).toContain(childPath);

      // Both persisted cassettes load and validate.
      const parent = await loadTrace(parentPath);
      const child  = await loadTrace(childPath);
      expect(() => validateTrace(parent)).not.toThrow();
      expect(() => validateTrace(child)).not.toThrow();
      expect(child.parentId).toBe(parent.id);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("check --bogus exits 1 and prints Unknown flag: --bogus", async () => {
    const result = await runCli(["check", "--bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag: --bogus");
  }, 15_000);
});

// ---------------------------------------------------------------------------
// W4-G: fork overwrite guardrail
// ---------------------------------------------------------------------------

describe("cli fork overwrite guard", () => {
  it("fork --trace X --out X exits 1 and leaves the parent unchanged", async () => {
    const before = await import("node:fs/promises").then((m) => m.readFile(SUCCESS_PATH, "utf8"));
    const result = await runCli([
      "fork",
      "--trace", SUCCESS_PATH,
      "--out",   SUCCESS_PATH,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Refusing to overwrite the parent trace");

    const after = await import("node:fs/promises").then((m) => m.readFile(SUCCESS_PATH, "utf8"));
    expect(after).toBe(before);
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
    expect(result.stdout).toContain("Version:");        // version label (schema v2)
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
