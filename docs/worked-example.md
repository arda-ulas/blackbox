# Worked example: a wrong answer from stale data

This walks through one bug end to end using the Anthropic example agent in
[`examples/anthropic-agent.mjs`](https://github.com/arda-ulas/blackbox/blob/master/examples/anthropic-agent.mjs):
a trip helper that checks the weather in two cities with a `get_weather` tool and recommends one.

The model's wording differs from run to run; the outputs below show the shape of each step.

## The report

A user complains that the agent recommended Lisbon on a weekend with a storm warning. The agent itself looks fine.
The question is what it does when the weather data is right, and whether the fix holds.

## 1. Record the run

```bash
npx blackbox record --out runs/trip.json -- node examples/anthropic-agent.mjs
```

```text
Lisbon: 24°C and sunny beats Oslo's rain.
◼ blackbox · record  wrote runs/trip.json (9 steps, success)
```

## 2. Confirm it reproduces offline

```bash
npx blackbox replay runs/trip.json -- node examples/anthropic-agent.mjs
```

```text
Lisbon: 24°C and sunny beats Oslo's rain.
◼ blackbox · replay  ✓ PASS  replayed 9 steps from runs/trip.json with no network calls (success)
```

The same answer, from the same code, with no API call. From here on, the recorded run is the fixed point you
experiment against.

## 3. Find the fact to change

```bash
npx blackbox inspect runs/trip.json
```

```text
   1  model_output    4312fcd4  Model → tool_calls: get_weather, get_weather
   2  tool_call       f0e0c05d  Tool called: get_weather
   3  tool_result     d948816f  Tool result: get_weather → ok
   4  tool_call       521e3670  Tool called: get_weather
   5  tool_result     a150bc86  Tool result: get_weather → ok
```

Step 3 is the weather the tool returned for Lisbon: `{"tempC":24,"sky":"sunny"}`, which was stale.

## 4. Fork with the correct data

```bash
npx blackbox fork runs/trip.json --at 3 --set '{"tempC":9,"sky":"storm"}' --out runs/storm.json --live \
  -- node examples/anthropic-agent.mjs
```

```text
Neither is great; Lisbon has a storm and Oslo has rain.
◼ blackbox · fork  wrote runs/storm.json (9 steps, success); steps 0–2 are copied from runs/trip.json, step 3 is your new result
```

Blackbox replayed steps 0–2 and checked that the agent made the same requests, gave it the corrected result at
step 3, and let the live model continue.

## 5. See exactly what changed

```bash
npx blackbox diff runs/trip.json runs/storm.json
```

```text
First divergence at index 3
  changed value (result):
    parent: {"tempC":24,"sky":"sunny"}
    child:  {"tempC":9,"sky":"storm"}

Outcome:        same final status (success), but the final answer changed
  parent answer: Lisbon: 24°C and sunny beats Oslo's rain.
  child answer:  Neither is great; Lisbon has a storm and Oslo has rain.
```

With correct data the agent does not recommend Lisbon. The bug is in the data source, not the agent's reasoning.

## 6. Keep it fixed

Commit `runs/storm.json` and pin its behavior:

```bash
npx blackbox assert runs/storm.json --expect-status success \
  --expect-final-answer "Neither is great; Lisbon has a storm and Oslo has rain."
```

and check in CI that the agent's requests have not drifted:

```bash
npx blackbox replay runs/storm.json -- node examples/anthropic-agent.mjs
```

## Design notes

- **Why a hash chain.** Each step's hash covers the previous step's hash, so a cassette cannot be edited without
  `verify` noticing. It also makes the fork claim checkable: steps 0–2 of `storm.json` have the same hashes as
  steps 0–2 of `trip.json`.
- **Why strict matching.** Replay compares every request field by field before answering it. A replay that passes
  therefore shows your agent still sends exactly the recorded requests and tool calls, which a replay that answers
  blindly in order cannot.
- **Why fork at tool results.** Tool results are the facts from outside the model that an agent reasons over, and
  they are the facts most often wrong in production. Changing one and letting the model continue answers "what
  would it have done if…".
- **Why provider-neutral steps.** The same cassette format covers Anthropic, OpenAI and imported Claude Code
  sessions, and none of them store provider ids or usage data.
