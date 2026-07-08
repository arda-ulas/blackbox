// Unit tests for the pure terminal-styling module (W8-A).
//
// Everything here is a pure function of injected inputs. No test reads or
// mutates process.env or process.stdout — the color decision is passed in as a
// value, and the environment-shaped inputs to colorEnabled are plain objects.

import { describe, it, expect } from "vitest";
import {
  colorEnabled,
  palette,
  header,
  section,
  kv,
  verdict,
  errorPrefix,
  GLYPH,
  LABEL_WIDTH,
} from "../src/render/termStyle.ts";

const ESC = /\x1b\[/; // ANSI CSI introducer

// ---------------------------------------------------------------------------
// colorEnabled — the gate truth table
// ---------------------------------------------------------------------------

describe("colorEnabled", () => {
  // Full truth table over isTTY × NO_COLOR-present × CI-present. Color is on
  // ONLY when isTTY is true and neither key is present.
  const cases: Array<{
    isTTY: boolean;
    env: NodeJS.ProcessEnv;
    expected: boolean;
    label: string;
  }> = [
    { isTTY: true,  env: {},                          expected: true,  label: "tty, no keys" },
    { isTTY: false, env: {},                          expected: false, label: "no tty, no keys" },
    { isTTY: true,  env: { NO_COLOR: "1" },           expected: false, label: "tty, NO_COLOR set" },
    { isTTY: false, env: { NO_COLOR: "1" },           expected: false, label: "no tty, NO_COLOR set" },
    { isTTY: true,  env: { CI: "true" },              expected: false, label: "tty, CI set" },
    { isTTY: false, env: { CI: "true" },              expected: false, label: "no tty, CI set" },
    { isTTY: true,  env: { NO_COLOR: "1", CI: "1" },  expected: false, label: "tty, both set" },
    { isTTY: false, env: { NO_COLOR: "1", CI: "1" },  expected: false, label: "no tty, both set" },
  ];

  for (const { isTTY, env, expected, label } of cases) {
    it(`${label} → ${expected}`, () => {
      expect(colorEnabled({ isTTY, env })).toBe(expected);
    });
  }

  it("disables color when NO_COLOR is present as an empty string (presence, not truthiness)", () => {
    expect(colorEnabled({ isTTY: true, env: { NO_COLOR: "" } })).toBe(false);
  });

  it("disables color when CI is present as an empty string (presence, not truthiness)", () => {
    expect(colorEnabled({ isTTY: true, env: { CI: "" } })).toBe(false);
  });

  it("enables color for a bare interactive TTY with neither key present", () => {
    expect(colorEnabled({ isTTY: true, env: { PATH: "/usr/bin" } })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// palette — color helpers are no-ops when off, wrap in SGR when on
// ---------------------------------------------------------------------------

describe("palette", () => {
  it("returns plain text with zero escapes when disabled", () => {
    const p = palette(false);
    for (const s of [p.dim("x"), p.bold("x"), p.green("x"), p.red("x"), p.yellow("x"), p.cyan("x")]) {
      expect(s).toBe("x");
      expect(ESC.test(s)).toBe(false);
    }
  });

  it("wraps text in an SGR pair when enabled (forced color via injected flag)", () => {
    const p = palette(true);
    expect(p.green("PASS")).toBe("\x1b[32mPASS\x1b[39m");
    expect(p.red("FAIL")).toBe("\x1b[31mFAIL\x1b[39m");
    expect(p.bold("x")).toBe("\x1b[1mx\x1b[22m");
    expect(p.dim("x")).toBe("\x1b[2mx\x1b[22m");
    expect(ESC.test(p.cyan("x"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// kv — alignment
// ---------------------------------------------------------------------------

describe("kv", () => {
  it("pads the label to LABEL_WIDTH and appends the value (plain, no color)", () => {
    expect(kv("Mode:", "in-memory", false)).toBe("Mode:".padEnd(LABEL_WIDTH) + "in-memory");
  });

  it("aligns short and long labels to the same value column", () => {
    const a = kv("A:", "x", false);
    const b = kv("Longer:", "x", false);
    expect(a.indexOf("x")).toBe(b.indexOf("x"));
    expect(a.indexOf("x")).toBe(LABEL_WIDTH);
  });

  it("honors an explicit width override", () => {
    expect(kv("Path:", "p", false, 20)).toBe("Path:".padEnd(20) + "p");
  });

  it("emits no ANSI escapes when color is off", () => {
    expect(ESC.test(kv("Mode:", "value", false))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// header / section / verdict — content and escape-freeness
// ---------------------------------------------------------------------------

describe("header/section/verdict", () => {
  it("header carries the brand, command, and wordmark; plain when off", () => {
    const h = header("check", false);
    expect(h).toContain("blackbox");
    expect(h).toContain("check");
    expect(h).toContain(GLYPH.wordmark);
    expect(ESC.test(h)).toBe(false);
  });

  it("header emits escapes when color is on", () => {
    expect(ESC.test(header("check", true))).toBe(true);
  });

  it("section returns the plain name when color is off", () => {
    expect(section("parent", false)).toBe("parent");
    expect(ESC.test(section("parent", false))).toBe(false);
  });

  it("verdict keeps the PASS/FAIL word (glyph is decoration) and is plain when off", () => {
    const pass = verdict(true, false);
    const fail = verdict(false, false);
    expect(pass).toContain("PASS");
    expect(pass).toContain(GLYPH.pass);
    expect(fail).toContain("FAIL");
    expect(fail).toContain(GLYPH.fail);
    expect(ESC.test(pass)).toBe(false);
    expect(ESC.test(fail)).toBe(false);
  });

  it("header uses `·` as a plain punctuation separator, not a status glyph", () => {
    // The middle dot is punctuation in the banner grammar — it must never be one
    // of the five decorative status/flow glyphs.
    const h = header("check", false);
    expect(h).toContain("·");
    for (const g of [GLYPH.pass, GLYPH.fail, GLYPH.arrow, GLYPH.step]) {
      expect(h).not.toContain(g);
    }
  });
});

// ---------------------------------------------------------------------------
// errorPrefix + per-stream color gates (the W8-A stderr fix)
//
// colorEnabled is called ONCE PER STREAM at the CLI boundary, so stdout and
// stderr get independent decisions. errorPrefix is rendered with the STDERR
// palette only. These tests prove the split conceptually equivalent to the
// blocker: stdout is a color-enabled TTY while stderr is redirected (non-TTY),
// so the error prefix must carry no ANSI even though stdout would.
// ---------------------------------------------------------------------------

describe("errorPrefix + per-stream color gates", () => {
  it("keeps the plain '[blackbox error]' text (word carries meaning) when off", () => {
    expect(errorPrefix(palette(false))).toBe("[blackbox error]");
    expect(ESC.test(errorPrefix(palette(false)))).toBe(false);
  });

  it("wraps the prefix in SGR when the palette has color on", () => {
    expect(ESC.test(errorPrefix(palette(true)))).toBe(true);
  });

  it("split-TTY: stdout is a color TTY, stderr is redirected → stderr gate is off", () => {
    // Model the exact blocker inputs: stdout attached to an interactive TTY,
    // stderr redirected to a file/pipe, with NO_COLOR and CI both unset.
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    const stdoutColorOn = colorEnabled({ isTTY: true, env });
    const stderrColorOn = colorEnabled({ isTTY: false, env });

    expect(stdoutColorOn).toBe(true);
    expect(stderrColorOn).toBe(false);

    // The CLI renders errors with the STDERR gate — so the prefix is escape-free
    // even though stdout is colored.
    expect(ESC.test(errorPrefix(palette(stderrColorOn)))).toBe(false);

    // Guard against the regression: had the error prefix used the STDOUT gate,
    // it WOULD have carried ANSI. This is exactly the bug Codex flagged.
    expect(ESC.test(errorPrefix(palette(stdoutColorOn)))).toBe(true);
  });

  it("split-TTY inverse: stdout redirected, stderr is a color TTY → stdout gate is off", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    const stdoutColorOn = colorEnabled({ isTTY: false, env });
    const stderrColorOn = colorEnabled({ isTTY: true, env });

    expect(stdoutColorOn).toBe(false);
    expect(stderrColorOn).toBe(true);
    // stdout content (a header) must be escape-free; the stderr prefix may color.
    expect(ESC.test(header("check", stdoutColorOn))).toBe(false);
    expect(ESC.test(errorPrefix(palette(stderrColorOn)))).toBe(true);
  });

  it("stderr gate honors NO_COLOR / CI presence even on a stderr TTY", () => {
    // Presence check, not truthiness — empty string still disables.
    expect(colorEnabled({ isTTY: true, env: { NO_COLOR: "" } })).toBe(false);
    expect(colorEnabled({ isTTY: true, env: { CI: "" } })).toBe(false);
    expect(ESC.test(errorPrefix(palette(colorEnabled({ isTTY: true, env: { CI: "1" } }))))).toBe(false);
  });
});
