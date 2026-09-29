// No-ANSI guard (W8-A).
//
// Structural guarantee that color never leaks into piped / CI output on EITHER
// stream. Every command is spawned as a child process (execFile gives a
// non-TTY pipe, exactly like a redirect or CI), and we assert that neither
// stdout (success paths) nor stderr (error / die paths) contains an ANSI CSI
// escape. We also repeat representative cases with NO_COLOR present and with CI
// present to document that those env opt-outs keep both streams escape-free.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, rm } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

// ANSI CSI introducer (ESC written as an escape, never a literal control byte).
const ANSI = /\x1b\[/;

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], env?: NodeJS.ProcessEnv): Promise<CliResult> {
  try {
    const result = await execFileAsync("npm", ["run", "cli", "--", ...args], {
      cwd: PROJECT_ROOT,
      env: env ? { ...process.env, ...env } : process.env,
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

const TEMP_DIR = join(tmpdir(), `blackbox-noansi-${Date.now()}`);
const SUCCESS_PATH = join(TEMP_DIR, "example-trace.json");
const FORK_OUT_PATH = join(TEMP_DIR, "fork-out.json");

beforeAll(async () => {
  await mkdir(TEMP_DIR, { recursive: true });
  await runCli(["demo", "--scenario", "success", "--out-dir", TEMP_DIR]);
  await runCli(["fork", "--trace", SUCCESS_PATH, "--out", FORK_OUT_PATH]);
}, 60_000);

afterAll(async () => {
  await rm(TEMP_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Success paths → stdout has zero ANSI escapes
// ---------------------------------------------------------------------------

describe("no ANSI on non-TTY stdout (success paths)", () => {
  it("demo", async () => {
    const r = await runCli(["demo", "--scenario", "success", "--out-dir", TEMP_DIR]);
    expect(r.exitCode).toBe(0);
    expect(ANSI.test(r.stdout)).toBe(false);
  }, 30_000);

  it("replay", async () => {
    const r = await runCli(["replay", "--trace", SUCCESS_PATH]);
    expect(r.exitCode).toBe(0);
    expect(ANSI.test(r.stdout)).toBe(false);
  }, 15_000);

  it("fork", async () => {
    const r = await runCli(["fork", "--trace", SUCCESS_PATH, "--out", join(TEMP_DIR, "f2.json")]);
    expect(r.exitCode).toBe(0);
    expect(ANSI.test(r.stdout)).toBe(false);
  }, 15_000);

  it("diff", async () => {
    const r = await runCli(["diff", "--parent", SUCCESS_PATH, "--child", FORK_OUT_PATH]);
    expect(r.exitCode).toBe(0);
    expect(ANSI.test(r.stdout)).toBe(false);
  }, 15_000);

  it("verify (PASS)", async () => {
    const r = await runCli(["verify", "--trace", SUCCESS_PATH]);
    expect(r.exitCode).toBe(0);
    expect(ANSI.test(r.stdout)).toBe(false);
  }, 15_000);

  it("assert (PASS)", async () => {
    const r = await runCli(["assert", "--trace", SUCCESS_PATH, "--expect-status", "success"]);
    expect(r.exitCode).toBe(0);
    expect(ANSI.test(r.stdout)).toBe(false);
  }, 15_000);

  it("assert (failing expectation → exit 1, stdout still escape-free)", async () => {
    const r = await runCli(["assert", "--trace", SUCCESS_PATH, "--expect-status", "error"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain("FAIL");
    expect(ANSI.test(r.stdout)).toBe(false);
  }, 15_000);

  it("check", async () => {
    const r = await runCli(["check"]);
    expect(r.exitCode).toBe(0);
    expect(ANSI.test(r.stdout)).toBe(false);
  }, 30_000);

  it("list", async () => {
    const r = await runCli(["list", "--dir", TEMP_DIR]);
    expect(r.exitCode).toBe(0);
    expect(ANSI.test(r.stdout)).toBe(false);
  }, 15_000);

  it("inspect", async () => {
    const r = await runCli(["inspect", "--trace", SUCCESS_PATH]);
    expect(r.exitCode).toBe(0);
    expect(ANSI.test(r.stdout)).toBe(false);
  }, 15_000);

  it("usage (no subcommand)", async () => {
    const r = await runCli([]);
    expect(r.exitCode).toBe(0);
    expect(ANSI.test(r.stdout)).toBe(false);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// Error / die paths → stderr has zero ANSI escapes
// ---------------------------------------------------------------------------

describe("no ANSI on non-TTY stderr (error / die paths)", () => {
  it("unknown subcommand", async () => {
    const r = await runCli(["badcmd"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Unknown command");
    expect(ANSI.test(r.stderr)).toBe(false);
  }, 15_000);

  it("diff missing required flag (die)", async () => {
    const r = await runCli(["diff"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Missing required flag");
    expect(ANSI.test(r.stderr)).toBe(false);
  }, 15_000);

  it("replay unknown flag (die)", async () => {
    const r = await runCli(["replay", "--bogus"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Unknown flag: --bogus");
    expect(ANSI.test(r.stderr)).toBe(false);
  }, 15_000);

  it("replay missing flag value (die)", async () => {
    const r = await runCli(["replay", "--trace"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Missing value for --trace");
    expect(ANSI.test(r.stderr)).toBe(false);
  }, 15_000);

  it("fork overwrite guard (die)", async () => {
    const r = await runCli(["fork", "--trace", SUCCESS_PATH, "--out", SUCCESS_PATH]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Refusing to overwrite the parent trace");
    expect(ANSI.test(r.stderr)).toBe(false);
  }, 15_000);

  it("assert missing --trace (die)", async () => {
    const r = await runCli(["assert", "--expect-status", "success"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Missing required flag: --trace");
    expect(ANSI.test(r.stderr)).toBe(false);
  }, 15_000);

  it("assert bad --expect-status enum (die)", async () => {
    const r = await runCli(["assert", "--trace", SUCCESS_PATH, "--expect-status", "bogus"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--expect-status must be");
    expect(ANSI.test(r.stderr)).toBe(false);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// NO_COLOR present and CI present → both streams still escape-free
// ---------------------------------------------------------------------------

describe("no ANSI under NO_COLOR-present and CI-present", () => {
  it("check under NO_COLOR='' (empty-present) stays escape-free", async () => {
    const r = await runCli(["check"], { NO_COLOR: "" });
    expect(r.exitCode).toBe(0);
    expect(ANSI.test(r.stdout)).toBe(false);
  }, 30_000);

  it("check under CI='' (empty-present) stays escape-free", async () => {
    const r = await runCli(["check"], { CI: "" });
    expect(r.exitCode).toBe(0);
    expect(ANSI.test(r.stdout)).toBe(false);
  }, 30_000);

  it("error path under NO_COLOR present stays escape-free on stderr", async () => {
    const r = await runCli(["badcmd"], { NO_COLOR: "1" });
    expect(r.exitCode).toBe(1);
    expect(ANSI.test(r.stderr)).toBe(false);
  }, 15_000);

  it("error path under CI present stays escape-free on stderr", async () => {
    const r = await runCli(["badcmd"], { CI: "1" });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Unknown command");
    expect(ANSI.test(r.stderr)).toBe(false);
  }, 15_000);

  it("die() error path under CI present stays escape-free on stderr", async () => {
    const r = await runCli(["diff"], { CI: "1" });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Missing required flag");
    expect(ANSI.test(r.stderr)).toBe(false);
  }, 15_000);

  it("assert under CI present stays escape-free on stdout", async () => {
    const r = await runCli(["assert", "--trace", SUCCESS_PATH, "--expect-status", "success"], { CI: "1" });
    expect(r.exitCode).toBe(0);
    expect(ANSI.test(r.stdout)).toBe(false);
  }, 15_000);
});
