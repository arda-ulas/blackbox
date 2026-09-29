// Render the README / docs hero from real CLI output on the committed fleet
// example, as a short animated terminal recording: lines appear in order. The
// text is visible by default and only hidden during each line's delay, so a
// viewer that does not run SVG animations (or prefers reduced motion) shows the
// whole recording at once.
//
//   npm run build && node scripts/render-hero.mjs

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const example = new URL("../examples/fleet-triage/", import.meta.url).pathname;
const run = (...args) =>
  execFileSync(process.execPath, [`${root}dist/cli.js`, ...args], { cwd: example, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });

const WIDTH = 112; // characters per line before eliding
const elide = (line) => (line.length > WIDTH ? `${line.slice(0, WIDTH - 1)}…` : line);

const inspect = run("inspect", "cassettes/triage-incident.json", "--step", "5");
const payload = JSON.parse(inspect.slice(inspect.indexOf("{")));
const diff = run("diff", "cassettes/triage-incident.json", "cassettes/triage-hypothesis.json").split("\n");
const from = diff.findIndex((line) => line.startsWith("First divergence"));
const wanted = diff.slice(from).filter((line) => {
  if (line.trim().length === 0) return false;
  if (/^\s+(parent|child)\s+tool result/.test(line)) return false; // step rows: hashes only
  if (/^\s+changed value|^\s+(parent|child):\s+\{/.test(line)) return false; // long raw JSON, shown as fields below
  return true;
});

/** [kind, text]: kind is "cmd" (typed prompt), "hi" (highlight), "out", or "gap". */
const lines = [
  ["cmd", "$ npx blackbox inspect cassettes/triage-incident.json --step 5"],
  ["out", `  ${payload.toolName} result for ${payload.result.vehicle_id}:`],
  ...payload.result.data.map((point) => [/Temperature|DTCList/.test(point.path) ? "hi" : "out", `    ${point.path}  ${JSON.stringify(point.dp)}`]),
  ["gap", ""],
  ["cmd", "$ npx blackbox diff cassettes/triage-incident.json cassettes/triage-hypothesis.json"],
  ...wanted.map((line) => [/^First divergence|^Outcome|dp\.value: "91"|\(absent\) → "P0217"/.test(line) ? "hi" : "out", line]),
];

const FONT = 22;
const LINE = 31;
const CHAR = FONT * 0.6;
const PAD = 44;
const width = Math.ceil(PAD * 2 + CHAR * WIDTH);
let y = PAD + 36;
let delay = 0.2;
const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&apos;");
const rows = [];
for (const [kind, text] of lines) {
  if (kind === "gap") {
    y += LINE * 0.6;
    delay += 0.6;
    continue;
  }
  rows.push(`  <text x="${PAD}" y="${y}" class="${kind}" style="animation-delay:${delay.toFixed(2)}s">${escape(elide(text))}</text>`);
  y += LINE;
  delay += kind === "cmd" ? 0.9 : 0.12;
}
const height = y + PAD - 10;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="blackbox inspect shows a stale telemetry reading at step 5; blackbox diff shows the first divergence at step 5 and the work order changing from routine to urgent">
  <rect width="100%" height="100%" rx="14" fill="#0d1117"/>
  <circle cx="26" cy="22" r="6" fill="#30363d"/><circle cx="46" cy="22" r="6" fill="#30363d"/><circle cx="66" cy="22" r="6" fill="#30363d"/>
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: ${FONT}px; white-space: pre; fill: #8b949e; animation: show 0.2s backwards; }
    .cmd { fill: #58a6ff; }
    .hi { fill: #e6edf3; font-weight: 600; }
    @keyframes show { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { text { animation: none; } }
  </style>
${rows.join("\n")}
</svg>
`;
for (const target of ["assets/brand/blackbox-readme-hero.svg", "docs/public/hero.svg"]) writeFileSync(`${root}${target}`, svg);
console.log(`hero: ${rows.length} lines, ${width}x${height}`);
