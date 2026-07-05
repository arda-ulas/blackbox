# W3-A CLI Specification

## Purpose

Define the exact command shape, flag set, defaults, and test strategy for the `blackbox` CLI before any product code is written.

---

## Entry Point

**File:** `src/cli.ts`

**Runner:** `tsx src/cli.ts <subcommand> [flags]`

**Dev usage via npm script** (add to `package.json`):
```json
"cli": "tsx src/cli.ts"
```

Invoked as:
```sh
npm run cli -- record
npm run cli -- replay --trace traces/example-trace.json
npm run cli -- fork --trace traces/example-trace.json --mode tool-result --fork-index 4 --mutation-step 3 --payload-json '{"available":false}'
npm run cli -- diff --parent traces/example-trace.json --child traces/example-trace-fork.json
```

**W3-A interface:** `npm run cli -- <subcommand>` is the **only** supported interface for Week Three. No global binary, no `bin` entry in `package.json`, no `bin/blackbox.js`, no `npm link` step required.

A `#!/usr/bin/env tsx` shebang in a `bin/` wrapper is unreliable unless `tsx` is globally installed, which cannot be assumed. Packaging a proper global binary is a separate concern deferred to a later phase.

**W3-A package.json change:** Add exactly one script entry:
```json
"cli": "tsx src/cli.ts"
```

No `"bin"` field. No new files in `bin/`.

---

## Arg Parser

Hand-rolled. No external dependencies. Implementation contract:

- `process.argv[2]` is the subcommand.
- Remaining args are parsed left-to-right into a flat `Record<string, string | boolean>`.
- Flags starting with `--` become keys (strip leading `--`).
- The next arg that does not start with `--` is the value. If there is no next arg, or the next arg starts with `--`, the flag value is `true` (boolean flag).
- Unrecognised flags: print `Unknown flag: --<name>` to stderr and exit 1.
- Missing required flags: print `Missing required flag: --<name>` to stderr and exit 1.
- Unknown subcommand: print `Unknown subcommand: <name>. Valid: record, replay, fork, diff, list, inspect` to stderr and exit 1.
- No subcommand: print usage summary and exit 0.

---

## Commands

### `blackbox record`

Runs the scripted demo agent(s) and saves trace cassettes to disk.

**Flags:**

| Flag | Type | Default | Description |
|---|---|---|---|
| `--scenario` | `success \| error \| all` | `all` | Which demo trace(s) to generate |
| `--out-dir` | `string` | `traces` | Directory to write output files |

**Behavior:**

- `--scenario success` — runs the success demo (search → calendar → booking), saves `<out-dir>/example-trace.json`
- `--scenario error` — runs the error demo (model calls unknown tool `"flights"`), saves `<out-dir>/example-error-trace.json`
- `--scenario all` (default) — runs both in sequence; prints output for each

**Output format:** Mirrors current `example:record` terminal sections — `--- success trace ---` and `--- error trace ---`. Both files validated with `validateTrace` before write.

**Exit codes:** 0 on success, 1 if any trace fails to write or validate.

---

### `blackbox replay`

Loads a cassette from disk and replays it offline, printing a step-by-step event summary.

**Flags:**

| Flag | Type | Default | Description |
|---|---|---|---|
| `--trace` | `string` | `traces/example-trace.json` | Path to the cassette file |

**Behavior:**

- Loads via `loadTrace` (version-gated deserialization)
- Validates via `validateTrace`
- Calls `replayTrace` — no model client or tools instantiated
- Prints all events using the current `example:replay` output format
- Prints final status (`success` / `error`) and result or failure reason

**Exit codes:** 0 on success, 1 if load/validation fails.

---

### `blackbox fork`

Loads a parent cassette, forks at a given step with either a prompt mutation or tool-result mutation, continues the child run, saves the child cassette, and prints the first divergence diff.

**Flags:**

| Flag | Type | Required | Default | Description |
|---|---|---|---|---|
| `--trace` | `string` | No | `traces/example-trace.json` | Path to the parent cassette |
| `--out` | `string` | No | `traces/example-trace-fork.json` (parent path with `.json` → `-fork.json`) | Path to write the child cassette |
| `--fork-index` | `number` | No | `4` | Step index where child run begins |
| `--mode` | `prompt \| tool-result` | No | `tool-result` | Fork mutation mode |
| `--prompt` | `string` | Only if `--mode prompt` | — | Mutated prompt string (prompt mode only) |
| `--mutation-step` | `number` | Only if `--mode tool-result` | `3` | Parent step index to mutate (tool-result mode only) |
| `--payload-json` | `string` | Only if `--mode tool-result` | See demo default | JSON string for the injected tool result value |

**Demo default (no flags):** Matches current `example:fork` behavior — loads `traces/example-trace.json`, injects `{"results":[],"available":false,"message":"No hotels available for that date."}` at step 3, forks at step 4, saves `traces/example-trace-fork.json`.

**Behavior:**

- Validates parent cassette before forking
- Calls `forkRun` with the resolved options
- Validates child cassette after forking
- Saves child cassette to `--out`
- Prints the labeled terminal sections (original run / mutation / prefix / child run / trace diff) matching current `example:fork` output format

**Validation of `--payload-json`:** Parse with `JSON.parse`; print `Invalid JSON for --payload-json: <err>` and exit 1 on failure.

**Prompt-mode model behavior:** When `--mode prompt` is used, the child run needs a scripted model response. The CLI supplies a single hardcoded `FakeDeterministicModelClient` response: `{ type: "final_answer", text: "Prompt-mode fork complete." }`. This is a placeholder for W3-A; a richer scripted response or `--response-json` flag can be added in a later phase. The default demo (no flags) always uses the tool-result path and is unaffected.

**Exit codes:** 0 on success, 1 on any error (load, validation, fork, save).

---

### `blackbox diff`

Loads two cassettes and prints the first divergence.

**Flags:**

| Flag | Type | Required | Default | Description |
|---|---|---|---|---|
| `--parent` | `string` | Yes | — | Path to the parent/baseline cassette |
| `--child` | `string` | Yes | — | Path to the child/comparison cassette |

**Behavior:**

- Loads and validates both cassettes
- Calls `diffTraces(parent, child)`
- Prints output of `formatFirstDivergence(diff)`

**Exit codes:** 0 on success, 1 if either file fails to load or validate.

---

### `blackbox list`

Scans a directory for `.json` trace cassettes and prints a compact summary row for each one.

**Flags:**

| Flag | Type | Default | Description |
|---|---|---|---|
| `--dir` | `string` | `traces` | Directory to scan for trace files |

**Behavior:**

- Reads the directory with `readdir`; if the directory does not exist, prints a clear empty-state message and exits 0
- Filters for `.json` files; if none found, prints a clear empty-state message and exits 0
- For each `.json` file, calls `loadTrace` then `validateTrace`:
  - If both succeed, prints a compact row: `id`, `version`, `step count`, `status`, `createdAt`, and `parentId` if present
  - If either fails (malformed JSON, missing version, broken hash chain), prints a `[warning]` row with the error and does **not** count the file as successfully loaded
- Prints a summary line: `N of M file(s) loaded successfully.`

**Exit codes:** 0 always (list never crashes on bad files).

---

### `blackbox inspect`

Loads a single cassette, validates it, and prints detailed metadata plus a step-by-step timeline.

**Flags:**

| Flag | Type | Default | Description |
|---|---|---|---|
| `--trace` | `string` | `traces/example-trace.json` | Path to the cassette file |

**Behavior:**

- Loads via `loadTrace` (version-gated)
- Validates via `validateTrace` (exits 1 on hash-chain failure)
- Prints header: trace id, version, parentId if present, forkedFromStepId if present, createdAt (ISO), step count, status, result or failure reason
- Prints `--- steps ---` timeline: index, type, 8-char hash prefix, and a brief payload summary (same format as `replay`)

**Exit codes:** 0 on success, 1 if load or validation fails.

---

## Error Handling Contract

All subcommands follow this pattern:

1. Parse and validate flags (exit 1 on invalid input, before any file I/O)
2. Load files (exit 1 with path and error on failure)
3. Validate loaded traces (exit 1 with trace id and error on failure)
4. Execute core operation (exit 1 on any thrown error, print message to stderr)
5. Print output to stdout
6. Exit 0

All error messages are prefixed with `[blackbox error]`. All informational output is prefixed with `[blackbox]`.

---

## Test Strategy

**File:** `tests/cli.test.ts`

**Approach:** spawn `npm run cli -- <subcommand>` as a child process via Node's `child_process.execFile` (or `spawn`). Capture stdout/stderr and exit code. This tests the full dispatch path including arg parsing without mocking internals.

**W3-A scope — success paths only:**

| Test | Subcommand | What is asserted |
|---|---|---|
| `record --scenario success` | `record` | exits 0; `traces/example-trace.json` exists and loads via `loadTrace` |
| `record --scenario error` | `record` | exits 0; `traces/example-error-trace.json` exists and loads via `loadTrace` |
| `record` (default, all) | `record` | exits 0; both trace files exist |
| `replay` (default) | `replay` | exits 0; stdout contains `"success"` |
| `replay --trace <path>` | `replay` | exits 0; stdout contains step count |
| `fork` (default demo) | `fork` | exits 0; child cassette file exists and validates |
| `diff --parent <p> --child <c>` | `diff` | exits 0; stdout contains `"First divergence"` or `"no divergence"` |
| unknown subcommand | `badcmd` | exits 1; stderr contains `"Unknown subcommand"` |
| missing required flag | `diff` (no flags) | exits 1; stderr contains `"Missing required flag"` |

**What not to test in W3-A:**

- Internal arg parser unit tests (the child-process integration tests are sufficient)
- Every flag combination (only defaults and one explicit-flag case per command)
- Error paths beyond unknown subcommand and missing required flag

**Temp directory:** Each test that writes files should use a `--out-dir` pointing to a `tmp` dir created in `beforeAll` and cleaned up in `afterAll`. The `replay` and `diff` tests can operate on files written by the `record` test in the same `beforeAll`.

---

## package.json Changes

Add exactly one script entry:

```json
"scripts": {
  "cli": "tsx src/cli.ts"
}
```

No `"bin"` field. No `bin/` directory. No new dependencies. Global binary packaging is out of scope for W3-A.

---

## Non-Goals for W3-A

- Global binary / `npm link` / shebang wrapper (deferred to a later packaging phase)
- `"bin"` entry in `package.json`
- npm publish or public registry release
- Web UI or browser interface
- Real model API calls
- Real external tool calls
- New npm dependencies (no `commander`, `yargs`, `chalk`, `ora`, etc.)
- Hosted backend or remote cassette storage
- `blackbox list` and `blackbox inspect` subcommands (implemented in W3-B)
- Terminal color output (that is W3-C)
- `DEMO.md` (that is W3-D)
