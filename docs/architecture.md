# Architecture

How Blackbox is put together, for contributors and the curious. The cassette format itself is in
[trace format](./trace-format).

## Two halves

Blackbox is split into an **execution side**, which sits in the path of a running agent, and an **analysis side**,
which only ever reads cassettes.

```text
 your agent ──► SDK client ──fetch──► session (record / replay / fork) ──► live API (record, fork --live)
                 wrapped tools ──────►    │
                                          ▼
                                     cassette (JSON, hash-chained)
                                          │
                  replay summary · verify · diff · assert · inspect   (analysis: reads a Trace, nothing else)
```

The analysis side never imports a model client, a tool, the session, an SDK or a network module. A test walks the
import graph of `src/replay`, `src/trace`, `diffTraces`, `diffOutcome` and `assertCassette` and fails the build if
any of them can reach one.

## Execution side

| Module | Role |
|---|---|
| `src/session/session.ts` | The session behind `blackbox()`: `fetch`, `tools()`, `finish()`, and the record / replay / fork state machine |
| `src/session/options.ts` | Options, and the environment variables the CLI launcher sets |
| `src/integrations/anthropic.ts`, `openai.ts` | Pure translation between each provider's wire JSON and neutral step payloads, both ways |
| `src/cli/launch.ts` | Runs `record` / `replay` / `fork -- <command>`: starts the agent with the session switched on and reports the result |
| `src/ingest/*` | Transcript importers (Claude Code JSONL, chat JSON) |
| `src/agent/*`, `src/fork/forkRun.ts` | The built-in demo agent and its fork, used by `demo`, `check` and `fork` without a command |

### Record

`bb.fetch` receives each request exactly as the SDK sends it. The session parses the JSON body, normalizes it
(`normalizeAnthropicRequest` / `normalizeOpenAIRequest`), forwards the request unchanged, and appends a
`model_input` and a `model_output` step when the response succeeds. Provider tool-call ids are mapped to `call-N` in
the order the model produced them. Wrapped tool invocations are matched to the model's calls by name and arguments,
buffered, and written in the model's call order before the next model request.

### Replay

A cursor walks the recorded steps. Each request is normalized the same way and compared with the recorded
`model_input` (`firstDifference`). The recorded `model_output` is turned back into a response in the provider's
shape (`synthesize*Response`) with the neutral ids as tool-call ids, so the agent's next request refers to them and
normalizes identically. Wrapped tools look up their recorded steps by call id and return the recorded result.

### Fork

Fork is replay until the agent invokes the tool whose result is the fork step. At that point the session copies
the parent's steps before it verbatim into a new recorder, appends the replacement result with the parent's
timestamp, and switches to record behavior with either the live API or scripted replies.

### Errors across the SDK boundary

A thrown `fetch` error would be wrapped by the SDK as a retryable connection error, so the session instead answers
with a `400` carrying a `[blackbox]` message (never retried), keeps the typed error, and `finish()` rethrows it.
Error messages are masked for known keys.

## Analysis side

| Module | Role |
|---|---|
| `src/trace/TraceTypes.ts`, `hash.ts`, `TraceRecorder.ts` | The trace model, canonical JSON and SHA-256 hashing, append-only recording |
| `src/trace/payloads.ts` | Readers for the step payload shapes (`toolCallsOf`) |
| `src/replay/CassetteReplay.ts` | Load, save, validate the chain, and summarize a run from a `Trace` |
| `src/trace/verifyTrace.ts`, `neutrality.ts`, `secrets.ts` | The ordered `verify` checks and the credential scan |
| `src/fork/diffTraces.ts`, `diffOutcome.ts` | First divergence (by hash, or `--semantic`) and the outcome comparison |
| `src/workflow/assertCassette.ts` | `verify` plus exact expectations, for CI |

## Hashing

A step's hash is SHA-256 over the canonical JSON (keys sorted recursively, no whitespace) of `index`, `type`,
`timestamp`, `payload` and `prevHash`. The step's own `id` and `hash` are excluded. Because every hash includes the
previous one, changing a step changes every hash after it. `diff` compares hashes. `diff --semantic` compares
only `type` and `payload`, for two independent recordings.

## Tests

The suite runs offline with no key. Session tests drive the real `@anthropic-ai/sdk` and `openai` clients with a
scripted fake upstream in place of the network, so a change in either SDK's request or response shape fails a
test. Launcher tests run a fixture agent through `blackbox record | replay | fork` in a child process. CI also packs
the package, installs the tarball into an empty project, and uses it from JavaScript and TypeScript.
