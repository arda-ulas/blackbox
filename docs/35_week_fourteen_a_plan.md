# W14-A Plan — npm Packaging-Readiness Proof (prepare only, no publish)

**Status:** IMPLEMENTED (in closeout). This document is the accepted plan and historical record; the sections below
describe what was planned and were carried out.
**Predecessor:** W13-A closed/tagged (`week-thirteen-worked-case-study`). Tests: 583/583 offline, zero live calls.
**Mode:** packaging-readiness only — prepare Blackbox as a locally installable npm CLI and prove it works from a
local tarball, **without publishing**. **No source/runtime behavior change** (no schema / hash / replay / fork /
diff / verify / assert change); no `package.json` script change; no new test, CLI command, or CLI flag.
**Tag policy:** after Codex closeout audit and push, this slice may be tagged `week-fourteen-package-readiness`.
**Publish policy:** publishing to npm remains **gated behind a separate, explicit go/no-go** after this audit. The
structural guard is `"private": true` in `package.json` — `npm pack` works with it, `npm publish` is refused by npm
itself. Removing `private` is the explicit go/no-go act, out of scope here.

---

## 1. Problem statement

Blackbox is presentation-ready as a local technical core (through W13-A). The one remaining reviewer-credibility gap
is packaging: a reviewer should be able to install and run the CLI like a real devtool, not only `npm run cli --`
inside a clone. W14-A closes that gap **without changing runtime semantics** — it adds package metadata, a bin
launcher, and a files whitelist, then proves the packaged command works offline from a local tarball. It does
**not** publish.

## 2. Scope

### 2.1 `package.json` (metadata + bin + files; scripts untouched)

- `name` → `@ardaulas/blackbox` (scoped; the bare `blackbox` is collision-prone on npm). The scope must match an npm
  username/org the human owns — **verified at publish go/no-go, not now** (renaming pre-publish is free).
- `version` → `0.1.0`; `description`, `license: "MIT"`, `repository`, `keywords`, `engines.node: ">=18"`.
- `bin: { "blackbox": "bin/blackbox.js" }`.
- `files: ["bin", "src", "fixtures", "README.md", "LICENSE"]` (README/package.json auto-included; the list is
  explicit for clarity).
- **`private: true` kept** as the structural publish guard.
- **`tsx` reclassified** from `devDependencies` to `dependencies` (already in the lockfile — a reclassification, not
  a new package). Named cost: tsx pulls esbuild platform binaries (optional deps), acceptable for a devtool; a
  `dist` bundle that would drop the runtime dep is explicitly deferred.
- **Scripts byte-identical** (so `npm test` / `npm run cli` behave exactly as before). Lockfile regenerated.

### 2.2 `bin/blackbox.js` (new — thin launcher, no logic)

A Node shim (shebang) that runs `src/cli.ts` through the packaged `tsx`: resolves `src/cli.ts` relative to itself and
`tsx`'s bin via `require.resolve("tsx/package.json")`, then `spawnSync(process.execPath, [tsxBin, cliEntry,
...argv])` with `stdio: "inherit"` and `process.exit(result.status ?? 1)`. It forwards argv verbatim, inherits stdio
(so TTY detection → the color gate and escape-free piped output still behave), propagates the child exit code
exactly (the `0`/`1` contracts of `verify` / `assert` / `check` are load-bearing), and prints nothing of its own.
**`src/` is not modified.** No build step, no `dist/`, no tsconfig change (bare `tsc` is red on pre-existing
project-wide diagnostics; shipping the sources + tsx avoids that churn).

### 2.3 `LICENSE` (new)

MIT, copyright Arda Ulas Ozdemir.

### 2.4 README (narrow, honest)

- One new short section, "Run it as a packaged CLI", showing the **tarball** flow (`npm pack` → install the `.tgz`
  in a temp dir → `npx blackbox check`), explicitly labeled **not published to npm** — no `npm install
  @ardaulas/blackbox` / `npx`-from-registry claim.
- Refine the "What Blackbox is not" package bullet to "Not yet npm-published — packaging is prepared and verified
  from a local tarball; publishing is a separate, explicit step."
- Untouched: the W12-A "For reviewers" block, the W13-A worked case study, the hero, Status counts (**583**), and the
  core-loop framing. W14-A is **not** added to Build history before its tag exists.

### 2.5 Bookkeeping

`docs/35_week_fourteen_a_plan.md` (this doc); a `docs/08_build_log.md` W14-A entry (packaging-readiness only; no
commit/tag/publish claimed; `private: true` retained); `CLAUDE.md` / `AGENTS.md` pointers (W13-A complete/tagged;
W14-A packaging-readiness in closeout; next task Codex audit → commit → push → tag; publish a separate go/no-go; no
W15).

## 3. File allowlist (exhaustive)

`package.json`, `package-lock.json` (regenerated), `bin/blackbox.js` (new), `LICENSE` (new),
`README.md` (narrow), `docs/35_week_fourteen_a_plan.md` (new), `docs/08_build_log.md`, `CLAUDE.md`, `AGENTS.md`.

**Untouched:** everything under `src/`, `tests/`, `fixtures/`, `scripts/`; `.gitignore`; `assets/brand/`;
`docs/11_cli_spec.md`; `DEMO.md`; all prior plan docs; every `package.json` script.

**Not added:** source behavior changes, tests, fixtures, `package.json` script changes, new CLI commands/flags,
`dist/`, a build step, tsconfig changes, a bundler dependency, dashboard/UI, hosted backend, real model integration,
LangChain/LangGraph/MCP integration, SDK/framework claims, an actual npm publish, W15 work.

## 4. Acceptance criteria

1. `npm pack --dry-run` lists exactly the whitelisted files (no `tests/` / `docs/` / `scripts/` / `assets/brand/` /
   `traces/`).
2. From a fresh temp dir, installing the local tarball yields a working `blackbox` command: bare `blackbox` prints
   the existing usage; `record → replay → fork → diff → verify → assert → check` all run fully offline, no API key.
3. Packaged `blackbox check` stdout is **byte-identical** to repo `npm run cli -- check` (same non-TTY conditions);
   exit codes preserved through the shim (`check` 0; a deliberately failing `assert` exits 1; unknown command
   exits 1).
4. `"private": true` present; nothing published.
5. Repo unchanged where frozen: `npm test -- --run` 583/583; `fixtures:generate` in sync; repo `check` byte-identical
   run-to-run; `git ls-files traces` empty; no `src/` / `tests/` / `fixtures/` / `scripts/` diff; `package.json`
   scripts byte-identical.
6. README packaging section makes no published-package claim; W14-A absent from Build history pre-tag; current counts
   stay 583.

## 5. Failure conditions (stop and escalate)

- The shim cannot preserve argv / exit codes / TTY behavior without touching `src/` — stop; that is a scoped source
  change needing its own approval.
- Any tsconfig/build-system change, `dist/` output, or new bundler dependency.
- Any `package.json` script change, new test, fixture change, or new CLI flag.
- Any actual publish, `npm login`, or registry write; any README claim of an installable published package.
- Packaged output diverging from repo CLI output.

## 6. Verification

`npm test -- --run` (583/583); `npm run fixtures:generate` (in sync); `npx tsx src/cli.ts check` twice
(byte-identical); `npm pack --dry-run` (whitelist); `npm pack`; install the tarball in a fresh temp dir; bare
`blackbox` (usage), `blackbox check` (byte-diff vs repo → empty), the full offline loop, a failing `assert` (exit 1);
`git ls-files traces` (empty); `git status --short --untracked-files=all` (only allowlisted files); `git diff
--check`; frozen-path `git diff --name-only HEAD` empty; `package.json` scripts byte-identical.

## 7. Rollback

Delete `bin/blackbox.js`, `LICENSE`, `docs/35_week_fourteen_a_plan.md`; revert `package.json`, `package-lock.json`,
`README.md`, `docs/08_build_log.md`, `CLAUDE.md`, `AGENTS.md`. No file under `src/`, `tests/`, `fixtures/`, or
`scripts/` is touched, so rollback cannot affect runtime behavior, test outcomes, or the corpus.
