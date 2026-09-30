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
import { blackbox, BlackboxUnsupportedError, ReplayDivergenceError } from "../src/index.ts";
import type { BlackboxSession } from "../src/session/session.ts";
import { launchEnv } from "../src/cli/launch.ts";
import { resolveOptions, SESSION_ENV_VARS, type BlackboxOptions } from "../src/session/options.ts";
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

// ---------------------------------------------------------------------------
// #8 — raw input values in diagnostics, and imports that kept the API key
// ---------------------------------------------------------------------------

describe("#8 diagnostics never quote raw input, and import refuses your API key", () => {
  const SECRET = "SYNTHETIC_SECRET";

  async function recordedCassette(): Promise<string> {
    const path = await recordAnswerA();
    return path;
  }

  it("probe: a malformed --set @file is reported without its content", async () => {
    const { writeFileSync } = await import("node:fs");
    const cassette = join(DIR, "set-parent.json");
    const recorded = await cli(["record", "--out", cassette, "--", ...AGENT], { ANTHROPIC_API_KEY: "sk-test-launcher-000000000" });
    expect(recorded.code, recorded.stderr).toBe(0);
    const bad = join(DIR, "bad-set.json");
    writeFileSync(bad, `${SECRET}_NOT_JSON`);
    const script = join(DIR, "replies.json");
    writeFileSync(script, "[]");
    const result = await cli(["fork", cassette, "--at", "3", "--set", `@${bad}`, "--out", join(DIR, "never.json"), "--script", script, "--", ...AGENT]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("is not valid JSON");
    expect(result.stderr + result.stdout).not.toContain(SECRET);
  }, 60_000);

  it("probe: a corrupted hash is reported without the stored value, even when it is the supplied key", async () => {
    const { verifyTrace } = await import("../src/trace/verifyTrace.ts");
    const trace = readTrace(await recordedCassette());
    trace.steps[1].hash = SECRET;
    for (const report of [verifyTrace(trace), verifyTrace(trace, { apiKey: SECRET })]) {
      expect(report.pass).toBe(false);
      expect(report.firstFailure?.name).toBe("hash_chain");
      expect(JSON.stringify(report)).not.toContain(SECRET);
    }
  });

  it("corrupted prevHash and index values are not quoted either", async () => {
    const { verifyTrace } = await import("../src/trace/verifyTrace.ts");
    const base = readTrace(await recordedCassette());
    const first = structuredClone(base);
    (first.steps[0] as { prevHash: unknown }).prevHash = SECRET;
    const later = structuredClone(base);
    later.steps[2].prevHash = SECRET;
    const index = structuredClone(base);
    (index.steps[1] as { index: unknown }).index = SECRET;
    for (const trace of [first, later, index]) {
      const report = verifyTrace(trace);
      expect(report.firstFailure?.name).toBe("hash_chain");
      expect(JSON.stringify(report)).not.toContain(SECRET);
    }
  });

  it("the CLI verify and the session report a malformed cassette without its content", async () => {
    const { writeFileSync } = await import("node:fs");
    const bad = join(DIR, "not-json-cassette.json");
    // Short enough that a raw JSON.parse message would quote all of it.
    writeFileSync(bad, SECRET);
    const verified = await cli(["verify", bad]);
    expect(verified.code).not.toBe(0);
    expect(verified.stdout + verified.stderr).toContain("not valid JSON");
    expect(verified.stdout + verified.stderr).not.toContain(SECRET);

    const failure = (() => {
      try {
        blackbox({ mode: "replay", cassette: bad, logErrors: false });
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(String(failure)).toContain("not valid JSON");
    expect(String(failure)).not.toContain(SECRET);
  }, 60_000);

  it("a malformed fork script is reported without its content", async () => {
    const { writeFileSync } = await import("node:fs");
    const script = join(DIR, "bad-script.json");
    writeFileSync(script, `[${SECRET}]`);
    const path = tmp("fork-parent");
    const toolTurn = anthropicMessage(
      [{ type: "tool_use", id: "toolu_01AAAAAAAAAAAAAAAAAAAAAA", name: "lookup", input: { q: "x" } }],
      "tool_use",
    );
    const rec = blackbox({ mode: "record", out: path, baseFetch: upstream([toolTurn]), logErrors: false });
    const tools = rec.tools({ lookup: async (_input: { q: string }) => ({ found: 1 }) });
    await ask(rec);
    await tools.lookup({ q: "x" });
    await rec.finish();

    const { BlackboxSession } = await import("../src/session/session.ts");
    const bb = new BlackboxSession(
      { baseFetch: noNetwork, logErrors: false },
      { BLACKBOX_MODE: "fork", BLACKBOX_CASSETTE: path, BLACKBOX_OUT: tmp("fork-out"), BLACKBOX_FORK_AT: "3", BLACKBOX_FORK_SET: "2", BLACKBOX_CONTINUE: "script", BLACKBOX_SCRIPT: script },
    );
    const forkTools = bb.tools({ lookup: async (_input: { q: string }) => ({ found: 1 }) });
    await ask(bb);
    await forkTools.lookup({ q: "x" });
    await expect(
      client(bb).messages.create({ model: "claude-sonnet-5", max_tokens: 64, messages: [{ role: "user", content: "Say A." }] }),
    ).rejects.toThrow(/\[blackbox\]/);
    const failure = await bb.finish().then(() => undefined, (e: unknown) => e);
    expect(String(failure)).toContain("not valid JSON");
    expect(String(failure)).not.toContain(SECRET);
  });

  it("probe: import refuses a transcript that contains the environment's API key, as record does", async () => {
    const { writeFileSync, existsSync } = await import("node:fs");
    const key = "opaque-synthetic-key-without-a-known-shape";
    const source = join(DIR, "leaky.jsonl");
    writeFileSync(
      source,
      [
        { type: "user", timestamp: "2026-09-29T10:01:00.000Z", message: { role: "user", content: `my key is ${key}` } },
        { type: "assistant", timestamp: "2026-09-29T10:02:00.000Z", message: { role: "assistant", id: "msg_example_01", content: [{ type: "text", text: "noted" }] } },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n"),
    );
    const out = join(DIR, "leaky.json");
    const result = await cli(["import", "--from", "claude-code", "--in", source, "--out", out], { ANTHROPIC_API_KEY: key });
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("contains your API key (the value of ANTHROPIC_API_KEY)");
    expect(result.stdout + result.stderr).not.toContain(key);
    expect(existsSync(out)).toBe(false);

    // Without the key in the environment the same transcript imports.
    const clean = await cli(["import", "--from", "claude-code", "--in", source, "--out", out]);
    expect(clean.code, clean.stdout).toBe(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// #5 — the session API let a fork write over its own parent cassette
// ---------------------------------------------------------------------------

describe("#5 a fork refuses to write over the cassette it forks", () => {
  async function toolCassette(): Promise<string> {
    const path = tmp("fork-parent");
    const toolTurn = anthropicMessage(
      [{ type: "tool_use", id: "toolu_01AAAAAAAAAAAAAAAAAAAAAA", name: "lookup", input: { q: "x" } }],
      "tool_use",
    );
    const rec = blackbox({ mode: "record", out: path, baseFetch: upstream([toolTurn]), logErrors: false });
    const tools = rec.tools({ lookup: async (_input: { q: string }) => 1 });
    await ask(rec);
    await tools.lookup({ q: "x" });
    await rec.finish();
    return path;
  }

  const forkOptions = (cassette: string, out: string): BlackboxOptions => ({
    mode: "fork",
    cassette,
    out,
    forkAt: 3,
    forkSet: 2,
    continueWith: "script",
    script: [{ type: "final_answer", text: "done" }],
    baseFetch: noNetwork,
    logErrors: false,
  });

  it("probe: out === cassette is refused before anything runs, and the parent is unchanged", async () => {
    const path = await toolCassette();
    const before = readFileSync(path, "utf8");
    expect(() => blackbox(forkOptions(path, path))).toThrow(/same file/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("another spelling, a symlink and a hard link to the parent are refused too", async () => {
    const { symlinkSync, linkSync } = await import("node:fs");
    const { dirname, basename } = await import("node:path");
    const path = await toolCassette();
    const symlink = join(DIR, "link-to-parent.json");
    symlinkSync(path, symlink);
    const hardlink = join(DIR, "hardlink-to-parent.json");
    linkSync(path, hardlink);
    const spelled = join(dirname(path), ".", "..", basename(dirname(path)), basename(path));
    for (const out of [spelled, symlink, hardlink]) {
      expect(() => blackbox(forkOptions(path, out)), out).toThrow(/same file/);
    }
  });

  it("a different out path still forks", async () => {
    const path = await toolCassette();
    const out = tmp("fork-child");
    const bb = blackbox(forkOptions(path, out));
    const tools = bb.tools({ lookup: async (_input: { q: string }) => 1 });
    await ask(bb);
    await expect(tools.lookup({ q: "x" })).resolves.toBe(2);
    await ask(bb);
    await expect(bb.finish()).resolves.toMatchObject({ mode: "fork", status: "success" });
    expect(readTrace(out).parentId).toBe(readTrace(path).id);
  });
});

// ---------------------------------------------------------------------------
// #2 / #4 — request and response fields the neutral schema dropped silently
// ---------------------------------------------------------------------------

describe("#2 / #4 fields the cassette cannot carry are refused, never replayed altered", () => {
  const openaiCompletion = (message: object, finishReason: string): object => ({
    id: "chatcmpl-FAKEFAKEFAKE",
    object: "chat.completion",
    created: 1_790_000_000,
    model: "gpt-5",
    choices: [{ index: 0, message: { role: "assistant", content: null, refusal: null, ...message }, finish_reason: finishReason, logprobs: null }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });

  async function recordOpenAI(response: object, request: Record<string, unknown> = {}): Promise<{ agentError: unknown; finishError: unknown; path: string }> {
    const OpenAI = (await import("openai")).default;
    const path = tmp("openai-refused");
    const bb = blackbox({ mode: "record", out: path, baseFetch: upstream([response]), logErrors: false });
    const openai = new OpenAI({ apiKey: API_KEY, fetch: bb.fetch, maxRetries: 0 });
    const agentError = await openai.chat.completions
      .create({ model: "gpt-5", messages: [{ role: "user", content: "hi" }], ...request } as never)
      .then(() => undefined, (e: unknown) => e);
    const finishError = await bb.finish().then(() => undefined, (e: unknown) => e);
    return { agentError, finishError, path };
  }

  async function recordAnthropic(response: object, request: Record<string, unknown> = {}): Promise<{ agentError: unknown; finishError: unknown; path: string }> {
    const path = tmp("anthropic-refused");
    const bb = blackbox({ mode: "record", out: path, baseFetch: upstream([response]), logErrors: false });
    const agentError = await client(bb)
      .messages.create({ model: "claude-sonnet-5", max_tokens: 64, messages: [{ role: "user", content: "hi" }], ...request } as never)
      .then(() => undefined, (e: unknown) => e);
    const finishError = await bb.finish().then(() => undefined, (e: unknown) => e);
    return { agentError, finishError, path };
  }

  function expectRefused(result: { agentError: unknown; finishError: unknown; path: string }, what: RegExp): void {
    expect(String(result.agentError)).toMatch(/\[blackbox\]/);
    expect(result.finishError).toBeInstanceOf(BlackboxUnsupportedError);
    expect(String(result.finishError)).toMatch(what);
    expect(() => readFileSync(result.path)).toThrow();
  }

  const OK = openaiCompletion({ content: "hi" }, "stop");

  describe("probe #2: request fields that used to normalize identically", () => {
    it("OpenAI audio output settings", async () => {
      expectRefused(await recordOpenAI(OK, { modalities: ["text", "audio"], audio: { voice: "alloy", format: "wav" } }), /audio request field/);
    });

    it("OpenAI strict function tools (strict: false records like no strict)", async () => {
      const tool = (strict: boolean) => ({ type: "function", function: { name: "f", parameters: { type: "object" }, strict } });
      expectRefused(await recordOpenAI(OK, { tools: [tool(true)] }), /tools\[0\]\.function\.strict/);
      const relaxed = await recordOpenAI(OK, { tools: [tool(false)] });
      expect(relaxed.finishError).toBeUndefined();
    });

    it("an OpenAI message name", async () => {
      expectRefused(await recordOpenAI(OK, { messages: [{ role: "user", content: "hi", name: "alice" }] }), /messages\[0\]\.name/);
    });

    it("Anthropic strict tools", async () => {
      const final = anthropicMessage([{ type: "text", text: "hi" }], "end_turn");
      expectRefused(
        await recordAnthropic(final, { tools: [{ name: "f", description: "", input_schema: { type: "object" }, strict: true }] }),
        /tools\[0\]\.strict/,
      );
    });

    it("a replay whose request adds audio settings is refused, not served", async () => {
      const OpenAI = (await import("openai")).default;
      const path = tmp("openai-plain");
      const rec = blackbox({ mode: "record", out: path, baseFetch: upstream([OK]), logErrors: false });
      await new OpenAI({ apiKey: API_KEY, fetch: rec.fetch, maxRetries: 0 }).chat.completions.create({ model: "gpt-5", messages: [{ role: "user", content: "hi" }] });
      await rec.finish();

      const bb = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
      const openai = new OpenAI({ apiKey: API_KEY, fetch: bb.fetch, maxRetries: 0 });
      await expect(
        openai.chat.completions.create({ model: "gpt-5", messages: [{ role: "user", content: "hi" }], audio: { voice: "alloy", format: "wav" } } as never),
      ).rejects.toThrow(/audio request field/);
      await expect(bb.finish()).rejects.toBeInstanceOf(BlackboxUnsupportedError);
    });
  });

  describe("probe #4: response fields that used to replay changed", () => {
    it("OpenAI audio in the response", async () => {
      const audio = openaiCompletion({ content: null, audio: { id: "audio_1", data: "AAAA", expires_at: 1, transcript: "hi" } }, "stop");
      expectRefused(await recordOpenAI(audio), /audio in a response/);
    });

    it("an OpenAI legacy function_call response", async () => {
      const legacy = openaiCompletion({ function_call: { name: "f", arguments: "{}" } }, "function_call");
      expectRefused(await recordOpenAI(legacy), /legacy function_call/);
    });

    it("an OpenAI content_filter finish reason (it used to become stop)", async () => {
      expectRefused(await recordOpenAI(openaiCompletion({ content: "partial" }, "content_filter")), /content_filter/);
    });

    it("an Anthropic stop_sequence stop (it used to become end_turn with no sequence)", async () => {
      const stopped = anthropicMessage([{ type: "text", text: "A" }], "stop_sequence", { stop_sequence: "END" });
      expectRefused(await recordAnthropic(stopped), /stop_sequence/);
    });

    it("an Anthropic response with text blocks A and B (it used to become one block 'A\\n\\nB')", async () => {
      const split = anthropicMessage([{ type: "text", text: "A" }, { type: "text", text: "B" }], "end_turn");
      expectRefused(await recordAnthropic(split), /more than one text block/);
    });

    it("an Anthropic model_context_window_exceeded stop (it used to become max_tokens)", async () => {
      const full = anthropicMessage([{ type: "text", text: "A" }], "model_context_window_exceeded");
      expectRefused(await recordAnthropic(full), /model_context_window_exceeded/);
    });

    it("other response fields a replay would drop are refused too", async () => {
      const withLogprobs = {
        ...(OK as Record<string, unknown>),
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "hi", refusal: null },
            finish_reason: "stop",
            logprobs: { content: [{ token: "hi", logprob: -0.1, bytes: null, top_logprobs: [] }], refusal: null },
          },
        ],
      };
      expectRefused(await recordOpenAI(withLogprobs), /logprobs in a response/);
      expectRefused(
        await recordOpenAI(openaiCompletion({ content: "hi", annotations: [{ type: "url_citation", url_citation: { url: "https://example.com", title: "t", start_index: 0, end_index: 2 } }] }, "stop")),
        /annotations/,
      );
      expectRefused(await recordOpenAI(openaiCompletion({ content: "partial", refusal: "no" }, "stop")), /a refusal together with content/);
      expectRefused(await recordOpenAI(OK, { web_search_options: {} }), /web_search_options/);
      expectRefused(
        await recordAnthropic(anthropicMessage([{ type: "text", text: "A", citations: [{ type: "char_location", cited_text: "A", document_index: 0, start_char_index: 0, end_char_index: 1 }] }], "end_turn")),
        /citations/,
      );
      expectRefused(
        await recordAnthropic(anthropicMessage([{ type: "text", text: "no" }], "refusal", { stop_details: { type: "refusal", category: "cyber", explanation: "x" } })),
        /stop_details/,
      );
    });

    it("one text block, then tool calls, still records and replays unchanged", async () => {
      const path = await recordAnswerA();
      const bb = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
      const response = await ask(bb);
      expect(response.content).toEqual([{ type: "text", text: "A", citations: null }]);
      expect(response.stop_reason).toBe("end_turn");
      await expect(bb.finish()).resolves.toMatchObject({ status: "success" });
    });
  });
});

// ---------------------------------------------------------------------------
// #11 — the live proof failed inside the SDK when the key was missing
// ---------------------------------------------------------------------------

describe("#11 the live proof checks the provider's key before it starts", () => {
  async function proof(args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) if (env[name] === undefined) delete childEnv[name];
    try {
      const { stdout, stderr } = await execFileAsync("bash", [join(ROOT, "scripts", "live-proof.sh"), ...args], { cwd: ROOT, env: childEnv });
      return { code: 0, stdout, stderr };
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string };
      return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  }

  for (const [provider, key] of [["anthropic", "ANTHROPIC_API_KEY"], ["openai", "OPENAI_API_KEY"]] as const) {
    it(`probe: ${provider} without ${key} exits 1 with a one-line instruction and no stack`, async () => {
      const result = await proof([provider]);
      expect(result.code).toBe(1);
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
      expect(result.stderr).toContain(`export ${key}=`);
      expect(result.stderr).not.toMatch(/\bat \S+:\d+:\d+/);
      expect(result.stdout).toBe("");
    });
  }

  it("an unknown provider prints the usage", async () => {
    const result = await proof(["gemini"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("usage: scripts/live-proof.sh anthropic|openai");
  });
});

// ---------------------------------------------------------------------------
// Variants found while verifying the 0.2.2 fixes
// ---------------------------------------------------------------------------

describe("variants: a tool running across a model call (#6)", () => {
  async function toolTurnSession(): Promise<{ bb: BlackboxSession; path: string; tools: { notify: (input: { to: string }) => Promise<string> }; effects: string[]; release: () => void }> {
    const path = tmp("tool-across-call");
    const toolTurn = anthropicMessage([{ type: "tool_use", id: "toolu_01AAAAAAAAAAAAAAAAAAAAAA", name: "notify", input: { to: "ops" } }], "tool_use");
    const final = anthropicMessage([{ type: "text", text: "done" }], "end_turn");
    const bb = blackbox({ mode: "record", out: path, baseFetch: upstream([toolTurn, final]), logErrors: false });
    const effects: string[] = [];
    let release!: () => void;
    const gateOpen = new Promise<void>((resolve) => (release = resolve));
    const tools = bb.tools({
      notify: async ({ to }: { to: string }) => {
        effects.push(to);
        await gateOpen;
        return "sent";
      },
    });
    return { bb, path, tools, effects, release };
  }

  it("a fire-and-forget tool still running at the next model call is refused, and nothing is written", async () => {
    const { bb, path, tools, release } = await toolTurnSession();
    await ask(bb);
    const running = tools.notify({ to: "ops" });
    await expect(ask(bb)).rejects.toThrow(/still running/);
    release();
    await running;
    await expect(bb.finish()).rejects.toBeInstanceOf(BlackboxUnsupportedError);
    expect(() => readFileSync(path)).toThrow();
  });

  it("a tool started while a model call is in flight is refused when the call returns", async () => {
    const { bb, path, tools, release } = await toolTurnSession();
    const call = ask(bb);
    const running = tools.notify({ to: "ops" });
    await expect(call).rejects.toThrow(/still running/);
    release();
    await running;
    await expect(bb.finish()).rejects.toBeInstanceOf(BlackboxUnsupportedError);
    expect(() => readFileSync(path)).toThrow();
  });

  it("a finish() after the process-exit write is refused and does not rewrite the cassette", async () => {
    const { bb, path, tools, release } = await toolTurnSession();
    await ask(bb);
    void tools.notify({ to: "ops" });
    bb.writeOnExit(130);
    const written = readFileSync(path, "utf8");
    release();
    await expect(bb.finish()).rejects.toThrow(/already ended/);
    expect(readFileSync(path, "utf8")).toBe(written);
  });
});

describe("variants: the CLI checks what the session actually did (#5, #10)", () => {
  async function recorded(name: string): Promise<string> {
    const cassette = join(DIR, `${name}.json`);
    const result = await cli(["record", "--out", cassette, "--", ...AGENT], { ANTHROPIC_API_KEY: "sk-test-launcher-000000000" });
    expect(result.code, result.stderr).toBe(0);
    return cassette;
  }

  it("a replay whose agent records instead (explicit options in code) fails, not PASS", async () => {
    const cassette = await recorded("explicit-replay");
    const other = join(DIR, "explicit-replay-elsewhere.json");
    const result = await cli(["replay", cassette, "--", ...AGENT], { AGENT_EXPLICIT_MODE: "record", AGENT_EXPLICIT_OUT: other });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("override the CLI");
    expect(result.stderr).not.toContain("✓");
  }, 60_000);

  it("a record whose agent writes another file fails, not 'wrote <out>'", async () => {
    const out = join(DIR, "explicit-record.json");
    const other = join(DIR, "explicit-record-elsewhere.json");
    const result = await cli(["record", "--out", out, "--", ...AGENT], { ANTHROPIC_API_KEY: "sk-test-launcher-000000000", AGENT_EXPLICIT_OUT: other });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("override the CLI");
  }, 60_000);

  it("a replay that diverges and crashes the agent reports the divergence, not a missing session", async () => {
    const cassette = await recorded("crash-divergence");
    const result = await cli(["replay", cassette, "--", ...AGENT], { AGENT_PROMPT: "A different prompt" });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("replay diverged");
    expect(result.stderr).not.toContain("without a Blackbox");
  }, 60_000);

  it("fork refuses an --out that is its --script file", async () => {
    const { writeFileSync } = await import("node:fs");
    const cassette = await recorded("fork-script-out");
    const script = join(DIR, "fork-script-out-replies.json");
    writeFileSync(script, "[]");
    const result = await cli(["fork", cassette, "--at", "3", "--set", "1", "--out", script, "--script", script, "--", ...AGENT]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--out must differ from the --script file");
    expect(readFileSync(script, "utf8")).toBe("[]");
  }, 60_000);
});

describe("variants: response fields and requests (#2, #4)", () => {
  const completion = (choice: object): object => ({
    id: "chatcmpl-FAKEFAKEFAKE",
    object: "chat.completion",
    created: 1_790_000_000,
    model: "gpt-5",
    choices: [{ index: 0, logprobs: null, ...choice }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });

  async function openaiRoundTrip(response: object, request: Record<string, unknown> = {}): Promise<{ recorded?: unknown; replayed?: unknown; error?: unknown }> {
    const OpenAI = (await import("openai")).default;
    const path = tmp("openai-roundtrip");
    const rec = blackbox({ mode: "record", out: path, baseFetch: upstream([response]), logErrors: false });
    const body = { model: "gpt-5", messages: [{ role: "user", content: "hi" }], ...request } as never;
    let recorded: unknown;
    try {
      recorded = await new OpenAI({ apiKey: API_KEY, fetch: rec.fetch, maxRetries: 0 }).chat.completions.create(body);
      await rec.finish();
    } catch (error) {
      return { error: await rec.finish().then(() => error, (e: unknown) => e) };
    }
    const bb = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    const replayed = await new OpenAI({ apiKey: API_KEY, fetch: bb.fetch, maxRetries: 0 }).chat.completions.create(body);
    await bb.finish();
    return { recorded, replayed };
  }

  it("tool calls that ended with finish_reason stop (a forced tool_choice) are refused", async () => {
    const forced = completion({
      message: { role: "assistant", content: null, refusal: null, tool_calls: [{ id: "call_abc", type: "function", function: { name: "f", arguments: "{}" } }] },
      finish_reason: "stop",
    });
    const { error } = await openaiRoundTrip(forced, { tool_choice: { type: "function", function: { name: "f" } } });
    expect(error).toBeInstanceOf(BlackboxUnsupportedError);
    expect(String(error)).toContain("finish_reason");
  });

  it("an empty final answer replays as an empty string, not null", async () => {
    const empty = completion({ message: { role: "assistant", content: "", refusal: null }, finish_reason: "length" });
    const { recorded, replayed } = await openaiRoundTrip(empty);
    const text = (r: unknown): unknown => (r as { choices: Array<{ message: { content: unknown } }> }).choices[0].message.content;
    expect(text(recorded)).toBe("");
    expect(text(replayed)).toBe("");
  });

  it("a JSON-encoded string argument keeps its encoding on replay", async () => {
    const encoded = JSON.stringify(JSON.stringify({ a: 1 }));
    const call = completion({
      message: { role: "assistant", content: null, refusal: null, tool_calls: [{ id: "call_abc", type: "function", function: { name: "f", arguments: encoded } }] },
      finish_reason: "tool_calls",
    });
    const { replayed } = await openaiRoundTrip(call);
    const args = (replayed as { choices: Array<{ message: { tool_calls: Array<{ function: { arguments: string } }> } }> }).choices[0].message.tool_calls[0].function.arguments;
    expect(args).toBe(encoded);
  });

  it("a request with both max_tokens and max_completion_tokens is refused", async () => {
    const { error } = await openaiRoundTrip(completion({ message: { role: "assistant", content: "hi", refusal: null }, finish_reason: "stop" }), {
      max_tokens: 10,
      max_completion_tokens: 20,
    });
    expect(String(error)).toContain("both max_tokens and max_completion_tokens");
  });
});

describe("variants: diagnostics and keys (#8)", () => {
  it("import refuses the environment key even with surrounding whitespace", async () => {
    const { writeFileSync, existsSync } = await import("node:fs");
    const key = "opaque-synthetic-key-with-padding";
    const source = join(DIR, "padded.jsonl");
    writeFileSync(
      source,
      [
        { type: "user", timestamp: "2026-09-29T10:01:00.000Z", message: { role: "user", content: `key ${key}` } },
        { type: "assistant", timestamp: "2026-09-29T10:02:00.000Z", message: { role: "assistant", id: "msg_example_01", content: [{ type: "text", text: "ok" }] } },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n"),
    );
    const out = join(DIR, "padded.json");
    const result = await cli(["import", "--from", "claude-code", "--in", source, "--out", out], { ANTHROPIC_API_KEY: `  ${key}\n` });
    expect(result.code).toBe(1);
    expect(existsSync(out)).toBe(false);
  }, 60_000);

  it("an importer error does not print an object key from the source", async () => {
    const { adaptForeignTranscript } = await import("../src/ingest/foreignTranscript.ts");
    const { parseJson } = await import("../src/trace/parseJson.ts");
    const key = "SYNTHETIC_SECRET_KEY_NAME";
    const transcript = parseJson(
      JSON.stringify({
        messages: [
          { role: "user", content: "hi", timestamp: 1 },
          { role: "assistant", content: null, timestamp: 2, tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: `{"${key}": 1e400}` } }] },
          { role: "tool", tool_call_id: "c1", content: "ok", timestamp: 3 },
          { role: "assistant", content: "done", timestamp: 4 },
        ],
      }),
      "transcript",
    );
    expect(() => adaptForeignTranscript(transcript, { traceId: "t" })).toThrow(/number must be finite/);
    try {
      adaptForeignTranscript(transcript, { traceId: "t" });
    } catch (error) {
      expect(String(error)).not.toContain(key);
    }
  });

  it("verify rejects an unknown step type without quoting it", async () => {
    const { verifyTrace } = await import("../src/trace/verifyTrace.ts");
    const { hashTraceStepInput } = await import("../src/trace/hash.ts");
    const trace = readTrace(await recordAnswerA());
    const step = trace.steps[2];
    (step as { type: string }).type = "SYNTHETIC_SECRET_TYPE";
    step.hash = hashTraceStepInput({ index: step.index, type: step.type, timestamp: step.timestamp, payload: step.payload, prevHash: step.prevHash });
    const report = verifyTrace(trace);
    expect(report.pass).toBe(false);
    expect(JSON.stringify(report)).not.toContain("SYNTHETIC_SECRET_TYPE");
  });
});

// ---------------------------------------------------------------------------
// Variants found in the second verification round and the pre-release audit
// ---------------------------------------------------------------------------

describe("variants: tool values JSON would lose (#6 class)", () => {
  async function recordToolArg(arg: unknown, result: unknown = "ok"): Promise<{ path: string; finish: unknown; call: unknown; runs: number }> {
    const path = tmp("tool-values");
    const toolTurn = anthropicMessage([{ type: "tool_use", id: "toolu_01AAAAAAAAAAAAAAAAAAAAAA", name: "fetch_page", input: { url: "x" } }], "tool_use");
    const rec = blackbox({ mode: "record", out: path, baseFetch: upstream([toolTurn]), logErrors: false });
    let runs = 0;
    const tools = rec.tools({ fetch_page: async (_input: unknown) => (runs++, result) });
    await ask(rec);
    const call = await tools.fetch_page(arg).then(() => undefined, (e: unknown) => e);
    const finish = await rec.finish().then(() => undefined, (e: unknown) => e);
    return { path, finish, call, runs };
  }

  it("a Date or URL argument is recorded as its JSON form, so a changed one diverges on strict replay", async () => {
    const { path, finish } = await recordToolArg(new URL("https://example.com/a"));
    expect(finish).toBeUndefined();
    expect(JSON.stringify(readTrace(path).steps)).toContain("https://example.com/a");
    const bb = blackbox({ mode: "replay", cassette: path, baseFetch: noNetwork, logErrors: false });
    const tools = bb.tools({ fetch_page: async (_input: unknown) => "ok" });
    await ask(bb);
    await expect(tools.fetch_page(new URL("https://example.com/b"))).rejects.toBeInstanceOf(ReplayDivergenceError);
  });

  it("a Map argument is refused before the tool runs, and the run fails", async () => {
    const { call, finish, runs, path } = await recordToolArg(new Map([["a", 1]]));
    expect(call).toBeInstanceOf(BlackboxUnsupportedError);
    expect(String(call)).toContain("Map");
    expect(runs).toBe(0);
    expect(finish).toBeInstanceOf(BlackboxUnsupportedError);
    expect(() => readFileSync(path)).toThrow();
  });

  it("a result that would be stored as {} (a Set) fails the run", async () => {
    const { call, finish } = await recordToolArg("x", new Set([1]));
    expect(call).toBeInstanceOf(BlackboxUnsupportedError);
    expect(finish).toBeInstanceOf(BlackboxUnsupportedError);
  });
});

describe("variants: one session per CLI run, reports and masking (#5, #8, #10)", () => {
  it("a second session under the launcher is refused, and no session of that run reports success", async () => {
    const { BlackboxSession } = await import("../src/session/session.ts");
    const report = join(DIR, "shared-report.json");
    const env = { BLACKBOX_MODE: "record", BLACKBOX_OUT: tmp("shared-out"), BLACKBOX_REPORT: report };
    const final = anthropicMessage([{ type: "text", text: "A" }], "end_turn");
    const first = new BlackboxSession({ baseFetch: upstream([final]), logErrors: false }, env);
    expect(() => new BlackboxSession({ baseFetch: upstream([final]), logErrors: false }, env)).toThrow(/second blackbox\(\) session/);
    await ask(first);
    await first.finish();
    expect(JSON.parse(readFileSync(report, "utf8"))).toMatchObject({ ok: false });
  });

  it("a report path that is the cassette is refused", async () => {
    const path = await recordAnswerA();
    const before = readFileSync(path, "utf8");
    expect(() => blackbox({ mode: "replay", cassette: path, reportPath: path, logErrors: false })).toThrow(/report path/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("the CLI replay fails when the agent sets match: sequence in code", async () => {
    const cassette = join(DIR, "explicit-match.json");
    const recorded = await cli(["record", "--out", cassette, "--", ...AGENT], { ANTHROPIC_API_KEY: "sk-test-launcher-000000000" });
    expect(recorded.code, recorded.stderr).toBe(0);
    const result = await cli(["replay", cassette, "--match", "strict", "--", ...AGENT], { AGENT_EXPLICIT_MATCH: "sequence", AGENT_PROMPT: "changed" });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("override the CLI");
    expect(result.stderr).not.toContain("✓");
  }, 60_000);

  it("a known key straddling the 200-character cut is masked before it is cut", async () => {
    const { BlackboxSession } = await import("../src/session/session.ts");
    const key = "opaque-synthetic-key-0123456789-abcdefghij";
    const path = await recordAnswerA();
    const bb = new BlackboxSession({ baseFetch: noNetwork, logErrors: false }, { BLACKBOX_MODE: "replay", BLACKBOX_CASSETTE: path, ANTHROPIC_API_KEY: key });
    await client(bb)
      .messages.create({ model: "claude-sonnet-5", max_tokens: 64, messages: [{ role: "user", content: `${"a".repeat(180)}${key}` }] })
      .catch(() => undefined);
    const failure = await bb.finish().then(() => undefined, (e: unknown) => e);
    expect(failure).toBeInstanceOf(ReplayDivergenceError);
    expect(String(failure)).not.toContain(key.slice(0, 12));
  });
});

describe("variants: refusals and content forms (#2, #4)", () => {
  const completion = (message: object, finishReason: string): object => ({
    id: "chatcmpl-FAKEFAKEFAKE",
    object: "chat.completion",
    created: 1_790_000_000,
    model: "gpt-5",
    choices: [{ index: 0, logprobs: null, message: { role: "assistant", refusal: null, ...message }, finish_reason: finishReason }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });

  async function recordOpenAIResponse(response: object, messages: object[] = [{ role: "user", content: "hi" }]): Promise<unknown> {
    const OpenAI = (await import("openai")).default;
    const bb = blackbox({ mode: "record", out: tmp("openai-forms"), baseFetch: upstream([response]), logErrors: false });
    await new OpenAI({ apiKey: API_KEY, fetch: bb.fetch, maxRetries: 0 }).chat.completions.create({ model: "gpt-5", messages } as never).catch(() => undefined);
    return bb.finish().then(() => undefined, (e: unknown) => e);
  }

  it("a final answer with null content is refused (a replay would return an empty string)", async () => {
    for (const finish of ["stop", "length"]) {
      expect(await recordOpenAIResponse(completion({ content: null }, finish))).toBeInstanceOf(BlackboxUnsupportedError);
    }
  });

  it("tool calls with empty-string content are refused (a replay would return null)", async () => {
    const calls = [{ id: "call_abc", type: "function", function: { name: "f", arguments: "{}" } }];
    expect(await recordOpenAIResponse(completion({ content: "", tool_calls: calls }, "tool_calls"))).toBeInstanceOf(BlackboxUnsupportedError);
  });

  it("refusals with content, tool calls or another finish reason are refused", async () => {
    const calls = [{ id: "call_abc", type: "function", function: { name: "f", arguments: "{}" } }];
    for (const response of [
      completion({ content: "", refusal: "no" }, "stop"),
      completion({ content: null, refusal: "no", tool_calls: calls }, "tool_calls"),
      completion({ content: null, refusal: "no" }, "length"),
    ]) {
      expect(String(await recordOpenAIResponse(response))).toContain("a refusal together with");
    }
  });

  it("a plain refusal still records and replays", async () => {
    expect(await recordOpenAIResponse(completion({ content: null, refusal: "I can't help with that." }, "stop"))).toBeUndefined();
  });

  it("an assistant refusal in the history is refused, not recorded as text", async () => {
    const history = [
      { role: "user", content: "hi" },
      { role: "assistant", content: null, refusal: "no" },
      { role: "user", content: "please" },
    ];
    expect(String(await recordOpenAIResponse(completion({ content: "ok" }, "stop"), history))).toContain("refusal in the history");
  });

  it("an Anthropic refusal together with tool calls is refused", async () => {
    const bb = blackbox({
      mode: "record",
      out: tmp("anthropic-refusal-tools"),
      baseFetch: upstream([anthropicMessage([{ type: "tool_use", id: "toolu_01AAAAAAAAAAAAAAAAAAAAAA", name: "f", input: {} }], "refusal")]),
      logErrors: false,
    });
    await ask(bb).catch(() => undefined);
    await expect(bb.finish()).rejects.toThrow(/refusal together with tool calls/);
  });

  it("a structured-output schema with a property named usage records", async () => {
    const OpenAI = (await import("openai")).default;
    const bb = blackbox({ mode: "record", out: tmp("schema-usage"), baseFetch: upstream([completion({ content: "{}" }, "stop")]), logErrors: false });
    await new OpenAI({ apiKey: API_KEY, fetch: bb.fetch, maxRetries: 0 }).chat.completions.create({
      model: "gpt-5",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_schema", json_schema: { name: "s", schema: { type: "object", properties: { usage: { type: "number" } } } } },
    });
    await expect(bb.finish()).resolves.toMatchObject({ status: "success" });
  });
});

describe("variants: import of an empty trailing user message (#7)", () => {
  it("an empty trailing user message still leaves the session incomplete", async () => {
    const { adaptClaudeCodeTranscript, parseClaudeCodeJsonl } = await import("../src/ingest/claudeCodeTranscript.ts");
    const { replayTrace } = await import("../src/replay/CassetteReplay.ts");
    for (const empty of ["", [{ type: "text", text: "" }]]) {
      const events = [
        { type: "user", timestamp: "2026-09-29T10:01:00.000Z", message: { role: "user", content: "first" } },
        { type: "assistant", timestamp: "2026-09-29T10:02:00.000Z", message: { role: "assistant", id: "msg_example_01", content: [{ type: "text", text: "old answer" }] } },
        { type: "user", timestamp: "2026-09-29T10:03:00.000Z", message: { role: "user", content: empty } },
      ];
      const trace = adaptClaudeCodeTranscript(parseClaudeCodeJsonl(events.map((e) => JSON.stringify(e)).join("\n")), { traceId: "t" });
      expect(replayTrace(trace).status).toBe("incomplete");
    }
  });
});
