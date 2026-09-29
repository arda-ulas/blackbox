# W10-A Plan — Foreign Transcript Adapter Proof

**Status:** IMPLEMENTED (in closeout). This document is the accepted plan and historical record; the sections below
describe what was planned and were carried out in the implementation slice.
**Predecessor:** W9-A closed/tagged (`week-nine-cassette-assert`); W9-B closed/tagged (`week-nine-public-readiness`).
Tests: 522/522 offline. The CLI is nine commands.
**Mode:** additive adapter-boundary proof. New `src/ingest/` module + two `fixtures/external/` files + one test file +
docs. **No change to the trace schema, hashing, replay, verify, assert, fork, the CLI surface, the generator, the
committed `fixtures/traces/` corpus, or any dependency.**
**Intended tag:** `week-ten-foreign-transcript-adapter`.

---

## 1. Problem statement

Blackbox proves its own local tool-loop agent end-to-end. A reviewer may reasonably ask: *"Can this ingest a
real-ish external agent run, or only your own toy loop?"* W10-A answers that with the smallest credible proof — a
**dependency-free synthetic-chat-transcript adapter** — without becoming a framework integration, an SDK wrapper, or
an observability product.

This is explicitly **not** LangChain / MCP / OpenAI support, not live ingestion, and not a dashboard. It is an
adapter-boundary proof: one pure function converts a synthetic, chat-shaped transcript fixture into a normal Blackbox
v2 cassette, which the existing offline surfaces (`verify` / `replay` / `assert` / `diff` / `inspect`) then consume
unchanged.

## 2. Why this is the next smallest milestone

- It adds *no* new mechanism to the core — the adapter **composes** the untouched `TraceRecorder` and
  `toolCallIdForIndex`, so id / index / prevHash / hash / schema semantics are inherited, not re-implemented.
- Its blast radius is a new directory (`src/ingest/`), a new fixture directory (`fixtures/external/`), one test file,
  and docs. Reverting is deleting those files.
- It proves the cassette model is genuinely provider-neutral: the source transcript deliberately carries foreign ids,
  token usage, finish reasons, and a model name, and the proof is that **none** of them cross into the trace.

## 3. Scope

### 3.1 Adapter — `src/ingest/foreignTranscript.ts`

Export `adaptForeignTranscript(input: unknown, options: { traceId: string }): Trace` and a
`ForeignTranscriptError`. Requirements: synchronous, pure, deterministic; no filesystem / network / clock
(`Date.now`) / environment / model / tool access; parse and validate `unknown` input with no dependency; build every
payload field-by-field (never spread a foreign object); supply `createdAt` and every step timestamp explicitly from
source timestamps; remap foreign tool-call ids to deterministic `call-N`; never use a foreign run/message id as the
Blackbox trace id.

**Mapping (strict sequential state machine).** Initial user message → then a loop of `assistant (exactly one tool
call)` → `matching tool result` → … → a terminal `assistant final text`. Emits the exact grammar `agentLoop` records:

```
model_input → model_output(tool_call) → tool_call → tool_result   (one per tool round)
model_input → model_output(final_answer) → metadata(run_completed/success)   (terminal)
```

For a two-tool transcript that is the 11-step sequence `model_input, model_output, tool_call, tool_result,
model_input, model_output, tool_call, tool_result, model_input, model_output, metadata`. Foreign tool declarations are
allowlist-mapped `function.name → name`, `function.description → description`, `function.parameters → inputSchema`.

**Validation (deterministic `ForeignTranscriptError`).** Missing/malformed timestamp; timestamp not a non-negative
integer epoch-ms; decreasing timestamps; unsupported role; missing initial user message; parallel tool calls in one
assistant message; assistant message mixing final text and a tool call; invalid-JSON `function.arguments`; duplicate
foreign tool-call id; tool result with unknown `tool_call_id`; dangling unresolved tool call at the end; missing final
message.

### 3.2 Fixtures — `fixtures/external/`

- `chat-tool-use.foreign.json` — the hand-authored synthetic source transcript: fixed integer timestamps; user
  message; `get_weather` tool round; `send_email` tool round; final assistant text; and deliberate provider-like
  **noise sentinels** (`usage`, `finish_reason`, `model`, message ids `msg_*`, foreign call ids `call_a1B2c3` /
  `call_d4E5f6`, `conversation_id`, `system_fingerprint`, `_provider_meta`). Generic synthetic wording — not any
  official SDK/API shape.
- `chat-tool-use.converted.v2.json` — the committed **golden** converted cassette (byte-for-byte the adapter's
  output; trace id `external-chat-tool-use`). Generated deliberately during implementation and committed as a normal
  fixture. **Tests only read it**; they never write or update it.

`fixtures/external/` is a new directory, distinct from the frozen `fixtures/traces/` corpus (which is untouched and
stays exactly five files). Neither directory is git-ignored.

### 3.3 Tests — `tests/foreignTranscript.test.ts`

Happy path (exact 11-step sequence, `call-0`/`call-1` ids, tool names/inputs, source timestamps, determinism +
byte-identity, golden byte-match, frozen final-step hash, no input mutation); neutrality (foreign ids/noise absent
from the serialized trace, `auditTraceNeutrality` passes, no `NEUTRALITY_FORBIDDEN` marker); pipeline (validateTrace,
loadTrace equality, `verifyTrace` 4/4, `replayTrace` success + final answer, `terminalOutcome`, `toolCallSequence`,
`assertCassette` pass + wrong-order fail); and every validation rejection case in §3.1.

### 3.4 Docs

`docs/31_week_ten_a_plan.md` (this doc); a short README "Adapt a foreign transcript" section framed as a synthetic
adapter-boundary proof with the three reviewer commands (`verify` / `replay` / `assert`); a `docs/08_build_log.md`
W10-A entry; and current-state pointer refreshes in `CLAUDE.md` / `AGENTS.md`. **No `DEMO.md` change.**

## 4. Allowed files (exhaustive)

`src/ingest/foreignTranscript.ts`, `fixtures/external/chat-tool-use.foreign.json`,
`fixtures/external/chat-tool-use.converted.v2.json`, `tests/foreignTranscript.test.ts`,
`docs/31_week_ten_a_plan.md`, `README.md`, `docs/08_build_log.md`, `CLAUDE.md`, `AGENTS.md`.

**Explicitly NOT touched:** `DEMO.md`; `src/trace/`, `src/replay/`, `src/fork/`, `src/agent/`, `src/workflow/`,
`src/render/`, `src/cli.ts`; `fixtures/traces/`; `scripts/`; `tests/fixtures.test.ts`; `package.json`,
`package-lock.json`, `.gitignore`; `assets/brand/`; `docs/11_cli_spec.md`.

## 5. Acceptance criteria

1. `adaptForeignTranscript` is pure/deterministic — two conversions of the source are byte-identical and equal the
   committed golden.
2. The golden cassette is a normal v2 trace: `loadTrace` accepts it, `validateTrace` passes, `verifyTrace` → PASS 4/4,
   with **zero** change to those functions.
3. `verify` exit 0; `assert --expect-status success --expect-tools get_weather,send_email` exit 0; wrong expectation
   exit 1; `replay` reports `status: success` — all against the committed converted cassette.
4. Neutrality by construction: converted trace passes `auditTraceNeutrality`; the serialized cassette contains no
   foreign id / `usage` / `finish_reason` / model name — despite all being present in the source.
5. All 522 existing tests pass unedited; `check` stdout byte-identical run-to-run; `npm run fixtures:generate` still
   in sync (five `fixtures/traces/` fixtures).
6. No new dependency; no schema / hash / canonicalization change; no CLI surface change; no live call.

## 6. Failure conditions (stop and escalate)

The mapping needs a schema change or a `CURRENT_TRACE_VERSION` bump; neutrality can only pass by weakening
`NEUTRALITY_FORBIDDEN` / `auditTraceNeutrality`; any need to edit `scripts/generateFixtures.ts`,
`tests/fixtures.test.ts`, or `fixtures/traces/`; any need to edit `src/cli.ts` or add a flag/command; the adapter
"needs" a dependency; or `check` (or any existing command) output changes by a byte.

## 7. Rollback

Delete `src/ingest/foreignTranscript.ts`, `fixtures/external/`, and `tests/foreignTranscript.test.ts`, and revert the
docs. No core file is touched, so rollback cannot affect any runtime behavior, existing test outcome, or the frozen
corpus.

## 8. Codex plan-audit checklist

Boundary honesty (adapter proof, not SDK/framework/live integration); adapter purity (no clock/I/O/net/model/tool;
determinism from source timestamps); core untouched (diff proves schema/hash/replay/verify/assert/CLI/generator/corpus
byte-identical); neutrality direction (foreign ids/noise stripped and remapped, never persisted; no marker weakening;
trace *content* carries no provider names — filenames/docs may); fixture placement (new files under
`fixtures/external/` only; `fixtures/traces/` and `fixtures.test.ts` untouched; nothing git-ignored by accident);
`assert` proof uses real expectations plus a failing case; scope tripwires (no new CLI command/flag, no npm script, no
dependency, no schema bump, no parallel-tool-call support, no second foreign format); docs state the single-tool-round
limitation and the hand-authored (not SDK-captured) provenance, and claim no official OpenAI/SDK/LangChain/MCP support.
