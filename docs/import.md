# Import transcripts

`blackbox import` converts a transcript from another tool into a cassette, which you can then inspect, fork with the
built-in demo agent, diff and assert like any other.

## Claude Code sessions

Claude Code stores each session as a JSONL file under `~/.claude/projects/<project>/<session>.jsonl`.

```bash
npx blackbox import --from claude-code --in ~/.claude/projects/my-app/1234.jsonl --out runs/session.json
npx blackbox inspect runs/session.json
```

- A model message that Claude Code split over several lines (text, then each tool call) is merged back into one
  turn.
- Parallel tool calls become one `tool_calls` step followed by each call's result, in call order.
- Multi-turn sessions keep every human turn and intermediate answer. The run ends with the last answer.
- Thinking blocks, token usage, model names and provider ids are dropped.
- Subagent (sidechain) messages inside a main session are skipped; the subagent's result still appears as the tool
  result in the main session. A subagent's own transcript (`<session>/subagents/agent-*.jsonl`, where every line is a
  sidechain) imports as a session of its own.
- A session that stopped while a tool was running is imported as `incomplete`.
- Tool definitions are not in the transcript, so the cassette lists the tool names it observed.

The cassette is written only if it passes `verify`. A session in which a real API key appears (pasted into the chat,
or printed by a command) is refused, and nothing is written.

## Chat JSON

`--from chat-json` reads a simple OpenAI-style transcript: `{ tools?, messages: [...] }` with `user`, `assistant`
(with `tool_calls`) and `tool` messages, each carrying a `timestamp`. It supports one tool call per assistant turn.
