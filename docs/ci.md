# Use a cassette in CI

A committed cassette is a regression test that needs no API key and makes no network call.

## Check the recorded outcome: `assert`

```bash
npx blackbox assert runs/trip.json \
  --expect-status success \
  --expect-tools get_weather,get_weather \
  --expect-final-answer "Lisbon: 24°C and sunny beats Oslo's rain."
```

`assert` runs `verify` (schema, hash chain, no leaked ids or keys, replayable) and then checks each expectation
exactly. It exits `0` only if everything passes. Expectations are optional:

| Flag | Checks |
|---|---|
| `--expect-status success\|error\|incomplete` | How the run ended |
| `--expect-final-answer <text>` | The final answer, exactly |
| `--expect-tools a,b` | The recorded tool calls, in order (an empty string means none) |
| `--expect-failure-reason <reason>` | Why a failed run failed |

`--expect-tools` reads the recorded `tool_call` steps, so it needs wrapped tools.

## Check that your agent still behaves the same: `replay`

```bash
npx blackbox replay runs/trip.json -- node agent.js
```

This runs your current agent code against the cassette. It fails, naming the step and field, as soon as the agent
sends a request different from the recording: a changed prompt, a renamed tool, a new parameter. It also fails if
the agent calls a wrapped tool with different arguments, or stops early. When the change is intended, re-record the
cassette and commit it with the change.

## GitHub Actions

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npm ci
- run: npx blackbox assert runs/trip.json --expect-status success
- run: npx blackbox replay runs/trip.json -- node agent.js
```

## In a test runner

Replay is also available as a library call; see [programmatic use](./integrations#programmatic-use-tests).
