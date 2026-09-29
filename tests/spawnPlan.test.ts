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
    expect(spawnPlan(["node", "C:\\\\my dir\\\\agent.js"], "win32")).toEqual({ program: "node", args: ["C:\\\\my dir\\\\agent.js"], shell: false });
  });

  it("quotes arguments for npm-style .cmd launchers on Windows", () => {
    const plan = spawnPlan(["npx", "tsx", "my agent.ts", 'say "hi" & exit'], "win32");
    expect(plan.shell).toBe(true);
    expect(plan.program).toBe('npx tsx "my agent.ts" "say ""hi"" & exit"');
  });

  it("quotes only what cmd.exe would misread", () => {
    expect(quoteForCmd("plain")).toBe("plain");
    expect(quoteForCmd("")).toBe('""');
    expect(quoteForCmd("50%")).toBe('"50%"');
  });
});
