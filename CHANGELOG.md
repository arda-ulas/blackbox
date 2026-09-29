# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/) (while below 1.0, minor versions may
change behavior).

## [Unreleased]

### Planned

- **Streaming** (`stream: true`, `messages.stream()`) for record, replay and fork.
- The OpenAI **Responses API** (`responses.create`).
- A GitHub Action that runs `blackbox assert` on committed cassettes.
- A static HTML diff viewer.
- Read-only import of OpenTelemetry GenAI spans.
- Vercel AI SDK and OpenAI Agents SDK integrations.

## [0.2.1] - 2026-09-29

Worked examples, and the small features they needed.

### Added

- **`blackbox inspect <cassette> --step N`** prints one step in full: its type,
  hash, time and complete payload, so a recorded tool result can be read
  without opening the JSON.
- **`diff` names the changed fields** of a divergent value too long to show
  whole, e.g. `result.data[0].dp.value: "91" → "124"`.
- **`fork --set @file.json`** reads the replacement tool result from a file.
- **Import a Claude Code subagent's transcript.** A file under
  `<session>/subagents/agent-*.jsonl`, where every line is a sidechain, now
  imports as a session of its own.
- **Example: root-causing a triage agent** (`examples/fleet-triage/`). A
  back-office fleet-maintenance agent keeps an overheating van in service
  because its telemetry tool served a snapshot cached before the fault.
  Reproduce with `replay`, isolate with `inspect`, test the hypothesis with
  `fork`, confirm with `diff`, then prevent a recurrence with a freshness check
  and a cassette pinned in CI. Telemetry uses COVESA VSS 6.1 signal paths with
  VISS data points. Runs offline, with no API key.
- **Example: what did my coding agent do?** (`examples/claude-code-session/`):
  a real, scrubbed Claude Code session imported, inspected, verified and
  pinned with `assert`.
- A test proving that replaying with a different model name stops at the
  path `model`.

### Changed

- The `--help` banner uses the README's tagline ("time-travel debugger").
- Hints for unreadable old cassettes point at `blackbox record`.
- The comparison page was rewritten with facts re-verified in September 2026,
  starting with Laminar.

## [0.2.0] - 2026-09-29

The first release you can point at your own agent.

### Added

- **Record your own agent.** `blackbox()` returns a session. Pass `bb.fetch` to
  the official Anthropic (`messages.create`) or OpenAI (`chat.completions.create`)
  client and wrap your tool functions with `bb.tools({...})`. With no mode set it
  passes everything through.
- **`blackbox record --out run.json -- <command>`** runs your agent and writes a
  hash-chained, provider-neutral cassette of its model calls and tool results.
- **`blackbox replay run.json -- <command>`** re-runs your agent offline. Every
  model call is answered from the cassette after the request is checked against
  the recording, and wrapped tools return their recorded results without
  running. It needs no API key and makes no network calls.
- **`blackbox fork run.json --at N --set JSON --out fork.json (--live | --script replies.json) -- <command>`**
  replays up to a recorded tool result, hands your agent a different value,
  and continues with your live client or scripted replies. `blackbox diff`
  then shows the first step that changed.
- **`blackbox import --from claude-code|chat-json`** converts a Claude Code
  session (parallel tool calls, multi-turn) or a chat JSON transcript into a
  cassette.
- **`blackbox diff --semantic`** compares two separate recordings by step type
  and payload.
- `--help` and `<command> --help` for every command, `--version`, and positional
  cassette arguments (`blackbox diff a.json b.json`).
- The cassette format gains a multi-call `tool_calls` model output (parallel
  tool use with narration text), plus optional `model` and `params` on model
  inputs. This is an additive change within schema version 2.
- A library API for offline analysis: `loadTrace`, `verifyTrace`, `diffTraces`,
  `diffOutcome`, `assertCassette`, `replayTrace`.

### Changed

- The built-in sample cassettes are written by `blackbox demo` (formerly
  `blackbox record`).
- The package ships compiled JavaScript with type declarations and has no
  runtime dependencies. It requires Node.js 22 or later.
- `verify` treats tool inputs, tool results and message text as user data. It
  flags only realistic credential shapes there, so an agent that reads source
  code mentioning provider ids still verifies. Everywhere else it is strict, and
  it now also recognizes OpenAI ids and keys.
- A cassette is not written if it fails `verify` or contains an API key taken
  from the environment or the intercepted request headers.

### Not supported yet

- Streaming responses. Use the non-streaming call; the error says so.
- The OpenAI Responses API, images and documents in messages, server-side
  tools, and `n > 1`. Each is rejected with a clear error rather than
  recorded incorrectly.
- Extended-thinking blocks are left out of cassettes. Record and replay work
  with thinking enabled; `fork --live` on such an agent is refused up front
  (use `--script`).

## [0.1.0] - 2026-08-21

The engine release: record, replay, fork, mutate, continue, diff, verify and
check for a built-in demo agent, plus `assert` for CI, over hash-chained v2
cassettes. It was packaged as a local tarball and not published.
