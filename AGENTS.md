# Blackbox — Agent Workflow Guardrails

## Project Identity

Blackbox is a **local TypeScript time-travel debugger for AI agents**.

Core value: **active debugging** — not passive observability.

```
record -> replay -> fork -> mutate -> continue -> diff
```

Since 0.2 it records **the user's own agent** through the official Anthropic / OpenAI Node SDK `fetch` option
(`src/session/`, `src/integrations/`), and ships as the npm package `@ardaulas/blackbox`.

The local TypeScript CLI core comes before any UI, backend, or platform work. Do not conflate Blackbox with a generic observability dashboard, LLM monitoring platform, or hosted service.

---

## Build Scope Guardrails

Do not build any of the following unless the current milestone explicitly plans it:

- Web UI, dashboard, React components, design polish
- Hosted backend, remote cassette storage, auth, sharing
- LangChain, LlamaIndex, MCP proxy, agent frameworks, prompt platforms
- Metrics charts, OTEL export, chaos fork
- Multi-agent orchestration, production SDK, timeline UI, branch graph

**Invariants that apply to every milestone:**

- **Blackbox never makes a provider call of its own.** It never constructs a provider client. Live calls happen only in the user's agent, through the user's own client, under `blackbox record` or `blackbox fork --live`. The built-in demo commands (`demo`, `check`, `fork` without a command) use the fake deterministic clients (`FakeDeterministicModelClient`, `ReactiveDemoModelClient`) and `defaultFixtureTools()`, with zero live calls and no API key.
- **Replay must never call the model, provider, or tools.** `replayTrace(trace)` takes only a `Trace`. Session replay (`blackbox replay -- <command>`) answers every intercepted model call from the cassette and never runs a wrapped tool; its base fetch refuses all network access. The analysis seam (`src/replay`, `src/trace`, diff, assert) must not import execution-side code; `tests/importBoundary.test.ts` enforces this.
- **API keys must never be logged, recorded, or stored in traces.** No key, token, or credential may appear in `TraceStep.payload`, trace metadata, log output, or any file written to disk.
- **Raw provider/SDK objects must never enter trace payloads.** The integrations translate wire JSON field by field into neutral payloads; provider-native ids are mapped to `call-N`. Provider-native fields (`tool_use_id`, `usage`, `message.id`, etc.) must not appear in `TraceStep.payload` structure. The user's own tool data is exempt from provider-id checks but not from credential checks (see docs/trace-format.md).

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

- **No live provider calls in the default test suite.** `npm test` must pass with zero real provider calls and no API key present.
- **Provider integrations are tested through the real SDKs with an injected fake upstream** (`baseFetch`), so SDK request/response drift fails a test without any network.
- **Live proofs are explicit opt-in and run by hand:** `npm run proof:anthropic` / `npm run proof:openai` (`scripts/live-proof.sh`). Never from `npm test` or CI.
- **Every commit keeps these passing:** `npm run typecheck`, `npm test`, `npm run cli -- check`; before a release also `npm run build`, `node scripts/pack-smoke.mjs` and `npm run docs:build`.

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

## Current State

**0.2.0: the first release you can point at your own agent.** Record / replay / fork of a user's Anthropic
(`messages.create`) or OpenAI (`chat.completions.create`) agent through the SDK `fetch` option, a CLI launcher
(`blackbox record|replay|fork ... -- <command>`), `blackbox import` for Claude Code sessions, compiled package with
no runtime dependencies, docs site on GitHub Pages (VitePress, `docs/`). 717 tests, fully offline.

- The cassette schema is still version 2; the `tool_calls` model-output shape and the `model` / `params` fields on
  model inputs are additive.
- Release history is in `CHANGELOG.md`; the milestone plans and build log from the 0.1 engine work are in
  `docs/history/` (not maintained).
- Roadmap (not started): streaming, the OpenAI Responses API, a GitHub Action for `assert`, a static HTML diff
  viewer, OpenTelemetry GenAI import, Vercel AI SDK and OpenAI Agents SDK integrations.

New product-surface work is planned and Codex-audited before implementation.

---

## Commit Hygiene

- Every commit message must accurately reflect what changed (not what was intended).
- No AI attribution trailers (`Co-Authored-By: …`) on commits and no "Generated with" lines in PR descriptions. Product copy carries no AI disclosure.
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
