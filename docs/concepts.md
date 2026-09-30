# Concepts

## Cassette

A cassette is one run of your agent saved as a JSON file: an ordered list of **steps**.

| Step | Holds |
|---|---|
| `model_input` | The request: messages, tools, system prompt, model, and controls such as `maxTokens` |
| `model_output` | The response: a final answer, or the tool calls requested (with any text alongside) |
| `tool_call` | A wrapped tool being called, with its arguments |
| `tool_result` | What that tool returned, or the error it threw |
| `metadata` | How the run ended: `run_completed` with the answer, or `run_failed` with a reason |

Steps are **provider-neutral**. An Anthropic run and an OpenAI run of the same agent produce the same kind of
cassette. Provider ids (`toolu_…`, `call_…`), token usage and stop metadata are not stored; tool calls get
Blackbox's own ids, `call-0`, `call-1`, and so on. See [trace format](./trace-format).

## Hash chain

Every step stores a SHA-256 hash of its index, type, timestamp and payload together with the previous step's hash.
Changing any of those changes the step's hash and every hash after it. `verify` recomputes the chain, so an edit
that does not also recompute every later hash fails; comparing the final hash with one you kept elsewhere (a commit,
a CI log) catches an edit to the steps even when every later hash was recomputed.

The chain does not cover the cassette's top-level fields (`id`, `parentId`, `forkedFromStepId`, `createdAt`) or
each step's `id` (see [hash input](./trace-format#hash-input)). Those can be changed without `verify` or `diff`
noticing. Covering them is planned for a future cassette format version. The hash chain is also how `diff` tells two cassettes apart: the first step
whose hash differs is the first divergence. It is not a signature: anyone can write a new, internally consistent
cassette.

## Session

`blackbox()` creates a session. It does nothing unless a mode is set, either by the CLI (`blackbox record|replay|fork
... -- <command>`) or by options (`blackbox({ mode: "record", out: "run.json" })`).

- `bb.fetch` goes into the SDK client's `fetch` option. Blackbox sees each model request and response as the SDK
  sends them over HTTP; your code and the SDK are otherwise untouched.
- `bb.tools({...})` wraps your tool functions under the names the model uses.
- `bb.finish()` ends the run and writes the cassette.

## Record

In record mode the session forwards every call to the API. After a successful response it stores the request and
the response, and wrapped tools store their arguments and results. When the model asks for several tools at once
and your agent runs them concurrently, their steps are still written in the order the model asked for them, so the
cassette is deterministic.

## Replay

In replay mode nothing is forwarded. For each request your agent makes, the session:

1. normalizes it the same way the recording was normalized,
2. compares it with the recorded `model_input` ([what is compared](./trace-format#what-replay-compares)) and stops
   at the first difference,
3. answers with the recorded response, rebuilt in the SDK's own response shape.

Wrapped tools return their recorded results without running, after the same check on their arguments. At `finish()`
the agent must have made every recorded call, run every recorded tool, and ended with the recorded outcome (the
same result or error). A replay that gets there without a difference proves your agent still makes the recorded
requests, as far as they are compared (see [what replay compares](./trace-format#what-replay-compares)), and still reaches
the recorded result.

`--match sequence` turns the request comparison off and serves the recorded responses in order. Use it when a prompt
contains something that changes on every run (a timestamp, a random id). Every recorded call and tool must still
run, and the outcome must still match.

## Fork

A fork replays the recording up to one `tool_result` step, hands your agent a different value there, and continues:

- `--live`: after the fork point the requests go to the real API and wrapped tools run for real.
- `--script replies.json`: after the fork point the model's replies come from a file, so there is no API call.

The steps before the fork point are copied from the parent verbatim (same timestamps, same hashes) once your agent
has reproduced them, so the fork provably shares the parent's history up to the step you changed.

## Diff

`diff` walks two cassettes side by side and reports:

- the **first divergent step** and the value that changed there,
- the **outcome**: whether the final status, the final answer, or the sequence of tools called changed.

By default steps are compared by hash, which is right for a fork and its parent. `--semantic` compares only step
type and payload, for two separate recordings of the same run (their timestamps always differ).

## Verify and assert

`verify` checks a cassette: schema version, hash chain, no provider ids or API keys, and that it replays to an
outcome. `assert` runs `verify` plus your expectations (status, final answer, tool sequence) and exits 1 if any
fail. See [CI](./ci).
