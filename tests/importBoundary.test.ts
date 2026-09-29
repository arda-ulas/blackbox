// Import-boundary test: the analysis seam (replay, verify, diff, assert and the
// trace model they read) must never reach a model client, a tool, the recording
// session, a provider SDK, or the network. The rule is checked statically over
// the transitive import graph, so a new import that breaks it fails CI before
// any code runs.

import { describe, it, expect, afterAll } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

const SRC = resolve(new URL("../src", import.meta.url).pathname);

/** Runtime import specifiers of a module. `import type` / `export type` are erased and skipped. */
function runtimeImports(source: string): string[] {
  const specifiers: string[] = [];
  const statement = /^\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/gm;
  for (const match of source.matchAll(statement)) {
    if (match[2] === undefined) specifiers.push(match[4]);
  }
  for (const match of source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) specifiers.push(match[1]);
  for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specifiers.push(match[1]);
  return specifiers;
}

interface Violation {
  file: string;
  reason: string;
}

const FORBIDDEN_DIRS = ["session", "integrations", "agent", "cli", "examples"];
const FORBIDDEN_NODE = ["node:http", "node:https", "node:net", "node:tls", "node:dgram", "node:child_process", "node:worker_threads"];

function checkSeam(srcRoot: string, roots: string[]): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = relative(srcRoot, file);
    const topDir = rel.split("/")[0];
    if (FORBIDDEN_DIRS.includes(topDir)) {
      violations.push({ file: rel, reason: `reaches src/${topDir}/` });
      continue;
    }
    const source = readFileSync(file, "utf8");
    const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (/\bfetch\s*\(/.test(code)) violations.push({ file: rel, reason: "calls fetch()" });
    for (const specifier of runtimeImports(source)) {
      if (specifier.startsWith(".")) {
        const target = resolve(dirname(file), specifier);
        if (existsSync(target)) queue.push(target);
        else violations.push({ file: rel, reason: `imports missing module ${specifier}` });
      } else if (FORBIDDEN_NODE.includes(specifier)) {
        violations.push({ file: rel, reason: `imports ${specifier}` });
      } else if (!specifier.startsWith("node:")) {
        violations.push({ file: rel, reason: `imports package ${specifier}` });
      }
    }
  }
  return violations;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : path.endsWith(".ts") ? [path] : [];
  });
}

const SEAM_ROOTS = [
  ...filesUnder(join(SRC, "replay")),
  ...filesUnder(join(SRC, "trace")),
  join(SRC, "fork", "diffTraces.ts"),
  join(SRC, "fork", "diffOutcome.ts"),
  join(SRC, "workflow", "assertCassette.ts"),
];

describe("analysis seam import boundary", () => {
  it("replay, verify, diff and assert never reach a model, tool, session, SDK or network module", () => {
    expect(SEAM_ROOTS.length).toBeGreaterThan(10);
    expect(checkSeam(SRC, SEAM_ROOTS)).toEqual([]);
  });

  describe("the checker itself", () => {
    const dir = mkdtempSync(join(tmpdir(), "blackbox-boundary-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const write = (path: string, text: string): string => {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text);
      return full;
    };
    write("agent/model.ts", "export const model = 1;\n");
    write("trace/types.ts", "export type T = number;\n");

    it("flags a transitive import of an execution-side module", () => {
      const root = write("replay/a.ts", 'import { b } from "./b.ts";\n');
      write("replay/b.ts", 'import { model } from "../agent/model.ts";\nexport const b = model;\n');
      expect(checkSeam(dir, [root])).toEqual([{ file: "agent/model.ts", reason: "reaches src/agent/" }]);
    });

    it("flags SDK packages, network modules and fetch calls, and ignores type-only imports", () => {
      const root = write(
        "replay/c.ts",
        [
          'import type Anthropic from "@anthropic-ai/sdk";',
          'import type { T } from "../trace/types.ts";',
          'import OpenAI from "openai";',
          'import { request } from "node:https";',
          'import { readFile } from "node:fs/promises";',
          "// fetch(url) in a comment is fine",
          "export const go = () => fetch(\"https://example.com\");",
        ].join("\n"),
      );
      expect(checkSeam(dir, [root]).map((v) => v.reason).sort()).toEqual(
        ["calls fetch()", "imports node:https", "imports package openai"].sort(),
      );
    });
  });
});
