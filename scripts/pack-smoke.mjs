// Packaging smoke test: pack the package, install the tarball into a clean
// temporary project, and use it the way a stranger would. Run with
// `node scripts/pack-smoke.mjs`. Needs the npm registry (to install the SDK and
// TypeScript into the temp project) but never calls a model API.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const step = (message) => console.log(`\n== ${message}`);
const fail = (message) => {
  console.error(`pack-smoke FAILED: ${message}`);
  process.exit(1);
};

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

step("npm pack");
const [packed] = JSON.parse(run(npm, ["pack", "--json"], root));
const tarball = join(root, packed.filename);
const files = packed.files.map((file) => file.path).sort();
console.log(files.join("\n"));
const unexpected = files.filter(
  (file) => !/^(dist\/.+\.(js|d\.ts)|README\.md|LICENSE|CHANGELOG\.md|package\.json)$/.test(file),
);
if (unexpected.length > 0) fail(`unexpected files in the tarball: ${unexpected.join(", ")}`);
for (const required of ["dist/index.js", "dist/index.d.ts", "dist/cli.js", "README.md", "LICENSE", "CHANGELOG.md"]) {
  if (!files.includes(required)) fail(`missing ${required}`);
}

const project = mkdtempSync(join(tmpdir(), "blackbox-pack-smoke-"));
try {
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));

  step("install the tarball into a clean project");
  run(npm, ["install", "--no-audit", "--no-fund", tarball, "@anthropic-ai/sdk", "typescript", "@types/node"], project);

  step("npx blackbox --help / --version / check");
  const help = run(npx, ["blackbox", "--help"], project);
  if (!help.includes("Your agent:") || !help.includes("record")) fail("--help output is missing the command list");
  const reported = run(npx, ["blackbox", "--version"], project).trim();
  if (reported !== version) fail(`--version printed ${reported}, expected ${version}`);
  const check = run(npx, ["blackbox", "check"], project);
  if (!check.includes("PASS")) fail("check did not pass");
  console.log(check);

  step("JavaScript consumer: record, then replay offline through the real SDK");
  writeFileSync(
    join(project, "consumer.mjs"),
    `
import Anthropic from "@anthropic-ai/sdk";
import { blackbox, verifyTraceFile } from "@ardaulas/blackbox";

const reply = {
  id: "msg_01SMOKESMOKESMOKESMOKE01", type: "message", role: "assistant", model: "claude-sonnet-5",
  content: [{ type: "text", text: "pong" }], stop_reason: "end_turn", stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};
const upstream = async () => new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } });
async function agent(bb) {
  const client = new Anthropic({ apiKey: "smoke-test-key", fetch: bb.fetch, maxRetries: 0 });
  const response = await client.messages.create({ model: "claude-sonnet-5", max_tokens: 10, messages: [{ role: "user", content: "ping" }] });
  return response.content[0].text;
}
const rec = blackbox({ mode: "record", out: "run.json", baseFetch: upstream });
const recorded = await agent(rec);
await rec.finish();
const offline = async () => { throw new Error("network used in replay"); };
const replay = blackbox({ mode: "replay", cassette: "run.json", baseFetch: offline });
const replayed = await agent(replay);
await replay.finish();
const report = await verifyTraceFile("run.json");
if (recorded !== "pong" || replayed !== "pong" || !report.pass) throw new Error("smoke consumer failed");
console.log("record + replay + verify: ok");
`,
  );
  console.log(run(process.execPath, ["consumer.mjs"], project));

  step("TypeScript consumer: the declarations type-check against the SDK");
  writeFileSync(
    join(project, "consumer.ts"),
    `
import Anthropic from "@anthropic-ai/sdk";
import { blackbox, isBlackboxError, type FinishSummary } from "@ardaulas/blackbox";

const bb = blackbox();
const client = new Anthropic({ fetch: bb.fetch });
const tools = bb.tools({ add: (a: number, b: number) => a + b });
const sum: Promise<number> = tools.add(1, 2);
const done: Promise<FinishSummary> = bb.finish();
void client; void sum; void done; void isBlackboxError;
`,
  );
  writeFileSync(
    join(project, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { module: "nodenext", moduleResolution: "nodenext", target: "es2023", strict: true, noEmit: true, skipLibCheck: false, types: ["node"] }, files: ["consumer.ts"] }),
  );
  run(join(project, "node_modules", ".bin", "tsc"), ["-p", "."], project);
  console.log("tsc: ok");

  console.log("\npack-smoke: PASS");
} finally {
  rmSync(project, { recursive: true, force: true });
  rmSync(tarball, { force: true });
}
