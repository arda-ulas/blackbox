// End-to-end CLI launcher tests: `blackbox record|replay|fork -- <command>`
// driving a fixture agent in a child process. The fixture's model upstream is
// canned, so nothing touches the network and no API key is needed.

import { describe, it, expect, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Trace } from "../src/trace/TraceTypes.ts";

const execFileAsync = promisify(execFile);
const ROOT = new URL("../", import.meta.url).pathname;
const CLI = join(ROOT, "src", "cli.ts");
const AGENT = ["node", "--import", "tsx", join(ROOT, "tests", "fixtures", "agents", "weather-agent.ts")];
const DIR = mkdtempSync(join(tmpdir(), "blackbox-launch-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

async function blackbox(args: string[], env: Record<string, string> = {}): Promise<Result> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", ...env };
  delete childEnv["ANTHROPIC_API_KEY"];
  if (env["ANTHROPIC_API_KEY"] !== undefined) childEnv["ANTHROPIC_API_KEY"] = env["ANTHROPIC_API_KEY"];
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ["--import", "tsx", CLI, ...args], { cwd: ROOT, env: childEnv });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

const RECORD_KEY = { ANTHROPIC_API_KEY: "sk-test-launcher-000000000" };
const readTrace = (path: string): Trace => JSON.parse(readFileSync(path, "utf8")) as Trace;

async function record(name: string): Promise<string> {
  const out = join(DIR, `${name}.json`);
  const result = await blackbox(["record", "--out", out, "--", ...AGENT], RECORD_KEY);
  expect(result.code, result.stderr).toBe(0);
  return out;
}

describe("blackbox record -- <command>", () => {
  it("records the agent's run and reports the cassette on stderr", async () => {
    const out = join(DIR, "recorded.json");
    const result = await blackbox(["record", "--out", out, "--", ...AGENT], RECORD_KEY);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("answer: Rome is warmer");
    expect(result.stdout).toContain("upstream calls: 2");
    expect(result.stderr).toContain(`wrote ${out} (9 steps, success)`);
    const trace = readTrace(out);
    expect(trace.id).toBe("recorded");
    expect(JSON.stringify(trace)).not.toContain("sk-test-launcher");
  }, 60_000);

  it("records a crash as run_failed and passes the exit code through", async () => {
    const out = join(DIR, "crash.json");
    const result = await blackbox(["record", "--out", out, "--", ...AGENT], { ...RECORD_KEY, AGENT_CRASH: "1" });
    expect(result.code).toBe(1);
    expect(readTrace(out).steps.at(-1)?.payload).toMatchObject({ event: "run_failed", reason: "process_exit", exitCode: 1 });
  }, 60_000);

  it("explains how to wire in a session when the agent has none", async () => {
    const result = await blackbox([
      "record", "--out", join(DIR, "none.json"), "--", "node", "--import", "tsx", join(ROOT, "tests", "fixtures", "agents", "plain-agent.ts"),
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("pass bb.fetch to your Anthropic or OpenAI client");
  }, 60_000);
});

describe("blackbox replay -- <command>", () => {
  it("re-runs the agent from the cassette with no key and no upstream calls", async () => {
    const cassette = await record("for-replay");
    const result = await blackbox(["replay", cassette, "--", ...AGENT]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("answer: Rome is warmer");
    expect(result.stdout).toContain("upstream calls: 0");
    expect(result.stderr).toContain("PASS  replayed 9 steps");
  }, 60_000);

  it("fails at the first request that differs from the recording", async () => {
    const cassette = await record("for-divergence");
    const result = await blackbox(["replay", cassette, "--", ...AGENT], { AGENT_PROMPT: "Is Oslo or Rome warmer?" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("replay diverged at step 0, messages[0].content");
    expect(result.stderr).toContain("--match sequence");
  }, 60_000);
});

describe("blackbox fork -- <command> + diff", () => {
  it("forks at a tool result with a script and diff finds the divergence at that step", async () => {
    const cassette = await record("for-fork");
    const script = join(DIR, "replies.json");
    writeFileSync(script, JSON.stringify([{ type: "final_answer", text: "Paris is warmer (35°C)." }]));
    const out = join(DIR, "forked.json");
    const fork = await blackbox([
      "fork", cassette, "--at", "3", "--set", '{"city":"Paris","temp":35}', "--out", out, "--script", script, "--", ...AGENT,
    ]);
    expect(fork.code, fork.stderr).toBe(0);
    expect(fork.stdout).toContain("answer: Paris is warmer (35°C).");
    expect(fork.stdout).toContain("upstream calls: 0");
    expect(fork.stderr).toContain(`next: blackbox diff ${cassette} ${out}`);

    const diff = await blackbox(["diff", cassette, out]);
    expect(diff.code).toBe(0);
    expect(diff.stdout).toContain("First divergence at index 3");
    expect(diff.stdout).toContain('"temp":35');
    expect(diff.stdout).toContain("final answer changed");

    const verify = await blackbox(["verify", out]);
    expect(verify.code).toBe(0);
  }, 90_000);

  it("rejects a fork step that is not a tool result before launching", async () => {
    const cassette = await record("for-bad-fork");
    const result = await blackbox(["fork", cassette, "--at", "1", "--set", "{}", "--out", join(DIR, "x.json"), "--live", "--", "false"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--at must be a tool_result step (3, 5 in this cassette)");
  }, 60_000);

  it("requires choosing --live or --script", async () => {
    const cassette = await record("for-no-continue");
    const result = await blackbox(["fork", cassette, "--at", "3", "--set", "{}", "--out", join(DIR, "y.json"), "--", "false"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--live (your real API client) or --script <replies.json>");
  }, 60_000);
});

describe("Ctrl-C and argument handling", () => {
  it("writes the recording when the agent is interrupted before finish()", async () => {
    const out = join(DIR, "interrupted.json");
    const result = await blackbox(["record", "--out", out, "--", ...AGENT], { ...RECORD_KEY, AGENT_SIGINT: "1" });
    expect(result.code).toBe(130);
    const trace = readTrace(out);
    expect(trace.steps.filter((s) => s.type === "model_output")).toHaveLength(2);
    expect(trace.steps.at(-1)?.payload).toMatchObject({ event: "run_failed", reason: "process_exit", exitCode: 130 });
  }, 60_000);
});
