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

## Current State: W8-A terminal experience polish (W7-B behavioral outcome diff closed and tagged)

**W8-A (terminal experience polish) is the current milestone** per `docs/27_week_eight_a_plan.md`, implemented and
in closeout: a presentation-only slice across the whole CLI. A new pure, dependency-free module
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
offline (442 + 47 new), zero live calls. The intended tag is `week-eight-terminal-polish`.

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
