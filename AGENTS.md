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

- **Fake deterministic model/tools remain default.** `FakeDeterministicModelClient` and `defaultFixtureTools()` are the default in all tests and CLI commands unless a milestone explicitly changes that.
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

## Current Milestone: W4-E Real Tool-Use Proof — E1 PASSED, E2/E3 next

W4-D structured transcript migration is complete and tagged (`week-four-structured-transcript-migration`). W4-E slice **E1 passed** (2026-07-06): the opt-in proof `example:real-tooluse-proof` (commit `ed1628a`) confirmed the real Anthropic Messages API accepts Blackbox's synthetic `toolCallId` (`call-0`) as the request-local `tool_use.id` / `tool_result.tool_use_id` on a single real tool-use record. Details in `docs/16_week_four_e_plan.md` and the W4-E build-log entry.

Next: **E2/E3** — the live fork → mutate → continue (fresh adapter) → diff loop, which is **not yet proven** and not started.

Rules still in force (do not relax without an explicit new milestone):

- **Live provider calls are opt-in, proof-script only.** No CLI Anthropic wiring; no live/key-gated tests in `npm test`; live proofs are run manually by the human, never automatically.
- **`toolCallId` is provider-neutral and deterministic.** Never persist provider `tool_use_id`, message ids, usage, `stop_reason`/`stop_sequence`, or raw provider content arrays in traces. Fork continuation seeds the next tool-call index (no `call-0` reuse).
- **E1 proved single-record acceptance only.** Do **not** claim real *fork continuation* works until E3 establishes it live. On any live id rejection, apply the §9 rollback (on-wire id reshape; traces still store `call-N`).
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
