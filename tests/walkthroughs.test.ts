// The documented examples, run the way a reader runs them.
//
// Fleet triage: every `npx blackbox ...` command in the "Re-run the agent"
// section of docs/example-fleet-triage.md is executed in a temporary copy of
// examples/fleet-triage, against the current source (the example's
// `@ardaulas/blackbox` dependency is shimmed to src/). No network, no API key.
//
// Claude Code session: the committed, scrubbed transcript imports into the
// cassette the docs describe, and contains nothing that should have been
// scrubbed.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyTraceFile } from "../src/trace/verifyTrace.ts";
import { loadTrace, replayTrace } from "../src/replay/CassetteReplay.ts";
import { diffTraces, diffTracesSemantic } from "../src/fork/diffTraces.ts";
import { assertCassetteFile } from "../src/workflow/assertCassette.ts";
import { adaptClaudeCodeTranscript, parseClaudeCodeJsonl } from "../src/ingest/claudeCodeTranscript.ts";
import { toolCallSequence } from "../src/trace/traceOutcome.ts";

const execFileAsync = promisify(execFile);
const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const TSX = join(ROOT, "node_modules", "tsx", "dist", "esm", "index.mjs");
const FLEET = join(ROOT, "examples", "fleet-triage");

/** Split a shell command line into words (single and double quotes, no expansion). */
function shellWords(line: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let started = false;
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) words.push(current);
  return words;
}

/** The `npx blackbox ...` lines of the bash blocks between two headings of a docs page. */
function documentedCommands(page: string, fromHeading: string, toHeading: string): string[][] {
  const section = page.slice(page.indexOf(fromHeading), page.indexOf(toHeading));
  const blocks = [...section.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);
  return blocks
    .flatMap((block) => block.split("\n"))
    .map((line) => line.replace(/\s+#.*$/, "").trim())
    .filter((line) => line.startsWith("npx blackbox "))
    .map((line) => shellWords(line).slice(2));
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function blackbox(args: string[], cwd: string): Promise<Run> {
  // The documented agent command `node agent.mjs` runs through the tsx loader so
  // the shimmed package can load the TypeScript source.
  const dash = args.indexOf("--");
  const cliArgs = dash >= 0 && args[dash + 1] === "node" ? [...args.slice(0, dash + 2), "--import", TSX, ...args.slice(dash + 2)] : args;
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };
  delete env["ANTHROPIC_API_KEY"];
  delete env["OPENAI_API_KEY"];
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ["--import", TSX, join(ROOT, "src", "cli.ts"), ...cliArgs], { cwd, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("fleet-triage example", () => {
  const page = readFileSync(join(ROOT, "docs", "example-fleet-triage.md"), "utf8");
  const work = mkdtempSync(join(tmpdir(), "blackbox-fleet-"));
  const dir = join(work, "fleet-triage");
  const outputs: Run[] = [];
  let commands: string[][] = [];
  const cassette = (name: string) => join(FLEET, "cassettes", name);

  beforeAll(async () => {
    cpSync(FLEET, dir, { recursive: true, filter: (path) => !/node_modules|work-orders\.jsonl|my-.*\.json$/.test(path) });
    const shim = join(dir, "node_modules", "@ardaulas", "blackbox");
    mkdirSync(shim, { recursive: true });
    writeFileSync(join(shim, "package.json"), JSON.stringify({ name: "@ardaulas/blackbox", type: "module", exports: { ".": "./index.mjs" } }));
    writeFileSync(join(shim, "index.mjs"), `export * from ${JSON.stringify(join(ROOT, "src", "index.ts"))};\n`);
    mkdirSync(join(dir, "node_modules", "@anthropic-ai"), { recursive: true });
    symlinkSync(join(ROOT, "node_modules", "@anthropic-ai", "sdk"), join(dir, "node_modules", "@anthropic-ai", "sdk"));

    commands = documentedCommands(page, "## Run the investigation", "## With an API key");
    for (const command of commands) outputs.push(await blackbox(command, dir));
  }, 180_000);

  afterAll(() => rmSync(work, { recursive: true, force: true }));

  const output = (verb: string, nth = 0): Run => {
    const indexes = commands.map((command, index) => (command[0] === verb ? index : -1)).filter((index) => index >= 0);
    return outputs[indexes[nth]];
  };

  it("documents the investigation: reproduce, isolate, test, confirm, then the preventive action", () => {
    expect(commands.map((command) => command[0])).toEqual(["replay", "inspect", "inspect", "fork", "diff", "replay", "inspect", "assert"]);
  });

  it("every documented command succeeds offline", () => {
    for (const [index, run] of outputs.entries()) {
      expect(run.code, `${commands[index].join(" ")}\n${run.stderr}`).toBe(0);
    }
  });

  it("reproduce: replay gives the routine answer without the network", () => {
    expect(output("replay").stdout).toContain("Routine: I opened work order WO-9610DE");
    expect(output("replay").stderr).toContain("replayed 17 steps");
  });

  it("isolate: step 5 is a reading captured before the fault", () => {
    const step = output("inspect", 1).stdout;
    expect(step).toContain('"path": "Vehicle.Powertrain.CombustionEngine.EngineCoolant.Temperature"');
    expect(step).toContain('"value": "91"');
    expect(step).toContain('"ts": "2026-09-28T17:05:00Z"');
  });

  it("test and confirm: the fork diverges exactly at step 5 and changes the answer and the tool path", () => {
    expect(output("fork").stdout).toContain("Urgent: take VAN-14 off the road now.");
    const diff = output("diff").stdout;
    expect(diff).toContain("First divergence at index 5");
    expect(diff).toContain('result.data[0].dp.value: "91" → "124"');
    expect(diff).toContain("parent tools:  lookup_dtc → get_telemetry → get_service_history → open_work_order");
    expect(diff).toContain("child tools:   lookup_dtc → get_telemetry → open_work_order");
    expect(readFileSync(join(dir, "work-orders.jsonl"), "utf8")).toContain('"priority":"urgent"');
  });

  it("a fresh fork matches the committed hypothesis cassette step for step", async () => {
    const committed = await loadTrace(cassette("triage-hypothesis.json"));
    const fresh = await loadTrace(join(dir, "my-fork.json"));
    expect(diffTracesSemantic(committed, fresh).hasDivergence).toBe(false);
    expect(diffTraces(await loadTrace(cassette("triage-incident.json")), fresh).firstDivergenceIndex).toBe(5);
  });

  it("preventive action: the fixed run replays against the current agent code, rejects the stale cache, and is pinned", async () => {
    expect(output("replay", 1).stderr).toContain("replayed 13 steps from cassettes/triage-fixed.json");
    expect(output("inspect", 2).stdout).toContain('"cache_rejected": "snapshot captured 2026-09-28T17:05:00Z, before P0217 was set at 2026-09-29T07:58:00Z"');
    expect(output("assert").stdout).toContain("tools                pass  lookup_dtc, get_telemetry, open_work_order");
    const fixed = await loadTrace(cassette("triage-fixed.json"));
    const report = await assertCassetteFile(cassette("triage-fixed.json"), {
      expectStatus: "success",
      expectTools: ["lookup_dtc", "get_telemetry", "open_work_order"],
      expectFinalAnswer: replayTrace(fixed).result as string,
    });
    expect(report.pass).toBe(true);
  });

  it("the fixed tool uses the live reading when the cache predates the fault, and flags stale data when nothing fresh exists", async () => {
    const tools = (await import(join(FLEET, "tools.mjs"))) as Record<string, (input: object) => Promise<Record<string, unknown>>>;
    expect(JSON.stringify(await tools["getTelemetryAsDeployed"]({ vehicle_id: "VAN-14" }))).toContain('"value":"91"');
    const fixed = await tools["get_telemetry"]({ vehicle_id: "VAN-14" });
    expect(fixed).toMatchObject({ stale: false });
    expect(JSON.stringify(fixed)).toContain('"value":"124"');
    const onlyStale = await tools["get_telemetry"]({ vehicle_id: "VAN-31" });
    expect(onlyStale).toMatchObject({ stale: true });
    expect(String(onlyStale["warning"])).toContain("before P0217 was set at 2026-09-29T06:45:00Z");
  });

  it("the committed cassettes verify, and the answers quoted in the docs are theirs", async () => {
    for (const name of ["triage-incident.json", "triage-hypothesis.json", "triage-fixed.json"]) {
      expect((await verifyTraceFile(cassette(name))).pass, name).toBe(true);
      expect(page).toContain(replayTrace(await loadTrace(cassette(name))).result as string);
    }
  });

  it("the step hashes quoted in the docs are the committed incident cassette's", async () => {
    const incident = await loadTrace(cassette("triage-incident.json"));
    const quoted = [...page.matchAll(/^\s+(\d+)\s+(?:model_input|model_output|tool_call|tool_result|metadata)\s+([0-9a-f]{8})\s/gm)];
    expect(quoted.length).toBeGreaterThan(5);
    for (const [, index, hash] of quoted) expect(incident.steps[Number(index)].hash.startsWith(hash), `step ${index}`).toBe(true);
  });

  it("uses only the generic code title and standard VSS 6.1 paths", () => {
    const dtc = JSON.parse(readFileSync(join(FLEET, "data", "dtc-codes.json"), "utf8")) as Record<string, { title?: string }>;
    expect(Object.keys(dtc).filter((key) => !key.startsWith("_"))).toEqual(["P0217"]);
    expect(dtc["P0217"].title).toBe("Engine Coolant Over Temperature Condition");
    const telemetry = readFileSync(join(FLEET, "data", "telemetry.json"), "utf8");
    const paths = new Set([...telemetry.matchAll(/"path": "([^"]+)"/g)].map((match) => match[1]));
    expect([...paths].sort()).toEqual([
      "Vehicle.Diagnostics.DTCList",
      "Vehicle.Powertrain.CombustionEngine.EngineCoolant.Temperature",
      "Vehicle.TraveledDistance",
    ]);
  });
});

describe("Claude Code session example", () => {
  const raw = readFileSync(join(ROOT, "examples", "claude-code-session", "session.jsonl"), "utf8");
  const page = readFileSync(join(ROOT, "docs", "example-claude-code.md"), "utf8");

  it("imports into the cassette the docs describe", () => {
    const trace = adaptClaudeCodeTranscript(parseClaudeCodeJsonl(raw), { traceId: "session" });
    expect(trace.steps).toHaveLength(39);
    expect(replayTrace(trace).status).toBe("success");
    const tools = toolCallSequence(trace);
    expect(tools).toEqual(["Bash", "Read", "Read", "Bash", "Bash", "Bash", "Edit", "Bash", "Bash", "SubagentHandback"]);
    expect(page).toContain(`--expect-tools ${tools.join(",")}`);
    expect(trace.steps[24]).toMatchObject({ type: "tool_call", payload: { toolName: "Edit" } });
  });

  it("is scrubbed: no absolute paths, identities, thinking, or harness context", () => {
    const events = raw.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    for (const event of events) {
      expect(["user", "assistant"]).toContain(event["type"]);
      expect(Object.keys(event).sort()).toEqual(
        ["isSidechain", "message", "parentUuid", "timestamp", "type", "uuid"].filter((key) => key in event).sort(),
      );
      expect(event["isMeta"]).toBeUndefined();
    }
    for (const forbidden of [/\/Users\//, /\/private\//, /\/home\//, /ardaulas/i, /ozdemir/i, /@gmail/, /"thinking"/, /"signature"/, /worktree-agent/, /sessionId/, /"cwd"/]) {
      expect(raw).not.toMatch(forbidden);
    }
  });
});
