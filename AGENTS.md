# Blackbox — Agent Workflow Guardrails

## Project Identity

Blackbox is a **local TypeScript time-travel debugger for AI agents**.

Core value: **active debugging** — not passive observability.

```
record -> replay -> fork -> mutate -> continue -> diff
```

The local TypeScript CLI core comes before any UI, backend, or platform work. Do not conflate Blackbox with a generic observability dashboard, LLM monitoring platform, or hosted service.

---

## Build Scope Guardrails

Do not build any of the following unless the current milestone explicitly plans it:

- Web UI, dashboard, React components, design polish
- Hosted backend, remote cassette storage, auth, sharing
- LangChain, LlamaIndex, MCP proxy, agent frameworks, prompt platforms
- Metrics charts, OTEL export, semantic diff, chaos fork
- Multi-agent orchestration, production SDK, timeline UI, branch graph

**Invariants that apply to every milestone:**

- **Fake deterministic model/tools remain default.** Fake, offline, deterministic model clients and `defaultFixtureTools()` are the default in all tests and CLI commands unless a milestone explicitly changes that: `FakeDeterministicModelClient` (scripted) on record/scripted paths, and `ReactiveDemoModelClient` (reactive, transcript-reading) on the fork/`check` continuation path (W7-A). Both are fake/offline with zero live calls and require no API key.
- **Replay must never call the model, provider, or tools.** `replayTrace(trace)` takes only a `Trace`; it cannot inject live behavior by construction. This must remain true.
- **API keys must never be logged, recorded, or stored in traces.** No key, token, or credential may appear in `TraceStep.payload`, trace metadata, log output, or any file written to disk.
- **Raw provider/SDK objects must never enter trace payloads.** Adapters catch SDK errors and normalize them to `ModelCallError` before re-throwing. Provider-native fields (`tool_use_id`, `usage`, `message.id`, etc.) must not appear in `ModelOutput` or `TraceStep.payload`.

---

## Documentation Rule: External SDKs and APIs

**Before touching any external SDK or API behavior:**

1. Use **Context7** (when available) to fetch current documentation. Do not rely on training-data knowledge alone.
2. Also inspect **installed TypeScript types** (`node_modules/<sdk>/`) directly for exact call shapes, response types, and error class hierarchies.
3. Consult **official documentation** when Context7 and installed types diverge or are insufficient.
4. **Do not guess** SDK request shapes, response fields, tool schemas, error class constructors, or overload resolution.
5. **Summarize verified assumptions** from docs/types in the implementation commit summary or PR description when the work touches provider boundaries.
6. If Context7, installed types, and official docs disagree with each other or with the implementation plan — **stop and ask for an audit before implementing.**
7. **Before closing any SDK/API milestone, run a docs/types drift check:** confirm the docs describe what was actually implemented (call shapes, trace paths, scope, deferred work) and that no doc overclaims a capability the code does not prove. Reconcile any drift before tagging.

This rule exists because missed assumptions at SDK boundaries produce bugs that only surface with live API keys. They are expensive to find and expensive to fix after tests pass.

---

## Test Rule

- **No live provider calls in the default test suite.** `npm test -- --run` must pass with zero real provider calls and no API key present.
- **Provider integrations must use mocked/injected clients by default.** Adapters must accept an optional `client` injection parameter so tests can supply a fake without reading env vars.
- **Live smoke tests are explicit opt-in and skipped by default.** Guard with `describe.skipIf(!process.env.ANTHROPIC_API_KEY)(...)` or equivalent. Live tests belong in a separate proof script, not in `npm test`.
- **Existing `npm test` and CLI demo commands must keep passing** after every commit. Verify: `npm test -- --run`, `npm run cli -- record`, `npm run cli -- replay`, `npm run cli -- fork`.

---

## Agent Roles

| Agent | Role | Constraints |
|---|---|---|
| **Claude Code** | Small implementation/doc slices only | Follow CLAUDE.md scope; do not exceed the current milestone |
| **Codex** | Repo-aware audit before milestone closure or risky transitions | Read full source; return verdict + specific patch list |
| **Opus** | High-risk architecture/SDK-boundary audit only | Not for routine implementation; invoked only at explicit checkpoints |
| **Context7 / installed types / official docs** | Required for all SDK/API work | Must be consulted and summarized before implementing provider boundaries |
| **Perplexity / web search** | Bounded source-backed research only when docs/types are insufficient | Cite sources; flag if findings contradict installed types |
| **Gemini** | Optional red-team critique only | Not a decision authority; findings must be reconciled with Codex/Opus audit |

---

## Current State: W13-A worked debugging case study (W12-A closed and tagged)

**W13-A (worked debugging case study) is implemented / in closeout** per `docs/34_week_thirteen_a_plan.md`; intended
tag `week-thirteen-worked-case-study`. It is a **documentation-only** slice with **no new engine feature**, closing
the external-audit "a cold reviewer cannot see one concrete bug" gap. It adds one README section, "Worked example:
debugging one bad answer", that debugs a single bug end to end over the native corpus cassette
`fixtures/traces/success-tool-use.v2.json`: the recorded run booked a room off a wrong `search` result at step 3;
`replay` shows the bad answer (`Result: Hotel booked for Alice on 2024-03-15 at 14:00.`); `fork --mode tool-result
--fork-index 4 --mutation-step 3 --payload-json '{"results":[],"available":false,"message":"No hotels available for
that date."}' --out traces/case-study-fix.json` injects the corrected no-availability result; the deterministic
`ReactiveDemoModelClient` continuation **derives** a decline instead of a booking; `diff` pins `First divergence at
index 3` with the changed `result` and the behavioral `Outcome:` verdict (same status, final answer changed, tool
path `search → calendar → booking` → `search`); `assert --expect-status success --expect-final-answer '<exact derived
string>' --expect-tools search` pins the corrected child as a regression gate. All excerpts are captured
byte-for-byte from real non-TTY runs. Codex correction: the final `assert` **must** carry `--expect-final-answer`
(status/tools alone would pass without pinning the corrected answer, which is the point); `verify ⊂ assert` re-proves
the child's four invariants. Also one functional-positioning tighten in "What Blackbox is not" (Blackbox sits beside
frameworks, does not run your agent; no LangGraph/LangChain/MCP support claim). The section states real-vs-fake
plainly (real machinery over a committed cassette; deterministic fake model; fixture tool stubs; no live
provider/network call; `traces/case-study-fix.json` generated/local/git-ignored; a framing device, **not** automatic
bug-finding). Files touched: `README.md`, `docs/34_week_thirteen_a_plan.md`, `docs/08_build_log.md`, `CLAUDE.md`,
`AGENTS.md`. **DEMO.md left untouched**; the W12-A "For reviewers" block is byte-unchanged; W13-A is **not** added to
README Build history pre-tag. No source / test / fixture / `scripts/` / `package.json` / `package-lock.json` /
`.gitignore` / `assets/brand/` / `docs/11_cli_spec.md` / `DEMO.md` change; no new test, npm script, CLI command,
flag, or dependency; test total unchanged at **583/583**; the README hero is unchanged. Next: Codex closeout audit →
commit → push → tag `week-thirteen-worked-case-study`; no W14 (npm-packaging candidacy) until scoped and audited.

**W12-A (reviewer demo path) is complete and tagged (`week-twelve-reviewer-demo-path`)** per
`docs/33_week_twelve_a_plan.md`. It is a **documentation-only** reconciliation slice on top of the tagged W10-A/W11-A:
it advances README Status to 583/583 with durable wording (most recent technical milestone = the foreign-origin
cassette active-debugging proof, `week-eleven-foreign-fork-proof`; no "in closeout"/"intended tag"/"latest tag"),
adds a "What Blackbox is" bullet for foreign-transcript ingest, appends W10-A/W11-A to Build history, and replaces
README "For reviewers" with a curated 3–5 minute path (one-time `npm install`, then seven fully offline proof
commands: `npm test`, native `check`, committed-cassette `assert`, foreign `verify`/`fork`/`diff`, forked-child
`assert`) annotated with what is real vs fake/offline (local deterministic fake model + fixture tools; generated
git-ignored child; foreign tools never executed; no live provider/network call). DEMO.md gains the foreign-cassette
reviewer commands + real-vs-mocked rows and its Prerequisites count is corrected to 583; no existing DEMO step body,
command, or expected-output block is edited, and historical 522/559 counts inside milestone history are preserved.
Files touched: `README.md`, `DEMO.md`, `docs/33_week_twelve_a_plan.md`, `docs/08_build_log.md`, `CLAUDE.md`,
`AGENTS.md`. No source / test / fixture / `scripts/` / `package.json` / `package-lock.json` / `.gitignore` /
`assets/brand/` / `docs/11_cli_spec.md` change; no new test, npm script, CLI command, flag, or dependency; test total
unchanged at **583/583**; the README hero is unchanged. Landed at **583/583** offline, zero live calls, no API key.

**W11-A (fork foreign cassette proof) is complete and tagged (`week-eleven-foreign-fork-proof`)** per
`docs/32_week_eleven_a_plan.md`. It is a **tests + docs only** slice — zero source changes, zero fixture
changes, zero CLI changes, zero dependencies. One new test file, `tests/foreignFork.test.ts` (24 tests), proves the
committed foreign-origin cassette `fixtures/external/chat-tool-use.converted.v2.json` participates in the ACTIVE
debugging loop — `fork → mutate → continue → diff` — under the exact same, **unchanged** Blackbox semantics as a
native trace (`forkRun`, `ReactiveDemoModelClient`, `diffTraces`, `diffOutcome`, `verifyTrace`, and the CLI surfaces
are all untouched). Primary geometry: mutate the `get_weather` `tool_result` at step 3, fork at index 4 — the child
shares hash-identical steps 0–2 with the **committed parent bytes**, keeps `call-0`/`get_weather`/the parent
timestamp on the mutated step 3 (new hash, chained from step 2), carries `parentId`/`forkedFromStepId` lineage,
validates, verifies 4/4, replays to success, passes neutrality, and its final answer **derives** from the injected
payload (embeds the mutated weather facts; two mutations → two answers; same mutation → same answer). A test-local
`ToolExecutor` lifts the **foreign** tool definitions from the parent's own recorded step-0 `model_input`
(`execute()` throws and is asserted never called — no foreign tool is ever executed). Behavioral diff: shared prefix
3, first divergence 3, both success, final answer changed, parent tools `[get_weather, send_email]` vs child
`[get_weather]`. Secondary geometry: mutate `send_email`'s result at step 7, fork at 8 (divergence 7, reconstruction
across both foreign rounds, answer changed, tool sequence intact). CLI integration runs `fork`/`verify`/`diff`/
`assert` on the foreign parent (temp-dir child, always explicit `--out`); the CLI continuation is **documented
demo-harness behavior** — it injects `defaultToolExecutor()`, so the child's continuation `model_input` records the
fixture tool definitions (`search`/`calendar`/`booking`); the CLI does **not** preserve foreign tool definitions and
no doc claims it does. Deliberately not frozen: full child bytes, continuation hashes, child timestamps; **no child
fixture committed** — reviewers create the child live into git-ignored `traces/`. `fixtures/external/` still contains
exactly the two committed W10-A files. Landed at **583/583** offline (559 + 24 new), zero live calls, no API key.

**W10-A (foreign transcript adapter proof) is complete and tagged (`week-ten-foreign-transcript-adapter`)** per
`docs/31_week_ten_a_plan.md`. It is an additive adapter-boundary proof: a new pure, dependency-free
module `src/ingest/foreignTranscript.ts` (`adaptForeignTranscript(input, { traceId })` / `ForeignTranscriptError`)
converts a synthetic, chat-style external transcript into a normal Blackbox v2 `Trace` by **composing** the untouched
`TraceRecorder` + `toolCallIdForIndex` — synchronous, deterministic, no filesystem/network/clock (`Date.now`)/
environment/model/tool access, with `createdAt` and every step timestamp sourced only from the transcript. It emits
the exact `agentLoop` grammar (11 steps for the two-tool proof), remaps foreign tool-call ids to deterministic
`call-N`, allowlist-maps tool declarations (`function.name`→name / `function.description`→description /
`function.parameters`→inputSchema), builds every payload field-by-field (foreign objects deep-validated/cloned, never
spread), and rejects malformed input deterministically. Two committed `fixtures/external/` files (a synthetic source
transcript carrying provider-noise sentinels + a **read-only** golden converted cassette) and
`tests/foreignTranscript.test.ts` prove that no foreign id / `usage` / `finish_reason` / model name crosses into the
trace, and that the existing `verify` / `replay` / `assert` surfaces consume the converted cassette **unchanged**.
This is an adapter-boundary proof, **not** a framework/SDK/LangChain/MCP/OpenAI integration and **not** live ingestion.
No schema / `hash.ts` / canonical-hash / `validateTrace` / `replayTrace` / `verifyTrace` / `assertCassette` /
`terminalOutcome` / `toolCallSequence` / `forkRun` / `diffTraces` / `termStyle` / `cli.ts` / generator /
`fixtures/traces/` / `package.json` / `package-lock.json` / `.gitignore` / `DEMO.md` / `docs/11_cli_spec.md` /
`assets/brand/` change; no new command, flag, or dependency; every other command's output including `check` is
byte-identical. Landed at **559/559** offline (522 + 37 new), zero live calls, no API key.

**W9-B (documentation-only public-readiness refresh) is complete and tagged (`week-nine-public-readiness`)** per
`docs/30_week_nine_b_plan.md`, a docs-only slice on top of the tagged W9-A: it rewrote the README Status in durable
public language, surfaced the `assert` capability in "What Blackbox is," appended the W8-B/W9-A build-history entries,
and refreshed the `CLAUDE.md`/`AGENTS.md` current-state pointers. Files touched: `README.md`, `CLAUDE.md`, `AGENTS.md`,
`docs/30_week_nine_b_plan.md`, `docs/08_build_log.md`. No source / test / fixture / `package.json` / `package-lock.json`
/ `.gitignore` / `DEMO.md` / `docs/11_cli_spec.md` / `assets/brand/` change; no runtime behavior change.

**W9-A (cassette CI harness) is complete and tagged (`week-nine-cassette-assert`)** per `docs/29_week_nine_a_plan.md`:
one new CLI command, `assert`, that turns a committed cassette into a deterministic, fully offline
PASS/FAIL CI regression test. `npm run cli -- assert --trace <path> [expectation flags]` runs the four existing
`verifyTrace` invariants and then, for each supplied expectation flag, does an **exact-match** check against the
replayed terminal outcome (`terminalOutcome`) and tool-call sequence (`toolCallSequence`). Flags: `--trace`
(**required**, unlike `verify`), `--expect-status <success|error|incomplete>` (enum-validated), `--expect-final-answer`,
`--expect-failure-reason`, `--expect-tools` (comma-split, trimmed, ordered; `""` ⇒ `[]`). Exit 0 only when
verification and every supplied expectation pass; exit 1 on invariant failure, expectation failure,
load/JSON/version failure, missing `--trace`, bad enum, unknown flag, or missing flag value. New **pure** module
`src/workflow/assertCassette.ts` (`assertCassette` / `assertCassetteFile` + `AssertExpectations` / `AssertCheck` /
`AssertReport`); `src/cli.ts` gains `runAssert` + one dispatch case (add-only). `verify ⊂ assert` — invariants gate
expectations, so on invariant failure the supplied expectation checks become `skip` (never a silent pass); on load
failure `assertCassetteFile` returns a structured FAIL report (no throw), delegating the verdict to the unchanged
`verifyTraceFile`. Expectations come from CLI flags only (no cassette-embedded expectations, no sidecar file); exact
string / ordered comparison only (no fuzzy or semantic matching, per W7-B). Rendering reuses the W8-A helpers only
(`header` / `kv` / `verdict` / `section`, no new glyph or color). **No** schema / `hash.ts` / canonical-hash /
`verifyTrace` / `verifyTraceFile` / `terminalOutcome` / `toolCallSequence` / `replayTrace` / `forkRun` /
`runSelfCheck` / `diffTraces` / `diffOutcome` / `termStyle` / frozen-formatter / fixture / generator /
`package.json` / `package-lock.json` / `.gitignore` / `assets/brand/` change; `docs/11_cli_spec.md` (historical W3-A
spec) left untouched by design; no new dependency; every other command's output including `check` is byte-identical.
The CLI is now **nine commands** (record, replay, fork, diff, verify, assert, check, list, inspect). Baseline
**522/522** offline (489 + 33 new), zero live calls, no API key. Tagged `week-nine-cassette-assert`.

W8-B (README hero polish) is **closed and tagged** (`week-eight-readme-hero`) per `docs/28_week_eight_b_plan.md`: a
docs/assets-only slice adding a hand-authored, static SVG README hero (`assets/brand/blackbox-readme-hero.svg`) that
renders the real `check` output as actual SVG text (CLI-derived lines verified byte-for-byte against live stdout;
footer verified separately), embedded at the top of `README.md`.

W8-A (terminal experience polish) is **closed and tagged** (`week-eight-terminal-polish`) per
`docs/27_week_eight_a_plan.md`: a presentation-only slice across the whole CLI. A new pure, dependency-free module
`src/render/termStyle.ts` (`header` / `section` / `kv` / `verdict` / `palette` / `errorPrefix` / `colorEnabled` /
`GLYPH`) supplies one shared terminal grammar, and `src/cli.ts` restyles all eight command surfaces through it:
banners become `◼ blackbox · <command>`, ad-hoc `--- x ---` sub-rules become dimmed section labels, the duplicated
per-command `label()` closures collapse into one aligned `kv`, and PASS/FAIL is emphasized with color and `✓`/`✗`.
Color is gated by `colorEnabled({ isTTY, env })` — on only when `isTTY && !("NO_COLOR" in env) && !("CI" in env)`, a
deliberate Blackbox-local presence check — computed **once per output stream** (an independent stdout and stderr
decision, so a redirected stderr stays escape-free even when stdout is a color TTY), so non-TTY / piped / CI output
on **both** streams is escape-free (a structural no-ANSI test guards it). Glyphs are decorative; the text labels
carry the meaning (the header's `·` is punctuation, not a glyph). The
four pure formatters (`formatFirstDivergence`, `formatOutcomeDiff`, `verifyExplain`, `stepLabels`) were left
**byte-identical** to keep every frozen behavioral-diff spacing assertion green. `check` stdout was re-baselined
**once**, deliberately (before/after captured in the plan doc §4.1 and the build log); its exit code and the
`runSelfCheck` return shape are unchanged and its output is byte-identical run-to-run. **No schema, canonical-hash,
replay-semantics, `replayTrace`-return, `forkRun`, `runSelfCheck`-logic, `diffTraces()`-computation,
`TraceDiff`/`OutcomeDiff`/`VerifyReport`-shape, provider, fixture, generator, `package.json`, `package-lock.json`, or
`.gitignore` change; no new command, flag, or exit code; no stdout↔stderr movement.** Current baseline: **489/489**
offline (442 + 47 new), zero live calls. Tagged `week-eight-terminal-polish`.

**W7-B is complete and tagged (`week-seven-behavioral-outcome-diff`).** Behavioral outcome diff: two pure modules
(`src/trace/traceOutcome.ts`, `src/fork/diffOutcome.ts`) classify how a parent and forked child differ in *terminal
behavior* (final status, final answer / failure reason, tool-call path) by exact-string comparison; a
`formatDiffReport` wrapper appends the `Outcome:` verdict to the unchanged structural divergence block. `replayTrace`
derives its terminal fields from the shared `terminalOutcome`; schema, hashing, `diffTraces()`, `TraceDiff`,
`forkRun`, fixtures, and the CLI surface unchanged; `check` stdout byte-identical. See the W7-B build-log entry.

**W7-A is complete and tagged (`week-seven-reactive-fake-model`).** Reactive deterministic fake model: the offline
fork/`check` continuation derives the child's answer from the mutated `tool_result` via `ReactiveDemoModelClient`,
replacing the former hardcoded continuation strings. `FakeDeterministicModelClient`, `forkRun`, schema, hashing,
replay/diff/verify, fixtures, and the CLI surface unchanged; `check` stdout byte-identical. See the W7-A build-log
entry.

**W6-C is complete and tagged (`week-six-release-freeze`).** Docs-only release freeze: README/DEMO commands verified
against `package.json` / `src/cli.ts`, public docs reconciled to the true repo state; no source/test/fixture/config
change. See the W6-C build-log entry.

**W6-B is complete and tagged (`week-six-verify-replay-explanations`).** Verify/replay failure explanation:
`src/trace/verifyExplain.ts` renders a labelled `verify` FAIL block (invariant / at / detail / plain-language
action) per invariant class, secrets still masked; PASS output and the `VerifyReport` shape unchanged.
Presentation-only. See the W6-B build-log entry.

**W6-A is complete and tagged (`week-six-diff-inspect-ergonomics`).** Diff/inspect legibility via the shared pure
helper `src/trace/stepLabels.ts` (`changed value (<field>):` at a divergence); replay output byte-identical.
Presentation-only. See the W6-A build-log entry.

**W5-B is complete and tagged (`week-five-public-demo-readiness`).** Public demo narrative + repo readiness
(docs-only): README re-authored as the repo front door, DEMO tightened, `AGENTS.md`/`CLAUDE.md` current-state
pointers refreshed. See the W5-B build-log entry.

**W5-A is complete and tagged (`week-five-trace-fixture-corpus`)** per `docs/20_week_five_a_plan.md`: a committed
fake/offline v2 corpus under `fixtures/traces/`, a deterministic check-by-default generator
(`scripts/generateFixtures.ts`, `npm run fixtures:generate`), and `tests/fixtures.test.ts` asserting every core
invariant (schema, hash chain, frozen hashes, neutrality, replay, terminal-error verify, fork-prefix identity,
frozen first divergence) against the frozen artifacts. Local regression hardening only — it consumes/freezes the
existing core and changes no runtime semantics.

**W4-G is complete and tagged (`week-four-fork-verify-workflow`).** All Week Four work is closed through this
tag. The current core loop is `record → replay → fork → mutate → continue → diff → verify → check`.

W4-F is complete and tagged (`week-four-cassette-verification`): reusable cassette verification core + `verify`
CLI landed per `docs/18_week_four_f_plan.md`.

**W4-G (implemented, tagged `week-four-fork-verify-workflow`)** polished the local workflow per
`docs/19_week_four_g_plan.md` — composition, output, and guardrails only, no product-surface expansion:

- **Composed self-check** — `runSelfCheck(opts?)` (`src/workflow/selfCheck.ts`) runs the full offline loop
  **record → verify → fork → verify → diff** by *composing* `runAgentLoop` / `verifyTrace` / `forkRun` /
  `diffTraces` over the fake model + fixture tools, returning one structured PASS/FAIL verdict. It cannot make a
  live call by construction. Persistence is opt-in via `outDir` only (no `--keep`). No change to
  hash/replay/load/fork/diff/verify semantics.
- **CLI** — `npm run cli -- check` (`--out-dir <dir>` optional; exit 0 PASS / 1 FAIL). No change to
  `record`/`replay`/`fork`/`diff`/`verify`/`list`/`inspect`.
- **Fork overwrite guardrail** — `fork` refuses to write the child over its own parent (resolved-absolute-path
  equality of `--out` and `--trace`), preventing accidental parent-trace loss.

Scope guard: W4-G is workflow polish only — no UI/backend, no Anthropic CLI wiring, no new provider adapter, no
live tests, no new dependency, no observability platform.

---

## Prior Milestone: W4-F Cassette Verification + Trace Hygiene (implementation)

W4-E is complete and tagged (`week-four-real-fork-proof`): the full active-debugging loop — **record → replay → fork → mutate → continue → diff** — is proven against the live provider via opt-in proof scripts (E1 `ed1628a`, E2/E3 `d4d01f8`). Details in `docs/16_week_four_e_plan.md`, `docs/17_week_four_e2e3_plan.md`, and the W4-E build-log entries.

**W4-F (implemented)** hardens the local cassette contract per `docs/18_week_four_f_plan.md`:

- **Reusable verification core** — `verifyTrace(trace)` / `verifyTraceFile(path)` (`src/trace/verifyTrace.ts`) run one ordered pass (`schema_version → hash_chain → provider_neutrality → replayability`), short-circuit at the first failure, and return a structured PASS/FAIL report (first failing invariant + step index). They compose the existing `CURRENT_TRACE_VERSION` check, `validateTrace`, `replayTrace`, and `loadTrace` **without changing their semantics**.
- **Neutrality audit is now core** — `src/trace/neutrality.ts` holds `NEUTRALITY_FORBIDDEN` (now including `sk-ant`), the compatibility `auditNeutrality(serialized)` (re-exported from `toolUseProofHelpers.ts` for the proof scripts), and a structured `auditTraceNeutrality(trace)` that flags provider-key leaks while tolerating benign user text.
- **CLI** — `npm run cli -- verify --trace <path>` (flag-based, exit 0 PASS / 1 FAIL). No change to `record`/`replay`/`fork`/`diff`/`list`/`inspect`.

Scope guard: W4-F is verification/hygiene only — no new provider adapter, no CLI Anthropic wiring, no live tests, no packaging/observability platform.

Rules still in force (do not relax without an explicit new milestone):

- **Live provider calls are opt-in, proof-script only.** No CLI Anthropic wiring; no live/key-gated tests in `npm test`; live proofs are run manually by the human, never automatically.
- **`toolCallId` is provider-neutral and deterministic.** Never persist provider `tool_use_id`, message ids, usage, `stop_reason`/`stop_sequence`, or raw provider content arrays in traces. Fork continuation seeds the next tool-call index (no `call-0` reuse).
- **On any future live id rejection, apply the §9 rollback** (on-wire id reshape inside the adapter; traces still store `call-N`) — never persist a provider-native id.
- **Offline replay stays structural.** `replayTrace(trace)` takes only a `Trace`; no model/tool dependency. `hash.ts` unchanged.
- **Legacy `TOOL_CALL_PATTERN` / `#pendingToolCalls` are retained only as a narrow pre-v2 plain-string fallback** — the structured path never consults them.

---

## Commit Hygiene

- Every commit message must accurately reflect what changed (not what was intended).
- Include `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` on Claude Code commits.
- Do not amend published commits. Create new commits to fix issues.
- Do not skip pre-commit hooks (`--no-verify`).

---

## Response Format

When making changes, always summarize:

1. Files changed
2. What is real (live code paths)
3. What is mocked (fixtures, fakes, stubs)
4. Whether tests pass
5. Next safest task
