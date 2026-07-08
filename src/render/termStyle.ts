// Pure, dependency-free terminal styling for the Blackbox CLI (W8-A).
//
// This module is presentation-only and a pure function of its inputs. It never
// reads `process`, the environment, or stdout/stderr at module scope (or
// anywhere); the caller computes `colorEnabled({ isTTY, env })` decisions at the
// CLI boundary — one per output stream — and threads the resulting boolean into
// every helper. That keeps the whole module deterministic and testable without
// ever mutating the environment.
//
// Because color is decided per stream, stdout and stderr get INDEPENDENT gates:
// a redirected stderr stays escape-free even when stdout is an interactive color
// TTY (and vice versa). See `errorPrefix` — it is rendered with the stderr
// palette only.
//
// Color is optional sugar layered ONLY over an interactive TTY. When color is
// off (piped output, NO_COLOR/CI present, or any non-TTY), every helper returns
// plain text with zero ANSI escape bytes — so scripts, snapshots, and CI see a
// stable text-first surface.
//
// Glyph policy: the five allowed glyphs below (✓ ✗ → ▸ ◼) are DECORATIVE only.
// The adjacent text label always carries the meaning (a `✓` never stands in for
// the word "PASS"), so stripping every glyph leaves output whose meaning is
// intact. The header's middle dot `·` is PUNCTUATION — a separator in the
// banner grammar — not a glyph or status marker, so it is not part of the
// five-glyph allow-list. No emoji, mascot art, box-drawing, timeline/branch
// graph, or additional glyphs.

// ---------------------------------------------------------------------------
// Glyphs (exactly these five; ◼ is the header wordmark only)
// ---------------------------------------------------------------------------

export const GLYPH = {
  /** Terminal success marker; always paired with the word "PASS"/"pass". */
  pass: "✓",
  /** Terminal failure marker; always paired with the word "FAIL"/"fail". */
  fail: "✗",
  /** Flow / divergence arrow; always paired with descriptive text. */
  arrow: "→",
  /** List / step marker; always precedes an already-labelled step. */
  step: "▸",
  /** Wordmark — decorative, used ONLY in the command header. */
  wordmark: "◼",
} as const;

// ---------------------------------------------------------------------------
// Color — hand-rolled ANSI SGR, applied only when enabled
// ---------------------------------------------------------------------------

// [open, close] SGR code pairs. The ESC byte is written as the "\x1b" escape,
// never as a literal control character, so the source stays greppable/clean.
const SGR = {
  dim: [2, 22],
  bold: [1, 22],
  green: [32, 39],
  red: [31, 39],
  yellow: [33, 39],
  cyan: [36, 39],
} as const;

type ColorName = keyof typeof SGR;

function paint(name: ColorName, s: string, on: boolean): string {
  if (!on) return s;
  const [open, close] = SGR[name];
  return `\x1b[${open}m${s}\x1b[${close}m`;
}

/** The six color helpers, each a no-op when `on` is false. */
export interface Palette {
  dim(s: string): string;
  bold(s: string): string;
  green(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
}

/** Build a palette bound to a single on/off color decision. */
export function palette(on: boolean): Palette {
  return {
    dim: (s) => paint("dim", s, on),
    bold: (s) => paint("bold", s, on),
    green: (s) => paint("green", s, on),
    red: (s) => paint("red", s, on),
    yellow: (s) => paint("yellow", s, on),
    cyan: (s) => paint("cyan", s, on),
  };
}

// ---------------------------------------------------------------------------
// Color gate — the single source of truth for "should we emit ANSI?"
// ---------------------------------------------------------------------------

/**
 * Decide whether ANSI color may be emitted. Returns true ONLY when all hold:
 *   - `isTTY === true`, and
 *   - `NO_COLOR` is NOT present as a key in `env`, and
 *   - `CI` is NOT present as a key in `env`.
 *
 * This is a deliberate Blackbox-local, conservative policy — inspired by the
 * NO_COLOR-style opt-out but intentionally stricter: presence of the key alone
 * disables color, regardless of its value (an empty string still disables). The
 * published NO_COLOR convention only disables when the value is non-empty; the
 * stricter presence check is chosen so piped/CI output is escape-free even in
 * the empty-value edge case, and so the gate is a simple, auditable check. `CI`
 * is treated the same way, by local policy.
 *
 * Pure: reads only its injected inputs, never `process` directly.
 */
export function colorEnabled({
  isTTY,
  env,
}: {
  isTTY: boolean;
  env: NodeJS.ProcessEnv;
}): boolean {
  if (!isTTY) return false;
  if ("NO_COLOR" in env) return false;
  if ("CI" in env) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Structural helpers — one shared grammar for every command
// ---------------------------------------------------------------------------

/** Default label column width; the widest label in use pads to this. */
export const LABEL_WIDTH = 16;

/**
 * The command banner: `◼ blackbox · <command>`. The wordmark is dimmed, the
 * brand bold, and the command name cyan when color is on; plain otherwise. The
 * words "blackbox" and the command carry the meaning; the `◼` wordmark is
 * decoration and the middle dot `·` is punctuation (a separator), not a glyph.
 */
export function header(command: string, on: boolean): string {
  const c = palette(on);
  return `${c.dim(GLYPH.wordmark)} ${c.bold("blackbox")} ${c.dim("·")} ${c.cyan(command)}`;
}

/**
 * The stderr error prefix `[blackbox error]` (bold red when the given palette
 * has color on). This is the single rendering seam for error output: the CLI
 * builds it from the STDERR palette only — never the stdout one — so a
 * redirected stderr stays escape-free even when stdout is an interactive color
 * TTY. The word "error" carries the meaning; color is pure emphasis.
 */
export function errorPrefix(p: Palette): string {
  return p.bold(p.red("[blackbox error]"));
}

/** A dimmed subsection label (replaces the old `--- x ---` sub-rules). */
export function section(name: string, on: boolean): string {
  return palette(on).dim(name);
}

/**
 * One aligned key/value row: the label is padded to `width` (and dimmed when
 * color is on), followed by the value. Replaces the per-command `label()`
 * padEnd closures so alignment is uniform across commands.
 */
export function kv(
  label: string,
  value: string,
  on: boolean,
  width: number = LABEL_WIDTH,
): string {
  return `${palette(on).dim(label.padEnd(width))}${value}`;
}

/**
 * A terminal verdict token: `✓ PASS` (green, bold) or `✗ FAIL` (red, bold).
 * The word is always present, so the glyph and color are pure emphasis.
 */
export function verdict(pass: boolean, on: boolean): string {
  const c = palette(on);
  return pass
    ? `${c.green(GLYPH.pass)} ${c.bold(c.green("PASS"))}`
    : `${c.red(GLYPH.fail)} ${c.bold(c.red("FAIL"))}`;
}
