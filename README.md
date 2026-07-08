# Blackbox

**Blackbox is a local, offline-by-default time-travel debugger for AI agents.** It records a multi-step
model/tool run as an append-only, hash-chained trace, replays that trace fully offline from the saved cassette,
forks at any step with a mutated prompt or injected tool result, and diffs the resulting execution histories to
find the first point where the two runs diverged — then verifies and self-checks the whole loop.

It is *active debugging*, not passive observability: you don't just watch an agent run, you re-run it from a past
step under a changed condition and see exactly what changes.

## The core loop

```
record → replay → fork → mutate → continue → diff → verify → check
```

- **record** — run a scripted, multi-step tool-using agent and save an append-only, canonically-hashed trace.
- **replay** — re-derive the whole run offline from the cassette; no model or tool is ever called.
- **fork** — branch from any past step, copying the parent prefix byte-for-byte.
- **mutate** — inject a different prompt or a different tool result at the fork point.
- **continue** — let the agent run on from the mutation with a deterministic model.
- **diff** — find and print the first step where parent and child diverge.
- **verify** — run one ordered hygiene pass over a cassette (schema, hash chain, provider neutrality, offline replay).
- **check** — run the whole loop end-to-end in one command and report a single PASS/FAIL.

## What it proves

- **Offline replay is a structural guarantee, not a convention.** `replayTrace(trace)` takes *only* a `Trace` — no
  model client, no tools — so it is impossible to make a live call from inside replay.
- **Fork prefixes are hash-identical.** A forked child shares a byte-for-byte, SHA-256-identical prefix with its
  parent up to the mutation point; the diff pinpoints the first divergence.
- **The full loop is proven against a real provider.** Opt-in, human-run proof scripts confirmed the complete
  `record → replay → fork → mutate → continue → diff` loop against the live Anthropic Messages API — without ever
  persisting a provider-native id, usage, stop metadata, or a key.
- **A committed corpus guards cassette compatibility.** A small, frozen, fake/offline v2 trace corpus with frozen
  hashes fails loudly if a future change would silently break cassette compatibility, hashing, replay, or fork
  geometry.

## Status

**Week Seven behavioral outcome diff (W7-B) — implemented / in closeout. W7-A (reactive fake model) closed and
tagged.** The local loop is complete, hardened, composed under one self-check, proven live via opt-in scripts, and
protected by a committed regression corpus. W7-A made the offline fork/`check` continuation *derive* the child's
answer from the mutated `tool_result`; W7-B makes `diff` and `fork` report how the two runs' *terminal behavior*
differs (final status, final answer, tool-call path), computed offline from the two traces — still fake/offline,
deterministic, zero live calls, no real model in the default CLI.

- **Current milestone:** W7-B (behavioral outcome diff); intended tag `week-seven-behavioral-outcome-diff`.
- **Latest technical-capability tag:** `week-seven-reactive-fake-model` (W7-A — reactive deterministic fake model).
- **Latest release-freeze tag:** `week-six-release-freeze` (W6-C — demo surface release freeze + README/DEMO
  verification).
- **Tests:** 442/442 passing, fully offline, zero live calls, no API key required.
- **Trace format:** schema **v2** — tool rounds are recorded as structured, provider-neutral transcript parts
  (`MessagePart`) carrying a deterministic `toolCallId`. See [docs/03_trace_schema.md](docs/03_trace_schema.md).

See [DEMO.md](DEMO.md) for a full command-by-command walkthrough with expected output.

## What Blackbox is

- A **local, offline-by-default, deterministic** time-travel debugger for single-agent, tool-using runs.
- **Cassette record/replay** with a canonical SHA-256 hash chain.
- **Fork + mutate + diff** — branch from any step, change one thing, see what diverges.
- **Offline verify + one-shot check** — hygiene and a full-loop smoke test with PASS/FAIL exit codes.
- A **committed fake/offline regression corpus** that freezes the loop's guarantees under version control.
- An **opt-in, human-run live proof** against Anthropic — run manually, never by the default CLI or `npm test`.

## What Blackbox is not

- **Not** a web UI, dashboard, backend, hosted service, or sharing platform.
- **Not** an observability / OpenTelemetry / metrics / log-aggregation platform.
- **Not** an agent framework (no LangChain, LlamaIndex, or MCP), and **not** a multi-agent orchestrator.
- **Not** an npm-published binary or a production SDK.
- **Not** live-by-default: no CLI command and no test in `npm test` calls a real model or tool.

## Proof status

| Area | Status |
|---|---|
| Default loop (CLI + `npm test`) | **Fake / offline** — deterministic model clients (`FakeDeterministicModelClient` scripted + `ReactiveDemoModelClient` reactive fork/`check` continuation) + fixture tools; zero live calls; replay is structurally offline |
| Live provider proof | **Opt-in proof scripts only** — three human-run, key-gated scripts (`example:real-proof`, `example:real-tooluse-proof`, `example:real-fork-proof`); never in `npm test`, never CLI-wired; record real runs, replay offline. The full live `record → replay → fork → mutate → continue → diff` loop is proven (W4-E) |
| Regression corpus | **Committed** fake/offline v2 cassettes under `fixtures/traces/` with frozen hashes (W5-A) guarding cassette compatibility |
| UI / backend / dashboard / observability | **None, by design** — a discipline, not a TODO |

For the full real-vs-mocked breakdown, see the [What Is Real vs. Mocked](DEMO.md#what-is-real-vs-mocked) table in
DEMO.md.

## For reviewers

The whole offline loop verifies in four commands, no API key required:

```sh
npm install                 # no build step needed to run the offline loop
npm test -- --run           # 442 tests, fully offline, zero live calls
npm run cli -- check        # one-shot: record → verify → fork → verify → diff → single PASS
npm run fixtures:generate   # check mode: confirms the committed regression corpus is in sync
```

## Quick Start

```sh
npm install
npm test -- --run
npm run cli -- record
npm run cli -- list
npm run cli -- inspect
npm run cli -- replay
npm run cli -- fork
npm run cli -- diff --parent traces/example-trace.json --child traces/example-trace-fork.json
npm run cli -- verify --trace traces/example-trace.json
npm run cli -- check
npm run fixtures:generate
```

See [DEMO.md](DEMO.md) for annotated expected output and an explanation of each step.

## Trace fixture corpus

`fixtures/traces/` holds a small **committed** set of deterministic, fake/offline v2 cassettes used as a
regression baseline (distinct from `traces/`, the git-ignored output of `record`/`fork`/`check`). Every fixture is
generated only from the fake model + fixture tools — no Anthropic/live/provider data — and is timestamp-normalized
so it is byte-reproducible.

Regenerate deliberately (only when a v2 change is intentional and audited):

```sh
npm run fixtures:generate            # check mode: verify the corpus is in sync (writes nothing)
npm run fixtures:generate -- --write # rewrite the corpus; then update the frozen hashes in tests/fixtures.test.ts
```

See `docs/20_week_five_a_plan.md` §7 for the regeneration policy.

---

## Build history

Blackbox was built in weekly milestones. Each is complete and tagged; the sections below are the accurate build
record, not the project's current headline (see **Status** above for that).

### Week-One Proof ✓ (`week-one-cli-proof`)

- Record one multi-step tool-using agent run; save an append-only hash-chained trace
- Replay the run fully offline from cassette
- Fork at step `k` with a mutated prompt; verify the child shares a canonical-hash-identical prefix
- Print a terminal diff showing the first divergence

### Week-Two Hardening ✓ (`week-two-core-hardening`)

- **W2-A** — Cassette schema versioning: `loadTrace` rejects stale or unsupported cassettes
- **W2-B** — Tool-result mutation: inject a different result at any prefix step, re-chain from that point onward
- **W2-C** — Fork-point semantics: defined and documented for every step type; `metadata` steps rejected as fork points
- **W2-D** — Richer demos: success path (search → calendar → booking) and error path (unknown tool); `example:fork` demonstrates tool-result mutation

### Week-Three CLI ✓ (`week-three-cli-packaging`)

- **W3-A** — Unified `npm run cli --` entry point with `record`, `replay`, `fork`, `diff`; hand-rolled arg parser; flag validation
- **W3-B** — `list` and `inspect`; `list` validates hash chains before counting files as valid
- **W3-C** — Terminal output polish: consistent section headers, human-readable divergence summary, `[blackbox]` prefixes
- **W3-D** — Demo walkthrough ([DEMO.md](DEMO.md))

### Week-Four Hardening ✓ (`week-four-*`)

- **W4-A…E** — Provider-neutral adapter boundary; optional opt-in Anthropic proof scripts (never in `npm test`, no CLI wiring); structured v2 transcript; full live `record → replay → fork → mutate → continue → diff` loop proven against Anthropic
- **W4-F** — Cassette verification + trace hygiene: `npm run cli -- verify --trace <path>` checks schema version, hash chain, provider-neutrality, and offline replayability, reporting PASS/FAIL and the first failing invariant. Reusable core: `verifyTrace` / `verifyTraceFile` (`src/trace/verifyTrace.ts`) and the neutrality audit (`src/trace/neutrality.ts`)
- **W4-G** — Fork/verify workflow polish: `npm run cli -- check` runs the whole offline loop (record → verify → fork → verify → diff) in one command and reports a single PASS/FAIL verdict (in-memory by default; `--out-dir <dir>` persists the parent + child cassettes). Reusable core: `runSelfCheck` (`src/workflow/selfCheck.ts`). `fork` refuses to overwrite its own parent trace

### Week-Five Regression Hardening ✓ (`week-five-trace-fixture-corpus`)

- **W5-A** — Trace fixture corpus + regression harness: a small committed, fake/offline v2 corpus under `fixtures/traces/` plus `tests/fixtures.test.ts`, which loads the frozen cassettes and asserts every core invariant against them — schema version, hash chain, **frozen expected hashes**, provider neutrality, offline replay, terminal-error verification, fork-prefix hash identity, and a frozen first-divergence index. This turns the loop's guarantees into a version-controlled baseline so a future change cannot silently break cassette compatibility

### Week-Five Public Demo Readiness ✓ (`week-five-public-demo-readiness`)

- **W5-B** — Public demo narrative + repo readiness (docs-only): re-authored README as the repo front door (what Blackbox is / is not, "What it proves", "Proof status", a four-command "For reviewers" path), tightened DEMO, and refreshed the current-state pointers in `AGENTS.md` / `CLAUDE.md`. No source, test, fixture, config, runtime, CLI, or provider change

### Week-Six Diff/Inspect Ergonomics ✓ (`week-six-diff-inspect-ergonomics`)

- **W6-A** — Diff/inspect legibility: a shared, pure presentation helper (`src/trace/stepLabels.ts`) makes `diff`/`fork` show the value that actually changed at a divergence in human words (`changed value (<field>):`) instead of a truncated JSON dump. Replay output is byte-identical (verbatim lift); no schema, hash, fixture, or CLI-surface change

### Week-Six Verify/Replay Explanations ✓ (`week-six-verify-replay-explanations`)

- **W6-B** — Verify failure explanations: a pure presentation helper (`src/trace/verifyExplain.ts`) renders a labelled `verify` FAIL block (`invariant:` / `at:` / `detail:` / plain-language `action:`) per invariant class, with leaked secrets still masked as `<api-key-value>`. The `verify` PASS path and the `VerifyReport` shape are unchanged; no schema, hash, fixture, or CLI-surface change

### Week-Six Release Freeze ✓ (`week-six-release-freeze`)

- **W6-C** — Release freeze + README/DEMO verification (docs-only): verified every command in README/DEMO against `package.json` and `src/cli.ts`, reconciled the public docs to the true repo state (test count 394/394, current status/tag wording, complete build history, consistent core-loop string), and refreshed the `AGENTS.md` / `CLAUDE.md` current-state pointers. No source, test, fixture, config, runtime, CLI, or provider change

### Week-Seven Reactive Fake Model ✓ (`week-seven-reactive-fake-model`)

- **W7-A** — Reactive deterministic fake model: the offline fork/`check` continuation now *derives* the child's answer from the mutated `tool_result` via a new pure, deterministic `ReactiveDemoModelClient` (`src/agent/reactiveDemoModel.ts`) that reads the reconstructed transcript and embeds the mutated payload's field — so changing the mutation changes the answer — replacing the former hardcoded continuation strings at the `cli fork` and `check` injection sites. Still fake/offline, deterministic, zero live calls, no real model in the default CLI. `FakeDeterministicModelClient`, `forkRun`, the trace schema, canonical hashing, replay/diff/verify, the fixture corpus and generator, `package.json`, and the CLI surface are unchanged; `check` stdout is byte-identical (417/417 offline, 394 + 23 new tests)

### Week-Seven Behavioral Outcome Diff ✓ (`week-seven-behavioral-outcome-diff`)

- **W7-B** — Behavioral outcome diff: `diff` and `fork` now report an `Outcome:` verdict describing how the two runs' *terminal behavior* differs — final status, final answer (or failure reason), and tool-call path — computed offline from the two traces by exact-string comparison (no model call, no semantic judge). New pure modules `src/trace/traceOutcome.ts` (`terminalOutcome` / `toolCallSequence`) and `src/fork/diffOutcome.ts` (`diffOutcome` / `formatOutcomeDiff`), plus a `formatDiffReport` wrapper that appends the verdict to the unchanged structural divergence block. `replayTrace` now derives its terminal fields from the shared `terminalOutcome` (returned fields and CLI `replay` output byte-identical). The `diffTraces()` computation, the `TraceDiff` shape, `formatFirstDivergence`, `forkRun`, the schema, canonical hashing, the fixture corpus and generator, `package.json`, and the CLI surface are unchanged; `check` stdout is byte-identical (442/442 offline, 417 + 25 new tests)
