# Week Three Plan

## Goal

Make Blackbox usable and presentable as a local CLI tool. A developer should be able to install it, run a scripted demo from a single entry-point command, and share a terminal recording that makes the record → fork → diff loop immediately obvious.

Everything stays local and offline. No UI, no hosted backend, no external service dependencies.

---

## Non-Goals

- Web UI, dashboard, or any browser-based interface
- Hosted backend, remote cassette storage, or sharing links
- LangChain, LlamaIndex, MCP, or any agent framework integration
- Real model API calls (keep `FakeDeterministicModelClient`)
- Real external tool calls (keep deterministic fixture tools)
- Full SDK / npm-published package (that's Week Four scope)
- Multi-agent orchestration
- OTEL export or production observability
- Semantic diff (diff by intent, not by hash)
- Automated chaos / random mutation injection

---

## Proposed Phases

### Phase W3-A: Single entry-point CLI command

Replace the three separate `npm run example:*` scripts with a unified `blackbox` CLI that accepts subcommands: `record`, `replay`, `fork`, `diff`.

Users run:
```sh
npm run cli -- record
npm run cli -- replay --trace traces/example-trace.json
npm run cli -- fork --trace traces/example-trace.json --fork-index 4 --payload-json '{"available":false}'
npm run cli -- diff --parent traces/example-trace.json --child traces/example-trace-fork.json
```

Files to touch:
- `src/cli.ts` — new CLI entry point; dispatches to existing logic
- `package.json` — add `"bin"` field and a top-level `blackbox` script if useful
- `tests/cli.test.ts` — smoke tests for subcommand dispatch

### Phase W3-B: Cassette ergonomics

Add named cassette management so users can list, inspect, and compare saved traces without writing scripts.

Subcommands to add:
- `blackbox list` — lists all `.json` trace files in `traces/`, showing id, step count, status, and creation time
- `blackbox inspect <path>` — prints a step-by-step event summary (extends current `replay` output)
- `blackbox diff <path-a> <path-b>` — loads both, runs `diffTraces`, prints `formatFirstDivergence`

Files to touch:
- `src/cli.ts` — add `list`, `inspect`, `diff` subcommands
- `tests/cli.test.ts` — add subcommand tests

### Phase W3-C: Terminal output polish

Improve readability of all terminal output without touching core logic.

Targets:
- Step-type column widths and hash display length are currently inconsistent; standardize them
- `example:replay` step list: add color indicators for error steps (only if a simple ANSI escape is sufficient — no color libraries)
- `formatFirstDivergence`: add a one-line human summary above the raw hash lines, e.g. `"model_input payload changed"` or `"tool_result injected"` derived from step type and payload diff
- All commands: consistent `[blackbox]` prefix and section separators

Files to touch:
- `src/fork/diffTraces.ts` — extend `formatFirstDivergence` with human summary line
- `src/replay/CassetteReplay.ts` or `src/examples/replay.ts` — terminal output consistency
- `tests/diffTraces.test.ts` — assert new summary line is present

### Phase W3-D: Portfolio/demo writeup

Produce a shareable demo artifact — a recorded terminal session or a written walkthrough — that shows Blackbox's record → fork → diff loop on a realistic scenario.

Deliverables:
- A short `DEMO.md` at project root describing the demo scenario step by step, with expected terminal output
- Optionally: an `asciinema` cast file committed to `docs/` (record with `asciinema rec`)
- README updated with a "Demo" section linking to `DEMO.md`

Files to touch:
- `DEMO.md` (new)
- `README.md` — add Demo section

---

## Acceptance Criteria

- `blackbox record` creates `traces/example-trace.json` (same as current `npm run example:record`)
- `blackbox replay <path>` replays any saved trace offline
- `blackbox fork <path> --at <index>` forks a trace at a given step with a mutated prompt
- `blackbox diff <path-a> <path-b>` loads and diffs any two traces
- `blackbox list` lists all traces in the `traces/` directory
- `npm test` still passes (no regressions)
- All existing example scripts still work
- `DEMO.md` exists and is accurate

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| CLI argument parsing adds complexity disproportionate to value | Medium | Use a minimal hand-rolled arg parser (no external dependencies); subcommand dispatch is a simple switch |
| Terminal color codes break in some terminals | Low | Use ANSI escapes only for error-step highlighting; fall back to plain text if `NO_COLOR` env var is set |
| `formatFirstDivergence` human summary is wrong for edge cases | Medium | Only derive from step type (not payload content); keep it simple — "tool_result differs" not "booking was unavailable" |
| `DEMO.md` becomes stale as code evolves | Low | Keep it brief; show commands and expected output shape, not exact hash values |
| Week Three scope creeps toward a web UI | Low | Enforce in CLAUDE.md: no UI until explicitly chosen |

---

## Recommended Order of Implementation

1. **W3-A first** (CLI entry point) — establishes the user-facing surface everything else builds on; touches a new file (`src/cli.ts`) so risk of regression is low
2. **W3-B second** (cassette ergonomics) — natural extension of W3-A; `list` and `inspect` are read-only so safe to build early
3. **W3-C third** (terminal polish) — incremental improvements; `formatFirstDivergence` change is the highest-value single edit
4. **W3-D last** (demo writeup) — no code; depends on W3-A/B/C being stable so the output is accurate

---

## When to Bring in Codex

- After W3-A is committed: Codex audit on CLI argument parsing (are error messages clear? are paths validated correctly?)
- After W3-C is committed: Codex audit on terminal output (is the human summary accurate and non-misleading?)
- Before tagging `week-three-cli-packaging`: full Codex acceptance audit

---

## What Not to Build Yet

- Any web or Electron UI
- A real `ModelClient` that calls an external API
- Real fixture tools that make network requests
- npm publish / public registry release
- OTEL / telemetry export
- Cassette sharing or remote storage
- Semantic diff (by intent) or chaos fork (random mutation)
- Multi-agent or branching graph visualization
