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

## Refused request and response fields

The cassette's provider-neutral steps cannot carry these yet. Rather than record them and replay something
different, Blackbox refuses them with a `BlackboxUnsupportedError` naming the field, when recording and when
replaying:

| Provider | Refused | Why |
|---|---|---|
| OpenAI | the `audio` request field, and `audio` in a response or in the history | audio output is not recorded |
| OpenAI | the legacy `functions` / `function_call` request fields, a `function_call` in a response or the history | use `tools` |
| OpenAI | a message `name` (`messages[i].name`) | not recorded; two requests differing only in `name` would match |
| OpenAI | `strict: true` on a function tool | not recorded (`strict: false`, the default, records like leaving it out) |
| OpenAI | a response with `finish_reason: "content_filter"` | it would replay as a normal stop |
| Anthropic | `strict: true` on a tool | not recorded (`strict: false` records like leaving it out) |
| Anthropic | a response with `stop_reason: "stop_sequence"` | the matched sequence is not recorded; it would replay as `end_turn` |
| Anthropic | a response with `stop_reason: "model_context_window_exceeded"` | it would replay as `max_tokens` |
| Anthropic | a response with more than one text block, or text after a tool call | a replay returns one text block before the tool calls |
| OpenAI | tool calls with a `finish_reason` other than `tool_calls` or `length` (the API sends `stop` when `tool_choice` names a function) | it would replay as `tool_calls` |
| OpenAI | a final answer with `null` content, or tool calls with `""` content | a replay gives a final answer string content and tool calls `null` |
| OpenAI | a refusal together with content, tool calls or a `finish_reason` other than `stop`, and a refusal in the history | a replay returns a refusal alone; in the history it would be recorded as text |
| Anthropic | a refusal together with tool calls; and, while the API sends `stop_details` with refusals, any refusal | not recorded |
| OpenAI | `logprobs` or `annotations` in a response, and the `web_search_options` request field | not recorded |
| OpenAI | a response with both `content` and a `refusal` | only one of them is recorded |
| OpenAI | both `max_tokens` and `max_completion_tokens` in one request | they are recorded as one value |
| Anthropic | text `citations`, `stop_details` or a `container` in a response | not recorded |
| Both | a wrapped tool still running when a model call is made or returns | its steps could not be written in order |
| Both | a tool argument or result that JSON would lose: a `Map`, `Set`, `RegExp`, `bigint`, or another object that would be stored as `{}` | it would be recorded as `{}` |
| Both | a second `blackbox()` session in a process started by the `blackbox` CLI, and options in code that override the CLI's mode, files, match or fork settings | the CLI runs one session per command and reports on it |

Other request fields that are not in the [compared list](./trace-format#what-replay-compares) (for example
`metadata`, `user`, `service_tier`) are recorded as absent and not compared.

A replayed response also does not reproduce: token usage (zero), provider ids (Blackbox's own), the response's
`model` (the model name the request sent is echoed, not the version the provider resolved), OpenAI's `created`
(the recorded step time), `system_fingerprint` and `service_tier`, Anthropic's `diagnostics` and
`context_management`, thinking blocks, empty Anthropic text blocks (dropped), and the exact text of OpenAI tool-call
arguments (they are parsed and written back as compact JSON, so whitespace changes and integers beyond 2^53 lose
precision).

Wrapped tools' arguments and results are stored as JSON, the way `JSON.stringify` writes them: a `Date` or `URL`
becomes its string, and a replay hands the tool's recorded result back in that JSON form.

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
- **The hash chain covers the steps, not the cassette's top-level fields.** A step's index, type, timestamp and
  payload are hash-chained; the trace `id`, `parentId`, `forkedFromStepId`, `createdAt` and the step ids are not.
- **Cassettes are as sensitive as logs.** They contain your prompts, tool arguments and tool results. Blackbox
  refuses to write the API key it sees, but other secrets in your data are yours to keep out.
