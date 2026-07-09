#!/usr/bin/env node
// Thin launcher for the Blackbox CLI. It runs the TypeScript entrypoint
// (src/cli.ts) through the bundled tsx runtime, forwarding argv verbatim,
// inheriting stdio (so TTY detection and the color gate behave), and
// propagating the child's exit code exactly. It contains no CLI logic.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(here, "..", "src", "cli.ts");

const tsxPackageJson = require.resolve("tsx/package.json");
const tsxBin = join(dirname(tsxPackageJson), JSON.parse(readFileSync(tsxPackageJson, "utf8")).bin);

const result = spawnSync(process.execPath, [tsxBin, cliEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
