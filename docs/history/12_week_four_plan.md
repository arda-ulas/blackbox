# Week Four Plan

## Goal

Prove that Blackbox's record → replay → fork → diff loop holds against a real LLM API, not just a scripted fake. Add a provider-neutral adapter boundary that keeps the fake deterministic adapter as the default, then spike one optional real provider adapter behind an environment-variable flag. Replay and tests must never call the real provider. No secrets committed. Everything stays local; no hosted backend, no UI.

---

## Non-Goals

- Web UI, dashboard, or graph view of any kind
- Hosted backend, remote cassette storage, or sharing links
- LangChain, LlamaIndex, MCP, or any agent framework integration
- Production SDK or npm-published package (deferred to a later phase)
- Multi-agent orchestration
- Generic observability platform or OTEL export
- Real external tool calls (fixture tools stay deterministic for now)
- Full real-world scenario library (one real model run is enough to prove the loop)
- Any hardcoded API keys, credentials in source, or `.env` files committed to the repo

---

## Why This Milestone Matters

The Week Three proof is local and entirely fake. `FakeDeterministicModelClient` plays back scripted responses — it proves the record/replay/fork/diff mechanics are correct, but it does not prove that a real model's output can be captured, replayed offline, and forked without re-calling the provider. Week Four answers that question. A single successful real-model record → offline replay → fork from cassette is the strongest possible demo of the core value proposition: the model need not be called again after the first run.

---

## Proposed Phases

### Phase W4-A: Adapter interface design doc and contract

Write a design doc (or extend an existing doc) that specifies:
- The `ModelClient` interface as it currently exists — what it requires callers to pass and what it returns
- The `ToolExecutor` abstraction boundary (currently implicit in `agentLoop.ts` as a list of fixture tools) — specify it as an explicit interface or type alias
- The replay invariant: neither `ModelClient` nor `ToolExecutor` may be called during `replayTrace`; this is already structurally enforced and must remain so after any adapter work
- The real-provider boundary: what the optional real adapter must and must not do; how it receives credentials (env vars only); how the test suite skips it when the env var is absent
- The cassette round-trip contract: a trace recorded with the real adapter must pass `validateTrace` identically to a trace recorded with the fake adapter; no adapter-specific fields may leak into `Trace`

Deliverable: a short design doc section in `docs/` (new file or extension of `docs/03_trace_schema.md`). No code changes in W4-A.

Files to touch:
- `docs/13_adapter_contract.md` (new)

### Phase W4-B: Provider-neutral adapter boundary + model-call error hardening

Make the adapter seam explicit and harden the agent loop against model-call failures. The fake deterministic adapter remains the default; no real SDK is introduced in W4-B.

**Refactor (non-error path unchanged):**
- `ModelClient` interface stays `complete(input: ModelInput): Promise<ModelOutput>` — method signature does not change
- Extract `ToolExecutor` interface with `definitions()` and `execute()` methods; `agentLoop` accepts it as a parameter instead of importing fixture tools directly
- `defaultFixtureTools()` returns a `ToolExecutor` implementation
- All existing tests pass unchanged

**Behavior addition (model-call error recording):**
- Wrap `model.complete(input)` in a try/catch inside `agentLoop`
- On error, append a terminal `metadata` step with `event: "run_failed"`, `reason: "model_error"`, `errorKind`, and a plain string `message` before re-throwing
- Test with a fake throwing `ModelClient` (no real SDK needed)
- New tests prove the terminal metadata step is present on model-call failure
- `replayTrace` takes neither `ModelClient` nor `ToolExecutor` as a parameter (verify this remains true)

Files to touch:
- `src/agent/modelClient.ts` — verify/finalize `ModelClient` and `ToolDefinition`; add `ToolExecutor` interface
- `src/agent/agentLoop.ts` — accept `ToolExecutor` as parameter; add model-call error try/catch
- `src/agent/fixtureTools.ts` — implement `ToolExecutor`
- `tests/agentLoop.test.ts` — verify no regressions; add model-call error test(s)

### Phase W4-C: Optional real model adapter spike

Add one real provider adapter, gated behind an environment variable:
- Implement `AnthropicModelClient` (or similar) in `src/agent/anthropicModelClient.ts`
- Reads `ANTHROPIC_API_KEY` from `process.env`; throws a clear error if missing when instantiated
- Satisfies the same `ModelClient` interface as `FakeDeterministicModelClient` — drop-in replacement
- Never called during `replayTrace`; replay accepts a `Trace` as its execution input and the current replay module
  has no model, tool-execution, or network dependency (verify)
- Tests skip any test that instantiates `AnthropicModelClient` unless `ANTHROPIC_API_KEY` is set in the environment
- No key, no token, no credential of any kind is committed to the repo or hardcoded in source

Files to touch:
- `src/agent/anthropicModelClient.ts` (new)
- `tests/anthropicModelClient.test.ts` (new, all tests guarded by env check)

**Not in scope for W4-C:** running the real adapter in CI, wiring it into the CLI by default, or storing any output. The real adapter is instantiable and testable manually; it does not replace the fake in any existing flow.

### Phase W4-D: Cassette round-trip proof with real adapter

**Implemented as W4-C3 with a narrowed, final-text-only scope.** Run with `npm run example:real-proof`.

- Script records one real run using `AnthropicModelClient` with a **final-text-only prompt** (no tools, no fork, no diff); saves the trace to `traces/anthropic-proof-trace.json`
- Replays the saved trace offline — zero provider calls
- Validates the trace with `validateTrace`; prints `PASS`/`FAIL` and exits with the matching code
- Fails safely when `ANTHROPIC_API_KEY` is absent: exits 1 with a clear message and writes no trace

This script is the "proof" artifact. It is not automated in `npm test`; it is run manually with a real API key and its output is human-verified.

**Deferred:** real-provider tool-use and fork/continue are out of scope until structured transcript migration (Path B in `docs/13_adapter_contract.md`). The legacy transcript encoding cannot persist `tool_use_id`, so a fresh adapter cannot reconstruct tool-result correlation from a cassette. W4-C proves record → offline replay only.

Files to touch:
- `src/examples/realRunProof.ts` (new, clearly labeled as requiring `ANTHROPIC_API_KEY`)
- `package.json` — `example:real-proof` script
- No changes to existing tests

### Phase W4-E: Audit and decision

After W4-D is verified manually:
- Codex audit: review the adapter boundary contract, the real adapter implementation, and the cassette round-trip proof for correctness and isolation violations
- Human decision: is the real adapter clean enough to keep? Does it add enough demo value? Options are (a) keep it behind the env flag as a first-class optional feature, (b) merge and document it, or (c) revert and note what was learned
- Document the outcome in `docs/08_build_log.md`

No code changes in W4-E unless the audit finds critical issues.

---

## Acceptance Criteria

- `npm test -- --run` still passes with no regressions (216 tests at the W4-C checkpoint, no new test failures introduced)
- `ModelClient` and `ToolExecutor` interfaces are explicit and documented
- `FakeDeterministicModelClient` and fixture tools satisfy both interfaces without any changes to existing behavior
- `replayTrace` takes neither interface as a parameter (structurally verified)
- `AnthropicModelClient` compiles and satisfies `ModelClient`; reads API key from env; throws clearly if key is absent
- All tests that instantiate `AnthropicModelClient` are guarded by an env check and skipped in normal `npm test` runs
- No API key, token, or credential appears in any committed file
- A manual run of `src/examples/realRunProof.ts` with a real `ANTHROPIC_API_KEY` produces a trace that passes `validateTrace` and replays offline (final-text-only; real-provider fork is deferred — see W4-D)
- Codex W4-E audit returns no critical isolation violations

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Real model output is non-deterministic; re-running the same prompt produces different tokens | High (expected) | Replay reads cassette payloads only — non-determinism is irrelevant for replay. The cassette captures exactly what the model said, and that is what is replayed. This is the whole point. |
| Real adapter leaks provider-specific metadata into `Trace`, breaking schema parity | Medium | `TraceStep.payload` is `JsonValue`; the adapter must serialize only the content relevant to replay. W4-A design doc specifies what may and may not appear in payloads. |
| API key accidentally committed | Low but severe | Never construct keys in source. Read only from `process.env`. Add `.env` to `.gitignore` if not already present. Pre-commit hook or Codex audit catches this. |
| Real adapter is expensive to test manually (token cost per run) | Medium | W4-D script is a one-off proof, not a loop. Keep it short (one tool call, one final answer). |
| `ToolExecutor` extraction breaks existing agentLoop tests | Medium | Run tests after each sub-step of W4-B. The interface change should be additive (pass fixture tools as a parameter instead of importing them). |
| Scope creep toward a full provider abstraction layer | Medium | W4-C adds exactly one adapter. If a second provider (OpenAI, Gemini) is requested, defer it explicitly. |
| Week Four scope creeps toward a web UI or SDK | Low | Enforce in CLAUDE.md. Codex flags any UI or framework import. |

---

## Research Questions (Optional, Bounded)

These are questions to answer before or during W4-B/C — bounded to source-reading and SDK docs, not broad market research.

1. **Anthropic SDK usage for streaming vs. non-streaming responses.** Does the TypeScript SDK support a simple non-streaming `messages.create()` call that returns the full response synchronously? If not, how does the streaming API map to the `ModelOutput` type expected by `agentLoop`?
2. **Tool-use format in the Anthropic API.** How does the Anthropic messages API represent tool calls and tool results? Does the SDK output map cleanly to `{ type: "tool_call", toolName, toolInput }`, or does it require a translation layer?
3. **Local API key handling best practices.** Is there a standard way to load `ANTHROPIC_API_KEY` from a local `.env` file without committing it? (`dotenv` is one option; alternatively, the user exports it in their shell.) What does the existing Anthropic SDK recommend?

Research method: read `@anthropic-ai/sdk` TypeScript types and the Anthropic API reference docs. No web scraping, no broad surveys. Time-box to 30 minutes before starting W4-B.

---

## Agent and Model Roles

| Agent | Role |
|---|---|
| Claude Sonnet | Primary: write docs, implement adapter boundary (W4-A/B), implement real adapter (W4-C), write proof script (W4-D) |
| Codex | Audit after W4-A/B (contract correctness, interface isolation) and after W4-D (cassette round-trip, no key leakage) |
| Perplexity / web search | Optional: source-backed Anthropic SDK usage research only if SDK types are unclear; time-boxed |
| Claude Opus | Reserve for subtle adapter/replay design conflicts only — e.g., if the streaming API creates a structural mismatch with `ModelOutput` that Sonnet cannot resolve cleanly |
| Gemini | Optional red-team: ask Gemini to look for scope creep or isolation violations in the W4-A design doc before any code is written |

---

## Recommended Implementation Order

1. **W4-A first** (design doc) — write the contract before any code changes; get Gemini/Codex review if useful; commit and push before touching source
2. **W4-B second** (adapter boundary) — mechanical refactor; run tests after every sub-step; no behavior changes
3. **W4-C third** (real adapter) — implement behind env flag; keep it minimal (no streaming, no retries, no rate limiting); add guarded tests
4. **W4-D fourth** (proof script) — wire it up, run manually with a real key, capture the output; do not automate
5. **W4-E last** (Codex audit + decision) — review and decide; document outcome; tag if accepted

Do not start W4-B before W4-A is committed.
Do not start W4-C before W4-B tests pass.
Do not start W4-D before W4-C is committed and manually verified (key loads, call succeeds, error is clear when key is absent).

---

## What Not to Build Yet

- Any web or Electron UI
- Hosted backend or remote cassette storage
- A second real provider adapter (OpenAI, Gemini, Cohere) — one is enough to prove the loop
- Real fixture tools that make network requests (keep tools deterministic)
- Automated CI test runs that call the real provider (real calls stay manual and key-gated)
- LangChain, LlamaIndex, MCP, or any agent framework wrapper
- Full production SDK or npm-published package
- OTEL / telemetry export
- Semantic diff or chaos fork
- Multi-agent orchestration
- Any hardcoded model name, endpoint, or API key in source
