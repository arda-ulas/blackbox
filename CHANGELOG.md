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
