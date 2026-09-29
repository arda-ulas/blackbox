# Limitations

Blackbox 0.2 is deliberately narrow. Where something is unsupported, it says so with an error instead of recording
something that cannot be replayed.

## Not supported yet

- **Streaming.** `stream: true` and `messages.stream()` are rejected with a message telling you to use the
  non-streaming call. Streaming is first on the roadmap.
- **OpenAI's Responses API.** Use `chat.completions.create`.
- **Non-text content:** images, documents and audio in messages or tool results.
- **Server-side tools** (for example Anthropic web search) and OpenAI custom tools.
- **Several choices per request** (`n > 1`).
- **Overlapping model calls in one session.** Use one `blackbox()` session per concurrent conversation.
- **Extended thinking on `fork --live`.** Thinking blocks are not stored, so a live continuation cannot send them
  back. Record, replay and `fork --script` work.

## By design

- **Replay covers what goes through Blackbox.** Model calls through `bb.fetch` are answered from the cassette, and
  wrapped tools do not run. Everything else your agent does (unwrapped tools, other network calls, reading the
  clock) still happens.
- **Identical parallel calls are matched in order.** If the model requests the same tool with the same arguments
  twice in one turn, results are handed out in the order the calls are made.
- **Fork points are tool results.** To change what the model said, change the tool result that led to it, or edit
  your prompt and re-record.
- **It is not observability.** There is no server, dashboard or hosted storage, and Blackbox does not find bugs for
  you. It makes a run reproducible and shows exactly what changes when one fact changes.
- **Cassettes are as sensitive as logs.** They contain your prompts, tool arguments and tool results. Blackbox
  refuses to write the API key it sees, but other secrets in your data are yours to keep out.
