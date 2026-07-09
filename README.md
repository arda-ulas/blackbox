# Blackbox

**Blackbox is a local, offline-by-default time-travel debugger for AI agents.** It records a multi-step
model/tool run as an append-only, hash-chained trace, replays that trace fully offline from the saved cassette,
forks at any step with a mutated prompt or injected tool result, and diffs the resulting execution histories to
find the first point where the two runs diverged — then verifies and self-checks the whole loop.

It is *active debugging*, not passive observability: you don't just watch an agent run, you re-run it from a past
step under a changed condition and see exactly what changes.

<img src="assets/brand/blackbox-readme-hero.svg"
     alt="Blackbox check command showing the offline record verify fork diff workflow passing."
     width="100%">

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

Plus one CI utility outside the loop: **assert** — pin a committed cassette as a regression test (the `verify`
invariants + declared exact-match expectations on the replayed outcome) with a scriptable PASS/FAIL exit code.

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

Blackbox is a **local, deterministic, offline-by-default** time-travel debugger. The full loop is complete,
hardened, composed under one self-check, proven live via opt-in scripts, and protected by a committed regression
corpus. **Cassette assertions** pin any committed cassette as a deterministic offline CI regression test, and an
**externally-shaped agent run** can be adapted into a first-class Blackbox cassette that verifies, replays, forks,
mutates, continues, and diffs fully offline.

- **What it is:** a local deterministic time-travel debugger for single-agent, tool-using runs — no UI, no backend,
  no live-by-default calls.
- **Trace format:** schema **v2** — tool rounds are recorded as structured, provider-neutral transcript parts
  (`MessagePart`) carrying a deterministic `toolCallId`. See [docs/03_trace_schema.md](docs/03_trace_schema.md).
- **Tests:** 583/583 passing, fully offline, zero live calls, no API key required.
- **Most recent technical milestone:** foreign-origin cassette active-debugging proof — an adapted foreign cassette
  forks, mutates, continues, and diffs under unchanged semantics (`week-eleven-foreign-fork-proof`).

See [DEMO.md](DEMO.md) for a full command-by-command walkthrough with expected output.

## What Blackbox is

- A **local, offline-by-default, deterministic** time-travel debugger for single-agent, tool-using runs.
- **Cassette record/replay** with a canonical SHA-256 hash chain.
- **Fork + mutate + diff** — branch from any step, change one thing, see what diverges.
- **Offline verify + one-shot check** — hygiene and a full-loop smoke test with PASS/FAIL exit codes.
- **Cassette assertions** — pin a committed cassette as a deterministic offline CI regression test using exact-match
  expectations over the replayed outcome, fully offline.
- **Foreign-transcript ingest** — adapt a synthetic, external-style transcript into a first-class Blackbox v2
  cassette that verifies, replays, asserts, forks, and diffs fully offline (a dependency-free adapter-boundary proof,
  not a framework integration).
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

A curated 3–5 minute path that shows the whole value: the native loop, the CI-assertion utility, and the
foreign-origin cassette as a first-class citizen of the active debugging loop. It is a guided tour, **not** an
exhaustive command list (see [DEMO.md](DEMO.md) and the sections below for the rest).

One-time setup (the only step that touches the network — it installs dependencies from the npm registry; no build
step is needed to run the offline loop):

```sh
npm install
```

Then seven fully offline proof commands. Everything after `npm install` runs **local, deterministic, and
fake/offline** — zero live calls, no API key:

```sh
npm test -- --run                                                    # 583 tests, fully offline, zero live calls
npm run cli -- check                                                 # native one-shot: record → verify → fork → verify → diff → single PASS
npm run cli -- assert --trace fixtures/traces/success-tool-use.v2.json \
  --expect-status success --expect-tools search,calendar,booking     # pin a committed cassette as a CI regression gate (exit 0/1)
npm run cli -- verify --trace fixtures/external/chat-tool-use.converted.v2.json   # a foreign-origin cassette passes all four invariants
npm run cli -- fork --trace fixtures/external/chat-tool-use.converted.v2.json \
  --out traces/chat-tool-use-fork.json --mode tool-result \
  --fork-index 4 --mutation-step 3 \
  --payload-json '{"city":"Paris","temperature_c":-2,"condition":"Heavy snow"}'   # mutate the foreign cassette's past and continue offline
npm run cli -- diff --parent fixtures/external/chat-tool-use.converted.v2.json \
  --child traces/chat-tool-use-fork.json                             # first structural divergence + behavioral outcome verdict
npm run cli -- assert --trace traces/chat-tool-use-fork.json \
  --expect-status success --expect-tools get_weather                 # pin the forked child's behavior
```

What is real vs. fake here: the trace/replay/fork/diff/verify/assert machinery is the real product code.
Commands that invoke a model use only local deterministic fakes: `FakeDeterministicModelClient` on scripted paths
and `ReactiveDemoModelClient` for continuation; default CLI tools are fixture stubs. `verify`, `diff`, and `assert`
invoke neither models nor tools. The forked child `traces/chat-tool-use-fork.json` is a **generated, local,
git-ignored** artifact (always written via the explicit `--out` shown above). When `fork` continues the foreign
cassette, it invokes only the local deterministic fake model under the demo harness — **foreign tools are never
executed, and no live provider or network call occurs.**

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
npm run cli -- assert --trace fixtures/traces/success-tool-use.v2.json --expect-status success --expect-tools search,calendar,booking
npm run cli -- check
npm run fixtures:generate
```

## Use a cassette as a CI regression test

`assert` turns any committed cassette into a deterministic, fully offline PASS/FAIL check. It runs the four
`verify` invariants (schema, hash chain, provider neutrality, replayability) and then, for each expectation flag
you supply, does an exact-match check against the cassette's replayed terminal outcome and tool-call sequence. It
exits `0` only when verification and every declared expectation pass, and `1` otherwise — so it drops straight into
an npm script or a GitHub Actions step. No model, tool, or network call is made.

```sh
npm run cli -- assert \
  --trace fixtures/traces/success-tool-use.v2.json \
  --expect-status success \
  --expect-tools search,calendar,booking
```

Expectations are opt-in and exact (no fuzzy or semantic matching): `--expect-status <success|error|incomplete>`,
`--expect-final-answer <string>`, `--expect-failure-reason <string>`, and `--expect-tools <comma-separated>` (an
empty string asserts a final-answer-only run with no tool calls). With no expectation flags, `assert` runs the
invariants only. In GitHub Actions:

```yaml
- run: npm ci
- run: npm run cli -- assert --trace fixtures/traces/success-tool-use.v2.json --expect-status success --expect-tools search,calendar,booking
```

See [DEMO.md](DEMO.md) for annotated expected output and an explanation of each step.

## Adapt a foreign transcript

Blackbox records its own runs, but it can also **adapt an externally-shaped agent run** into a normal Blackbox v2
cassette and then verify/replay/assert it fully offline. This is a small **adapter-boundary proof**, not a framework
integration: a pure, dependency-free adapter (`src/ingest/foreignTranscript.ts`, `adaptForeignTranscript`) converts a
local, synthetic chat-style transcript fixture into a valid v2 trace. It is **not** official OpenAI, SDK, LangChain,
or MCP support, and there is no live ingestion — the input is a committed local fixture, and the conversion never
calls a model, tool, network, or clock.

The proof point is provider-neutrality by construction: the synthetic source
(`fixtures/external/chat-tool-use.foreign.json`) deliberately carries provider-like noise (token `usage`, a
`finish_reason`, a model name, message ids, and foreign tool-call ids like `call_a1B2c3`), and **none** of it crosses
into the converted cassette — foreign tool-call ids are remapped to Blackbox's deterministic `call-0` / `call-1`, and
every payload is built field-by-field. The committed converted cassette
(`fixtures/external/chat-tool-use.converted.v2.json`) is an ordinary cassette the existing commands consume unchanged:

```sh
npm run cli -- verify --trace fixtures/external/chat-tool-use.converted.v2.json
npm run cli -- replay --trace fixtures/external/chat-tool-use.converted.v2.json
npm run cli -- assert --trace fixtures/external/chat-tool-use.converted.v2.json --expect-status success --expect-tools get_weather,send_email
```

The adapter accepts exactly one tool call per assistant turn in a strict sequential `tool call → tool result` loop
ending in a final answer; parallel tool calls and error terminations are out of scope for this proof and are rejected
with a clear error.

The adapted cassette is also **not second-class in the active debugging loop**: it forks, mutates, continues, and
diffs with the same Blackbox semantics as a native trace. Inject a different `get_weather` result at step 3, fork at
step 4, and the deterministic offline continuation derives a new answer from the injected payload — then diff pins
the first divergence and the behavioral outcome change:

```sh
npm run cli -- fork \
  --trace fixtures/external/chat-tool-use.converted.v2.json \
  --out traces/chat-tool-use-fork.json \
  --mode tool-result --fork-index 4 --mutation-step 3 \
  --payload-json '{"city":"Paris","temperature_c":-2,"condition":"Heavy snow"}'
npm run cli -- verify --trace traces/chat-tool-use-fork.json
npm run cli -- diff --parent fixtures/external/chat-tool-use.converted.v2.json --child traces/chat-tool-use-fork.json
npm run cli -- assert --trace traces/chat-tool-use-fork.json --expect-status success --expect-tools get_weather
```

The forked child is a git-ignored local artifact under `traces/` (always pass the explicit `--out` shown above). The
child shares a hash-identical prefix with the committed parent before the mutation, and its answer visibly embeds the
injected weather payload — change the payload, change the answer. As everywhere in the default CLI, the continuation
is fake/offline: the CLI fork runs under the demo harness (the reactive deterministic fake model plus the fixture
tool executor). Foreign tools are never executed; the only model invocation is the local deterministic fake, and no
live provider or network call is made. This proves debuggability of the adapted cassette, not foreign tool
execution.

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

### Week-Eight Terminal Experience Polish ✓ (`week-eight-terminal-polish`)

- **W8-A** — Terminal experience polish: one shared, premium terminal grammar across all eight commands via a new pure, dependency-free module `src/render/termStyle.ts` (`header` / `section` / `kv` / `verdict` / `palette` / `colorEnabled` / `GLYPH`). Banners become `◼ blackbox · <command>`, ad-hoc `--- x ---` sub-rules become dimmed section labels, the duplicated per-command `label()` closures collapse into one aligned `kv`, and PASS/FAIL is emphasized with color and `✓`/`✗` glyphs. Color is optional sugar gated by `colorEnabled({ isTTY, env })` — on only when `isTTY && !("NO_COLOR" in env) && !("CI" in env)`, computed **independently per output stream** so a redirected stderr stays escape-free even when stdout is a color TTY — so piped / `NO_COLOR` / `CI` output on **both** stdout and stderr is escape-free (a structural no-ANSI test guards it). Glyphs (`✓ ✗ → ▸ ◼`) are decorative; the text labels always carry the meaning (the header's `·` is punctuation, not a glyph). The four pure formatters (`formatFirstDivergence`, `formatOutcomeDiff`, `verifyExplain`, `stepLabels`) are byte-identical, so every frozen behavioral-diff spacing assertion holds. `check` stdout was re-baselined once, deliberately (before/after captured in `docs/27_week_eight_a_plan.md` and the build log); its exit code and the `runSelfCheck` return shape are unchanged and its output is byte-identical run-to-run. No schema / canonical-hash / replay-semantics / `replayTrace`-return / `forkRun` / `runSelfCheck`-logic / `diffTraces()`-computation / `TraceDiff`-`OutcomeDiff`-`VerifyReport`-shape / provider / fixture / generator / `package.json` / `.gitignore` change; no new command, flag, or exit code (489/489 offline, 442 + 47 new tests)

### Week-Eight README Hero ✓ (`week-eight-readme-hero`)

- **W8-B** — README hero polish (docs/assets-only): a hand-authored, static SVG (`assets/brand/blackbox-readme-hero.svg`) that renders the real `npm run cli -- check` output as **actual SVG text** — no raster, no AI-generated text, no external font/image/script/style, no base64 — embedded at the top of `README.md`. The CLI-derived lines are verified byte-for-byte against live `check` stdout; the two footer lines are verified separately against a fixed expected pair. No `src/`, `tests/`, `fixtures/`, `scripts/`, `package.json`, `package-lock.json`, `.gitignore`, or `DEMO.md` change; no CLI behavior/command/flag/exit-code change; no new dependency

### Week-Nine Cassette CI Harness ✓ (`week-nine-cassette-assert`)

- **W9-A** — Cassette CI harness: one new CLI command, `assert`, that turns a committed cassette into a deterministic, fully offline PASS/FAIL CI regression test. `npm run cli -- assert --trace <path> [expectation flags]` runs the four `verify` invariants and then, for each supplied expectation flag, does an **exact-match** check against the replayed terminal outcome (`terminalOutcome`) and tool-call sequence (`toolCallSequence`). Flags: `--trace` (required, unlike `verify`), `--expect-status <success|error|incomplete>`, `--expect-final-answer`, `--expect-failure-reason`, `--expect-tools` (comma-split, ordered; `""` ⇒ no tool calls). Exit 0 only when verification and every declared expectation pass; exit 1 otherwise. New pure module `src/workflow/assertCassette.ts` (`assertCassette` / `assertCassetteFile`); `src/cli.ts` gains `runAssert` + one dispatch case (add-only). `verify ⊂ assert` — invariants gate expectations, so on invariant failure the expectation checks become `skip` (never a silent pass); expectations come from CLI flags only (no cassette-embedded, no sidecar), exact match only. No schema / hash / `verifyTrace` / `terminalOutcome` / `toolCallSequence` / `replayTrace` / `forkRun` / `runSelfCheck` / `diffTraces` / `termStyle` / fixture / generator / `package.json` change; every other command's output including `check` is byte-identical. The CLI is now **nine commands** (522/522 offline, 489 + 33 new tests)

### Week-Ten Foreign Transcript Adapter ✓ (`week-ten-foreign-transcript-adapter`)

- **W10-A** — Foreign transcript adapter proof: a new pure, dependency-free module `src/ingest/foreignTranscript.ts` (`adaptForeignTranscript(input, { traceId })` / `ForeignTranscriptError`) converts a synthetic, chat-style external transcript into a normal Blackbox v2 `Trace` by **composing** the untouched `TraceRecorder` + `toolCallIdForIndex` — synchronous, deterministic, no filesystem/network/clock (`Date.now`)/model/tool access, with `createdAt` and every step timestamp sourced only from the transcript. It emits the exact `agentLoop` grammar (11 steps for the two-tool proof), remaps foreign tool-call ids to deterministic `call-N`, allowlist-maps tool declarations, builds every payload field-by-field, and rejects malformed input deterministically. Two committed `fixtures/external/` files (a synthetic source transcript carrying provider-noise sentinels + a read-only golden converted cassette) plus `tests/foreignTranscript.test.ts` prove that no foreign id / `usage` / `finish_reason` / model name crosses into the trace, and that the existing `verify` / `replay` / `assert` surfaces consume the converted cassette **unchanged**. An adapter-boundary proof, **not** a framework/SDK/LangChain/MCP/OpenAI integration and not live ingestion. No schema / hash / core / `cli.ts` / generator / `fixtures/traces/` / `package.json` change (522/522 → 559/559 offline, 37 new tests)

### Week-Eleven Foreign Fork Proof ✓ (`week-eleven-foreign-fork-proof`)

- **W11-A** — Fork foreign cassette proof (tests + docs only): one new test file, `tests/foreignFork.test.ts`, proves the committed foreign-origin cassette participates in the **active** debugging loop — `fork → mutate → continue → diff` — under the exact same, **unchanged** `forkRun` / `ReactiveDemoModelClient` / `diffTraces` / `diffOutcome` / `verifyTrace` / CLI semantics as a native trace. Primary geometry: mutate the `get_weather` `tool_result` at step 3, fork at index 4 — the child shares hash-identical steps 0–2 with the committed parent bytes, keeps `call-0` / `get_weather` / the parent timestamp on the mutated step (new hash, chained from step 2), verifies 4/4, replays to success, and its answer **derives** from the injected payload (two mutations → two answers). Behavioral diff: shared prefix 3, first divergence 3, both success, final answer changed, parent tools `[get_weather, send_email]` vs child `[get_weather]`. Secondary geometry (mutate step 7, fork 8) and spawned-CLI `fork`/`verify`/`diff`/`assert` integration (temp-dir, always explicit `--out`) included; the CLI continuation runs under the demo harness (fixture tool definitions, reactive fake model — foreign tools never executed). Zero source, fixture, CLI, dependency, or schema change; no committed child fixture (559/559 → 583/583 offline, 24 new tests)
