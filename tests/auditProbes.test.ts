// Regression tests for the eleven findings of the hostile audit of 0.2.1. Each
// block reproduces the audit's probe as closely as the test harness allows and
// asserts the 0.2.2 behavior. Real SDKs run against scripted fake upstreams:
// no network, no real API key.

import { describe, it, expect, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import { blackbox, ReplayDivergenceError } from "../src/index.ts";
import type { BlackboxSession } from "../src/session/session.ts";
import { launchEnv } from "../src/cli/launch.ts";
import { resolveOptions, SESSION_ENV_VARS } from "../src/session/options.ts";
import type { Trace } from "../src/trace/TraceTypes.ts";

const execFileAsync = promisify(execFile);
const ROOT = new URL("../", import.meta.url).pathname;
const CLI = join(ROOT, "src", "cli.ts");
const AGENT = ["node", "--import", "tsx", join(ROOT, "tests", "fixtures", "agents", "weather-agent.ts")];

const DIR = mkdtempSync(join(tmpdir(), "blackbox-probes-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
let fileCounter = 0;
const tmp = (name: string): string => join(DIR, `${++fileCounter}-${name}.json`);
const readTrace = (path: string): Trace => JSON.parse(readFileSync(path, "utf8")) as Trace;

const API_KEY = "sk-test-not-a-real-key-000000";
const noNetwork: typeof fetch = async () => {
  throw new Error("network used during replay");
};

function upstream(responses: object[]): typeof fetch {
  let calls = 0;
  return async () => {
    const next = responses[calls++];
    if (next === undefined) throw new Error("fake upstream: no scripted response");
    return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } });
  };
}

function anthropicMessage(content: object[], stopReason: string, extra: object = {}): object {
  return {
    id: "msg_01FAKEFAKEFAKEFAKEFAKE01",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    ...extra,
  };
}

const client = (bb: BlackboxSession): Anthropic => new Anthropic({ apiKey: API_KEY, fetch: bb.fetch, maxRetries: 0 });
const ask = (bb: BlackboxSession): Promise<Anthropic.Message> =>
  client(bb).messages.create({ model: "claude-sonnet-5", max_tokens: 64, messages: [{ role: "user", content: "Say A." }] });

/** Record a one-call run whose model answers "A": a three-step cassette. */
async function recordAnswerA(finish: { result?: string; error?: unknown } = {}): Promise<string> {
  const path = tmp("answer-a");
  const bb = blackbox({
    mode: "record",
    out: path,
    baseFetch: upstream([anthropicMessage([{ type: "text", text: "A" }], "end_turn")]),
    logErrors: false,
  });
  await ask(bb);
  await bb.finish(finish);
  return path;
}

async function cli(args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", ...env };
  if (env["ANTHROPIC_API_KEY"] === undefined) delete childEnv["ANTHROPIC_API_KEY"];
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ["--import", "tsx", CLI, ...args], { cwd: ROOT, env: childEnv });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

// ---------------------------------------------------------------------------
// #1 — replay compared nothing about how the agent ended the run
// ---------------------------------------------------------------------------

describe("#1 replay checks the agent's outcome against the recording", () => {
  it("probe: finish({result: 'B'}) after a recorded answer 'A' is a divergence, not success", async () => {
    const path = await recordAnswerA();
    expect(readTrace(path).steps).toHaveLength(3);
    const bb = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    await ask(bb);
    const failure = await bb.finish({ result: "B" }).then(() => undefined, (e: unknown) => e);
    expect(failure).toBeInstanceOf(ReplayDivergenceError);
    expect((failure as ReplayDivergenceError).path).toBe("outcome");
    expect((failure as ReplayDivergenceError).expected).toContain('"A"');
    expect((failure as ReplayDivergenceError).actual).toContain('"B"');
  });

  it("probe: finish({error}) after a recorded success is a divergence, not success", async () => {
    const path = await recordAnswerA();
    const bb = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    await ask(bb);
    const failure = await bb.finish({ error: new Error("agent broke") }).then(() => undefined, (e: unknown) => e);
    expect(failure).toBeInstanceOf(ReplayDivergenceError);
    expect((failure as ReplayDivergenceError).path).toBe("outcome");
    expect((failure as ReplayDivergenceError).actual).toContain("agent broke");
  });

  it("the same outcome reproduces: finish() and finish({result: 'A'}) both pass", async () => {
    const path = await recordAnswerA();
    for (const options of [{}, { result: "A" }]) {
      const bb = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
      await ask(bb);
      await expect(bb.finish(options)).resolves.toEqual({ mode: "replay", steps: 3, status: "success", replayedSteps: 3 });
    }
  });

  it("a recorded failure reproduces only with the same error", async () => {
    const path = await recordAnswerA({ error: new Error("boom") });
    const same = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    await ask(same);
    await expect(same.finish({ error: new Error("boom") })).resolves.toMatchObject({ status: "error" });

    const recovered = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    await ask(recovered);
    await expect(recovered.finish()).rejects.toThrow(/outcome/);
  });

  it("the CLI replay fails when the agent reports a different answer", async () => {
    const cassette = join(DIR, "cli-outcome.json");
    const recorded = await cli(["record", "--out", cassette, "--", ...AGENT], { ANTHROPIC_API_KEY: "sk-test-launcher-000000000" });
    expect(recorded.code, recorded.stderr).toBe(0);
    const replayed = await cli(["replay", cassette, "--", ...AGENT], { AGENT_RESULT: "Paris is warmer." });
    expect(replayed.code).not.toBe(0);
    expect(replayed.stderr).toContain("outcome");
    expect(replayed.stderr).not.toContain("✓");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// #3 — sequence mode accepted a run that consumed nothing
// ---------------------------------------------------------------------------

describe("#3 both match modes require every recorded step to be consumed", () => {
  for (const match of ["sequence", "strict"] as const) {
    it(`probe: zero calls then finish() fails in ${match} mode`, async () => {
      const path = await recordAnswerA();
      const bb = new (await import("../src/session/session.ts")).BlackboxSession(
        { baseFetch: noNetwork, logErrors: false },
        { BLACKBOX_MODE: "replay", BLACKBOX_CASSETTE: path, BLACKBOX_MATCH: match },
      );
      const failure = await bb.finish().then(() => undefined, (e: unknown) => e);
      expect(failure).toBeInstanceOf(ReplayDivergenceError);
      expect((failure as ReplayDivergenceError).path).toBe("end of run");
    });
  }

  it("sequence mode also requires the recorded tool calls to run", async () => {
    const path = tmp("tool-run");
    const toolTurn = anthropicMessage(
      [{ type: "tool_use", id: "toolu_01AAAAAAAAAAAAAAAAAAAAAA", name: "lookup", input: { q: "x" } }],
      "tool_use",
    );
    const final = anthropicMessage([{ type: "text", text: "done" }], "end_turn");
    const rec = blackbox({ mode: "record", out: path, baseFetch: upstream([toolTurn, final]), logErrors: false });
    const tools = rec.tools({ lookup: async (input: { q: string }) => ({ found: input.q }) });
    const first = await ask(rec);
    const use = first.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use") as Anthropic.ToolUseBlock;
    const result = await tools.lookup(use.input as { q: string });
    await client(rec).messages.create({
      model: "claude-sonnet-5",
      max_tokens: 64,
      messages: [
        { role: "user", content: "Say A." },
        { role: "assistant", content: first.content },
        { role: "user", content: [{ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result) }] },
      ],
    });
    await rec.finish();

    // Replay in sequence mode, skipping the tool: the second model call is refused.
    const bb = blackbox({ mode: "replay", cassette: path, match: "sequence", baseFetch: noNetwork, logErrors: false });
    const replayedFirst = await ask(bb);
    await expect(
      client(bb).messages.create({
        model: "claude-sonnet-5",
        max_tokens: 64,
        messages: [
          { role: "user", content: "Say A." },
          { role: "assistant", content: replayedFirst.content },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "call-0", content: "{}" }] },
        ],
      }),
    ).rejects.toThrow(/\[blackbox\]/);
    await expect(bb.finish()).rejects.toThrow(/moved on without running it/);
  });

  it("the CLI replay fails when the agent makes no model call", async () => {
    const cassette = join(DIR, "cli-zero.json");
    const recorded = await cli(["record", "--out", cassette, "--", ...AGENT], { ANTHROPIC_API_KEY: "sk-test-launcher-000000000" });
    expect(recorded.code, recorded.stderr).toBe(0);
    const replayed = await cli(["replay", cassette, "--match", "sequence", "--", ...AGENT], { AGENT_SKIP_MODEL: "1" });
    expect(replayed.code).not.toBe(0);
    expect(replayed.stderr).toContain("end of run");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// #10 — the launcher kept stale BLACKBOX_* values from the parent environment
// ---------------------------------------------------------------------------

describe("#10 the launcher owns every BLACKBOX_* variable the session reads", () => {
  it("probe: stale match, out and script values do not survive launchEnv", () => {
    const stale: NodeJS.ProcessEnv = {
      BLACKBOX_MATCH: "sequence",
      BLACKBOX_OUT: "/tmp/stale-out",
      BLACKBOX_SCRIPT: "/tmp/stale-script",
      BLACKBOX_FORK_AT: "3",
      BLACKBOX_FORK_SET: "{}",
      BLACKBOX_CONTINUE: "script",
      BLACKBOX_TRACE_ID: "stale",
      PATH: "/usr/bin",
    };
    const env = launchEnv({ mode: "replay", command: ["node"], cassette: "run.json" }, "/tmp/report.json", stale);
    const options = resolveOptions({}, env);
    expect(options.match).toBe("strict");
    expect(options.out).toBeUndefined();
    expect(options.scriptPath).toBeUndefined();
    expect(options.forkAt).toBeUndefined();
    expect(options.forkSet).toBeUndefined();
    expect(options.continueWith).toBeUndefined();
    expect(options.traceId).toBeUndefined();
    expect(env["PATH"]).toBe("/usr/bin");
  });

  it("every BLACKBOX_* name the session reads is in the launcher's list", () => {
    const source = readFileSync(join(ROOT, "src", "session", "options.ts"), "utf8");
    const read = new Set([...source.matchAll(/envValue\(env, "(BLACKBOX_[A-Z_]+)"\)/g)].map((m) => m[1]));
    expect(read.size).toBeGreaterThan(5);
    for (const name of read) expect(SESSION_ENV_VARS).toContain(name);
  });

  it("the CLI replay is strict even when BLACKBOX_MATCH=sequence is exported", async () => {
    const cassette = join(DIR, "cli-stale.json");
    const recorded = await cli(["record", "--out", cassette, "--", ...AGENT], { ANTHROPIC_API_KEY: "sk-test-launcher-000000000" });
    expect(recorded.code, recorded.stderr).toBe(0);
    const replayed = await cli(["replay", cassette, "--", ...AGENT], { BLACKBOX_MATCH: "sequence", AGENT_PROMPT: "A different prompt" });
    expect(replayed.code).not.toBe(0);
    expect(replayed.stderr).toContain("messages[0].content");
  }, 60_000);
});

// ---------------------------------------------------------------------------
// #6 — finish() ignored calls still running, and calls after it still ran
// ---------------------------------------------------------------------------

describe("#6 finish() and calls still running or started after it", () => {
  function gate(): { wait: Promise<void>; open: () => void } {
    let open!: () => void;
    const wait = new Promise<void>((resolve) => (open = resolve));
    return { wait, open };
  }

  async function answered(): Promise<{ bb: BlackboxSession; path: string; effects: string[]; calls: () => number; tools: { act: (input: { id: string }) => Promise<string> }; gates: ReturnType<typeof gate>[] }> {
    const path = tmp("lifecycle");
    let calls = 0;
    const counting: typeof fetch = async (input, init) => {
      calls++;
      return upstream([anthropicMessage([{ type: "text", text: "A" }], "end_turn")])(input, init);
    };
    const bb = blackbox({ mode: "record", out: path, baseFetch: counting, logErrors: false });
    const effects: string[] = [];
    const gates: ReturnType<typeof gate>[] = [];
    const tools = bb.tools({
      act: async ({ id }: { id: string }) => {
        effects.push(id);
        const g = gate();
        gates.push(g);
        await g.wait;
        return id;
      },
    });
    await ask(bb);
    return { bb, path, effects, calls: () => calls, tools, gates };
  }

  it("probe: finish() while a gated tool runs refuses to write a success cassette", async () => {
    const { bb, path, effects, tools, gates } = await answered();
    const running = tools.act({ id: "first" });
    const failure = await bb.finish().then(() => undefined, (e: unknown) => e);
    expect(String(failure)).toContain("still running");
    expect(() => readFileSync(path)).toThrow();

    // Releasing the gate lets the call that started before finish() return, but
    // a new call is refused and never runs.
    gates[0].open();
    await expect(running).resolves.toBe("first");
    await expect(tools.act({ id: "second" })).rejects.toThrow(/session has finished/);
    expect(effects).toEqual(["first"]);

    // Repeated finish() reports the same failure and still writes nothing.
    await expect(bb.finish()).rejects.toThrow(/still running/);
    expect(() => readFileSync(path)).toThrow();
  });

  it("a model call after finish() is refused and not sent", async () => {
    const { bb, calls } = await answered();
    await bb.finish();
    expect(calls()).toBe(1);
    await expect(ask(bb)).rejects.toThrow(/session has finished/);
    expect(calls()).toBe(1);
  });

  it("a tool call after a successful finish() does not run", async () => {
    const { bb, effects, tools } = await answered();
    await expect(bb.finish()).resolves.toMatchObject({ status: "success" });
    await expect(tools.act({ id: "late" })).rejects.toThrow(/session has finished/);
    expect(effects).toEqual([]);
  });

  it("a replayed tool call after finish() is refused too", async () => {
    const path = await recordAnswerA();
    const bb = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    const tools = bb.tools({ act: async () => "ran" });
    await ask(bb);
    await bb.finish();
    await expect(tools.act()).rejects.toThrow(/session has finished/);
  });

  it("an exit while a tool is still running is recorded as run_failed, not success", async () => {
    const { bb, path, tools, gates } = await answered();
    void tools.act({ id: "never-finishes" });
    bb.writeOnExit(0);
    const trace = readTrace(path);
    expect(trace.steps.at(-1)?.payload).toMatchObject({ event: "run_failed", reason: "calls_in_flight", exitCode: 0, inFlight: 1 });
    gates[0].open();
  });
});

// ---------------------------------------------------------------------------
// #7 — importing a session dropped a trailing unanswered user message
// ---------------------------------------------------------------------------

describe("#7 import keeps a trailing unanswered user message", () => {
  const line = (type: "user" | "assistant", minute: number, message: object): object => ({
    type,
    uuid: `u-${minute}`,
    timestamp: `2026-09-29T10:0${minute}:00.000Z`,
    message,
  });

  async function importLines(events: object[]): Promise<Trace> {
    const { adaptClaudeCodeTranscript, parseClaudeCodeJsonl } = await import("../src/ingest/claudeCodeTranscript.ts");
    return adaptClaudeCodeTranscript(parseClaudeCodeJsonl(events.map((e) => JSON.stringify(e)).join("\n")), { traceId: "probe" });
  }

  it("probe: user → assistant 'old answer' → user 'UNANSWERED' imports as incomplete, message kept", async () => {
    const { replayTrace } = await import("../src/replay/CassetteReplay.ts");
    const { verifyTrace } = await import("../src/trace/verifyTrace.ts");
    const trace = await importLines([
      line("user", 1, { role: "user", content: "first" }),
      line("assistant", 2, { role: "assistant", id: "msg_example_01", content: [{ type: "text", text: "old answer" }] }),
      line("user", 3, { role: "user", content: "UNANSWERED" }),
    ]);
    const last = trace.steps.at(-1);
    expect(last?.type).toBe("model_input");
    expect(JSON.stringify(last?.payload)).toContain("UNANSWERED");
    expect(replayTrace(trace).status).toBe("incomplete");
    expect(replayTrace(trace).result).toBeUndefined();
    expect(verifyTrace(trace).pass).toBe(true);
  });

  it("a session answered to the end still imports as success", async () => {
    const { replayTrace } = await import("../src/replay/CassetteReplay.ts");
    const trace = await importLines([
      line("user", 1, { role: "user", content: "first" }),
      line("assistant", 2, { role: "assistant", id: "msg_example_01", content: [{ type: "text", text: "old answer" }] }),
      line("user", 3, { role: "user", content: "second" }),
      line("assistant", 4, { role: "assistant", id: "msg_example_02", content: [{ type: "text", text: "new answer" }] }),
    ]);
    expect(replayTrace(trace)).toMatchObject({ status: "success", result: "new answer" });
  });

  it("a message typed after a tool was cut off is kept too", async () => {
    const { replayTrace } = await import("../src/replay/CassetteReplay.ts");
    const trace = await importLines([
      line("user", 1, { role: "user", content: "first" }),
      line("assistant", 2, {
        role: "assistant",
        id: "msg_example_01",
        content: [{ type: "tool_use", id: "toolu_example_01", name: "Bash", input: { command: "sleep 100" } }],
      }),
      line("user", 3, { role: "user", content: "stop that" }),
    ]);
    expect(trace.steps.at(-1)?.type).toBe("model_input");
    expect(JSON.stringify(trace.steps.at(-1)?.payload)).toContain("stop that");
    expect(replayTrace(trace).status).toBe("incomplete");
  });

  it("the CLI import reports the session as incomplete", async () => {
    const { writeFileSync } = await import("node:fs");
    const source = join(DIR, "unanswered.jsonl");
    writeFileSync(
      source,
      [
        line("user", 1, { role: "user", content: "first" }),
        line("assistant", 2, { role: "assistant", id: "msg_example_01", content: [{ type: "text", text: "old answer" }] }),
        line("user", 3, { role: "user", content: "UNANSWERED" }),
      ]
        .map((e) => JSON.stringify(e))
        .join("\n"),
    );
    const result = await cli(["import", "--from", "claude-code", "--in", source, "--out", join(DIR, "unanswered.json")]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Status:\s+incomplete/);
  }, 60_000);
});
