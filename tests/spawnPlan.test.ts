import { describe, it, expect } from "vitest";
import { quoteForCmd, spawnPlan } from "../src/cli/launch.ts";

describe("spawnPlan", () => {
  it("passes arguments straight through on POSIX (no shell re-parsing)", () => {
    expect(spawnPlan(["node", "my agent.js", "a&b"], "linux")).toEqual({ program: "node", args: ["my agent.js", "a&b"], shell: false });
  });

  it("lets the shell split a single quoted command", () => {
    expect(spawnPlan(["node agent.js --fast"], "darwin")).toEqual({ program: "node agent.js --fast", args: [], shell: true });
  });

  it("spawns executables directly on Windows too", () => {
    expect(spawnPlan(["node", "C:\\my dir\\agent.js"], "win32")).toEqual({ program: "node", args: ["C:\\my dir\\agent.js"], shell: false });
  });

  it("spawns a real .exe found on PATH directly, even with a launcher-like name", () => {
    const env = { PATH: "C:\\bun\\bin;C:\\npm", PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    const files = new Set(["C:\\bun\\bin\\bun.EXE", "C:\\npm\\npx.CMD"]);
    const exists = (path: string) => files.has(path);
    expect(spawnPlan(["bun", "agent.ts"], "win32", env, exists)).toEqual({ program: "bun", args: ["agent.ts"], shell: false });
    expect(spawnPlan(["npx", "tsx", "agent.ts"], "win32", env, exists).shell).toBe(true);
  });

  it("escapes a .cmd launcher's command line for cmd.exe", () => {
    const plan = spawnPlan(["npx", "tsx", "my agent.ts"], "win32", { PATH: "C:\\npm" }, (path) => path === "C:\\npm\\npx.CMD");
    expect(plan.shell).toBe(true);
    expect(plan.program).toBe('npx ^^^"tsx^^^" ^^^"my^^^ agent.ts^^^"');
  });
});

describe("quoteForCmd (cross-spawn escaping)", () => {
  it("^-escapes percent signs so %VAR% cannot expand", () => {
    expect(quoteForCmd("%PATH%", false)).toBe('^"^%PATH^%^"');
    expect(quoteForCmd("%PATH%")).toBe('^^^"^^^%PATH^^^%^^^"');
  });

  it("escapes shell operators and embedded quotes", () => {
    expect(quoteForCmd('say "hi" & exit', false)).toBe('^"say^ \\^"hi\\^"^ ^&^ exit^"');
  });

  it("doubles trailing backslashes before the closing quote", () => {
    expect(quoteForCmd("C:\\dir\\", false)).toBe('^"C:\\dir\\\\^"');
  });
});
