// Integration tests for `npm run cli -- assert` (W9-A).
// Each test spawns the CLI as a child process and asserts on exit code and
// stdout/stderr. Fully offline against the committed fixture corpus.

import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const fixture = (name: string): string =>
  join(PROJECT_ROOT, "fixtures", "traces", name);

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[]): Promise<CliResult> {
  try {
    const result = await execFileAsync("npm", ["run", "cli", "--", ...args], {
      cwd: PROJECT_ROOT,
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr), exitCode: 0 };
  } catch (e) {
    const err = e as Record<string, unknown>;
    return {
      stdout: String(err["stdout"] ?? ""),
      stderr: String(err["stderr"] ?? ""),
      exitCode: typeof err["code"] === "number" ? (err["code"] as number) : 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Passing assertions → exit 0
// ---------------------------------------------------------------------------

describe("cli assert — passing", () => {
  it("success-tool-use with status + tools exits 0", async () => {
    const r = await runCli([
      "assert",
      "--trace", fixture("success-tool-use.v2.json"),
      "--expect-status", "success",
      "--expect-tools", "search,calendar,booking",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Result:");
    expect(r.stdout).toContain("PASS");
    expect(r.stdout).toContain("status");
    expect(r.stdout).toContain("tools");
  }, 30_000);

  it("success-final-answer with empty --expect-tools exits 0", async () => {
    const r = await runCli([
      "assert",
      "--trace", fixture("success-final-answer.v2.json"),
      "--expect-tools", "",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("PASS");
    expect(r.stdout).toContain("(none)");
  }, 30_000);

  it("error-unknown-tool with status + failure reason exits 0", async () => {
    const r = await runCli([
      "assert",
      "--trace", fixture("error-unknown-tool.v2.json"),
      "--expect-status", "error",
      "--expect-failure-reason", "unknown_tool",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("PASS");
    expect(r.stdout).toContain("failure_reason");
  }, 30_000);

  it("no expectations declared still passes a valid cassette", async () => {
    const r = await runCli(["assert", "--trace", fixture("success-tool-use.v2.json")]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("none declared");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Failing assertion → exit 1 with a labelled expected/actual/action block
// ---------------------------------------------------------------------------

describe("cli assert — failing expectation", () => {
  it("wrong status exits 1 with expected/actual/action block", async () => {
    const r = await runCli([
      "assert",
      "--trace", fixture("success-tool-use.v2.json"),
      "--expect-status", "error",
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("FAIL");
    expect(r.stdout).toContain("check:");
    expect(r.stdout).toContain("expected:");
    expect(r.stdout).toContain("actual:");
    expect(r.stdout).toContain("action:");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Argument / flag errors → exit 1 on stderr
// ---------------------------------------------------------------------------

describe("cli assert — argument errors", () => {
  it("missing --trace exits 1", async () => {
    const r = await runCli(["assert", "--expect-status", "success"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Missing required flag: --trace");
  }, 30_000);

  it("bad --expect-status enum exits 1", async () => {
    const r = await runCli([
      "assert",
      "--trace", fixture("success-tool-use.v2.json"),
      "--expect-status", "bogus",
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--expect-status must be success, error, or incomplete");
  }, 30_000);

  it("unknown flag exits 1", async () => {
    const r = await runCli([
      "assert",
      "--trace", fixture("success-tool-use.v2.json"),
      "--bogus", "x",
    ]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Unknown flag: --bogus");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Determinism → output byte-stable run-to-run over a committed fixture
// ---------------------------------------------------------------------------

describe("cli assert — determinism", () => {
  it("stdout is byte-identical across two runs", async () => {
    const args = [
      "assert",
      "--trace", fixture("success-tool-use.v2.json"),
      "--expect-status", "success",
      "--expect-tools", "search,calendar,booking",
    ];
    const a = await runCli(args);
    const b = await runCli(args);
    expect(a.stdout).toBe(b.stdout);
  }, 45_000);
});
