# CLI reference

<!-- Generated from src/cli/help.ts by scripts/cliReference.ts. Do not edit by hand. -->

Every command also prints this with `blackbox <command> --help`. Commands that take a cassette accept it
as the first argument.

## Your agent

### `record`

Run your agent and record its model calls and tool results to a cassette.

```text
blackbox record --out <cassette.json> [--id <trace-id>] -- <command...>
```

Runs `<command>` with recording switched on. Your agent must create a session with blackbox() and pass bb.fetch to its Anthropic or OpenAI client; wrap its tools with bb.tools({...}) to record their results too. Calls go to the real API as usual.

| Flag | Meaning |
|---|---|
| `--out <path>` | Where to write the cassette (required) |
| `--id <trace-id>` | Trace id stored in the cassette (default: the file name) |

```bash
blackbox record --out runs/weather.json -- node agent.js
```

### `replay`

Re-run your agent offline from a cassette, or summarize a cassette.

```text
blackbox replay <cassette.json> [--match strict|sequence] -- <command...>
blackbox replay <cassette.json>
```

With a command: runs your agent again with every model call answered from the cassette and every wrapped tool returning its recorded result. Nothing reaches the network and no API key is needed. The run fails at the first request that differs from the recording (`--match sequence` skips that check). Without a command: prints the cassette's recorded steps and outcome.

| Flag | Meaning |
|---|---|
| `--match strict\|sequence` | Compare each request to the recording (strict, default) or serve responses in order (sequence) |
| `--trace <path>` | The cassette, instead of the positional argument |

```bash
blackbox replay runs/weather.json -- node agent.js
blackbox replay runs/weather.json
```

### `fork`

Re-run your agent with one recorded tool result changed.

```text
blackbox fork <cassette.json> --at <step> --set <json> --out <fork.json> (--live | --script <replies.json>) -- <command...>
blackbox fork --trace <cassette.json> [--mutation-step N --payload-json JSON | --mode prompt --prompt TEXT]
```

With a command: replays your agent up to the tool_result step `--at`, hands it the `--set` value instead of the recorded result, then continues. After the fork point the model is your live API client (`--live`, uses your key) or the replies in a script file (`--script`: a JSON array like [{"type":"final_answer","text":"..."}]); wrapped tools run for real. Then `blackbox diff` shows the first step that changed. Without a command: forks with Blackbox's built-in demo agent (offline).

| Flag | Meaning |
|---|---|
| `--at <step>` | Index of the recorded tool_result step to replace (see `blackbox inspect`) |
| `--set <json>` | The replacement tool result, as JSON |
| `--out <path>` | Where to write the forked cassette |
| `--live` | Continue after the fork point with your real API client |
| `--script <path>` | Continue after the fork point with scripted model replies |
| `--match strict\|sequence` | How the replayed prefix is checked (default strict) |

```bash
blackbox fork runs/weather.json --at 3 --set '{"temp":35}' --out runs/hot.json --live -- node agent.js
blackbox fork runs/weather.json --at 3 --set '{"temp":35}' --out runs/hot.json --script replies.json -- node agent.js
```

## Cassettes

### `diff`

Find the first step where two cassettes diverge.

```text
blackbox diff <parent.json> <child.json> [--semantic]
```

Compares step by step and reports the first divergence, the value that changed, and whether the outcome (status, final answer, tool path) changed. By default steps are compared by hash, which is right for a fork and its parent. `--semantic` compares step type and payload only, for two separate recordings of the same run.

| Flag | Meaning |
|---|---|
| `--semantic` | Ignore timestamps and hash-chain fields |
| `--parent <path> --child <path>` | The two cassettes, instead of positional arguments |

```bash
blackbox diff runs/weather.json runs/hot.json
```

### `verify`

Check a cassette's schema, hash chain, provider neutrality and replayability.

```text
blackbox verify <cassette.json>
```

| Flag | Meaning |
|---|---|
| `--trace <path>` | The cassette, instead of the positional argument |

```bash
blackbox verify runs/weather.json
```

### `assert`

Verify a cassette and check its outcome; exits 1 on failure (for CI).

```text
blackbox assert <cassette.json> [--expect-status S] [--expect-final-answer TEXT] [--expect-tools a,b] [--expect-failure-reason R]
```

| Flag | Meaning |
|---|---|
| `--expect-status success\|error\|incomplete` | Expected terminal status |
| `--expect-final-answer <text>` | Expected final answer (exact) |
| `--expect-tools <a,b,...>` | Expected tool-call sequence (recorded tool calls, in order) |
| `--expect-failure-reason <reason>` | Expected failure reason |
| `--trace <path>` | The cassette, instead of the positional argument |

```bash
blackbox assert runs/weather.json --expect-status success --expect-tools weather,weather
```

### `inspect`

Show a cassette's metadata and step timeline, or one step in full.

```text
blackbox inspect <cassette.json> [--step N]
```

| Flag | Meaning |
|---|---|
| `--step <N>` | Print step N in full: its type, hash, time and complete payload |
| `--trace <path>` | The cassette, instead of the positional argument |

```bash
blackbox inspect runs/weather.json
blackbox inspect runs/weather.json --step 3
```

### `list`

List the cassettes in a directory.

```text
blackbox list [dir]
```

| Flag | Meaning |
|---|---|
| `--dir <path>` | The directory, instead of the positional argument (default: traces) |

```bash
blackbox list runs
```

### `import`

Convert a Claude Code session or chat JSON transcript into a cassette.

```text
blackbox import --from claude-code|chat-json --in <file> --out <cassette.json> [--id <trace-id>]
```

claude-code reads a session file from ~/.claude/projects/`<project>`/`<session>`.jsonl. The cassette is written only if it passes verify.

| Flag | Meaning |
|---|---|
| `--from claude-code\|chat-json` | The transcript format |
| `--in <path>` | The transcript to read |
| `--out <path>` | Where to write the cassette |
| `--id <trace-id>` | Trace id stored in the cassette (default: the file name) |

```bash
blackbox import --from claude-code --in ~/.claude/projects/my-app/1234.jsonl --out runs/session.json
```

## Built-in demo

### `demo`

Write the two sample cassettes (a hotel booking and a failing run).

```text
blackbox demo [--scenario success|error|all] [--out-dir <dir>]
```

| Flag | Meaning |
|---|---|
| `--scenario success\|error\|all` | Which sample run to record (default all) |
| `--out-dir <dir>` | Where to write them (default traces) |

```bash
blackbox demo --out-dir traces
```

### `check`

Run the whole loop offline on the built-in demo and print one verdict.

```text
blackbox check [--out-dir <dir>]
```

| Flag | Meaning |
|---|---|
| `--out-dir <dir>` | Keep the cassettes it writes (default: in memory only) |

```bash
blackbox check
```
