# W8-B — README Hero Polish (docs/assets-only)

**Status:** IMPLEMENTED / in closeout.
**Intended tag:** `week-eight-readme-hero`.
**Precondition:** clean tree at `cd3fb4a` (`week-eight-terminal-polish`), 489/489 offline.

## 1. One-sentence scope

Hand-author a crisp, static SVG terminal hero that reproduces the real `npm run cli -- check`
output in the W8-A grammar, embed it at the top of `README.md`, and record the slice — touching
nothing under `src/`, `tests/`, `fixtures/`, `scripts/`, or `package.json`.

## 2. Why SVG, not a raster / AI image

- **Crisp at every DPI.** Vector text stays sharp on retina and when the README is zoomed; a PNG
  softens and would need 2× baking.
- **Byte-accurate and auditable.** The terminal text lives as real SVG `<text>`, so a reviewer can
  read it in a plain `git diff` and a script can assert it equals live `check` stdout. A raster is
  an opaque blob whose text can silently rot.
- **No toolchain, no dependency.** A repo-accurate PNG would need a headless-browser/canvas render
  step (new dependency or a manual screenshot). The SVG is written by hand; the only "generation"
  is transcription from live CLI output, verified mechanically.
- **No AI-generated text.** AI-generated terminal text is blurry and not byte-accurate; it is
  explicitly forbidden as the final artifact.

## 3. File allowlist (exactly these; nothing else)

| File | Action |
|---|---|
| `docs/28_week_eight_b_plan.md` | add (this plan) |
| `assets/brand/blackbox-readme-hero.svg` | add (the hero) |
| `README.md` | edit (embed hero + advance W8-A→tagged / W8-B current-state wording) |
| `docs/08_build_log.md` | edit (append W8-B entry) |
| `CLAUDE.md` | edit (current-state pointer only) |
| `AGENTS.md` | edit (current-state pointer only) |

**Never touched:** `src/`, `tests/`, `fixtures/`, `scripts/`, `package.json`, `package-lock.json`,
`.gitignore`, `DEMO.md`, any trace file. No CLI behavior, command, flag, or dependency change.

## 4. Text source of truth (Codex correction)

- The **only** source for the CLI-derived block is a live `npx tsx src/cli.ts check` run at
  implementation time — never README/DEMO/plan quotations.
- **Only the CLI-derived SVG lines are compared against live `check` stdout.** Each carries
  `data-source="cli-check"`, including the two blank lines (empty `<text>` elements), so the
  verification array lines up 1:1 with `check` stdout split on `\n`.
- **Footer lines are verified separately**, not against CLI output. Each carries
  `data-source="footer"` and is checked against a fixed expected pair:
  - `Local, offline, deterministic.`
  - `record -> replay -> fork -> mutate -> continue -> diff -> verify -> check`
  (ASCII `->`, distinct from the CLI banner's Unicode `→`.)

## 5. Asset spec

- `viewBox="0 0 1600 800"` — 800 (not 900) is intentional for README scroll economy; 13 text rows
  fit with generous negative space to the right and below.
- One full-bleed background `<rect>` `fill="#0d1117"` with `rx="12"` (acceptable). No window chrome,
  browser frame, shadowed card stack, mascot, cassette, logo system, sparkle, dashboard, contact
  sheet, raster, base64, external URL, `<script>`, `<image>`, `@font-face`, or external style import.
- `<title>` and `<desc>` present for accessibility.
- Font: system monospace stack
  `ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace`. Real SVG text.
- **One `<text>` element per visible line**, written on a single source line with
  `xml:space="preserve"`; `<tspan>` used **only** for color splits; exact spacing preserved.
- Layout: `x="128"` (8% left), first baseline `y="150"`, line height 34, `font-size="22"`.

### 5.1 Palette (exactly four + background — no others)

| Role | Hex |
|---|---|
| background | `#0d1117` |
| base text | `#c9d1d9` |
| dim text | `#6e7681` |
| cyan accent | `#56d4dd` |
| green accent | `#3fb950` |

Color rules:
- cyan **only** on the command word `check` in the top banner line;
- green **only** on `✓` glyphs and the word `PASS`;
- dim on `◼`, `·`, the labels `Mode:` / `Result:` (with their padding), the word `pass` in the
  stage rows, and both footer lines;
- `blackbox` in the banner is the base color at `font-weight="700"` (bolder, not a new hue) — this
  satisfies "brighter/bolder" without introducing a fifth color, keeping the palette audit exact.

### 5.2 Glyph policy

Only `◼ ✓ →`-family text already produced by the CLI, plus the `·` punctuation separator and ASCII
`->` in the footer. No mascot/cassette/logo/sparkle/emoji/box-drawing/timeline.

## 6. README embed (Codex-pinned placement)

Insert immediately **after the intro paragraph** and **before `## The core loop`**:

```html
<img src="assets/brand/blackbox-readme-hero.svg"
     alt="Blackbox check command showing the offline record verify fork diff workflow passing."
     width="100%">
```

Otherwise do not restructure README. Advance the Status wording so W8-A reads as pushed/tagged
(`week-eight-terminal-polish`) rather than "in closeout", and note W8-B (README hero) as the
current in-closeout slice with intended tag `week-eight-readme-hero`.

## 7. Verification (all must pass)

1. `git diff --name-only` — only the six allowlisted files.
2. `check` byte-identical run-to-run (two captures, empty diff).
3. SVG text verification (Node script): `data-source="cli-check"` lines, tags stripped, equal live
   `check` stdout lines in order; `data-source="footer"` lines equal the fixed expected pair.
4. Self-contained audit: `grep -Ei "http|href|@font-face|<script|<image|base64"` → no output.
5. Frozen surfaces: `git diff --name-only HEAD -- src tests fixtures scripts package.json package-lock.json .gitignore DEMO.md` → no output.
6. `npm test -- --run` → 489/489.
7. `npm run fixtures:generate` → corpus in sync.
8. `git ls-files traces` → no output.
9. `git diff --check` → clean.

## 8. Acceptance criteria

- Hero SVG exists; every CLI-derived line byte-identical to live `check` stdout; footer verified
  separately; self-contained (no external ref/script/raster/base64); palette exactly the four +
  background; README renders the hero at top with meaningful alt text; 489/489 offline; `check`
  byte-identical run-to-run; fixtures in sync; only the six files changed; no traces committed.

## 9. Failure conditions (stop, do not improvise)

- Text drift (V3 non-empty) → fix the SVG transcription; never change CLI output to match the asset.
- Any change wanted under `src/`/`tests/`/`package.json`/`scripts/` → abort; that is not W8-B.
- GitHub strips/breaks the SVG at render time → do **not** hotfix with an AI/screenshot PNG; open a
  follow-up decision (deterministic PNG export as its own audited micro-slice).
- Glyph tofu in a tested browser → adjust font-stack ordering only; escalate rather than substitute.

## 10. Codex audit checklist

- [ ] Clean tree at `cd3fb4a` before the slice; only the six allowlisted files in the diff.
- [ ] `git diff HEAD --stat` — zero lines under `src/`, `tests/`, `fixtures/`, `scripts/`,
      `package.json`, `package-lock.json`, `.gitignore`, `DEMO.md`.
- [ ] V3 passes: `cli-check` `<text>` content (tags stripped) byte-identical to live `check` stdout,
      in order; `footer` lines equal the fixed pair.
- [ ] SVG source audit: no `http(s)`, `href`, `@font-face`, `<script>`, `<image>`, base64; monospace
      stack ending in `monospace`; `<title>`/`<desc>` present.
- [ ] Palette audit: exactly `#0d1117` bg + `#c9d1d9` / `#6e7681` / `#56d4dd` / `#3fb950`; cyan on
      `check` only; green on `✓`/`PASS` only; no fifth hue (`blackbox` is base + bold).
- [ ] Glyph inventory: nothing outside `◼ ✓ · →` + ASCII.
- [ ] Footer wording is the fixed pair; no invented tagline.
- [ ] 489/489; `check` exit 0 and byte-identical across two runs; fixtures in sync.
- [ ] README/DEMO claims still truthful; no new README promise implying a brand/design system.
- [ ] Build-log entry present; CLAUDE.md/AGENTS.md pointers match reality; tag
      `week-eight-readme-hero` recorded as intended.
- [ ] No trace files and no raster anywhere in the diff.
