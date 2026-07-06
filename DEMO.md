# Blackbox — CLI Demo Walkthrough

Blackbox is a local time-travel debugger for AI agents. It records a multi-step model/tool run as an append-only, hash-chained trace, replays that trace fully offline from the saved cassette (zero model or tool calls), forks at any step by injecting a mutated prompt or tool result, and diffs the resulting execution histories to find the first point where the two runs diverged. The core loop is: **record → replay → fork → mutate → continue → diff**.

This walkthrough covers the Week Three local CLI demo. Everything runs entirely on your machine with no external API calls.

---

## Prerequisites

```sh
npm install
npm test -- --run     # 162 tests; all should pass
```

---

## Demo Flow

Run these commands in order. Each builds on the files written by the previous step.

---

### 1. Record

```sh
npm run cli -- record
```

**What it does:** runs two scripted demo agent traces using a deterministic fake model and deterministic fixture tools. No real model API is called.

- **Success trace** — agent books a hotel via three tool calls (search → calendar → booking) and returns a final answer.
- **Error trace** — model calls an unknown tool (`flights`), causing the loop to abort with a `run_failed/unknown_tool` status.

**Files written:** `traces/example-trace.json`, `traces/example-error-trace.json`

**Expected output shape:**

```
[blackbox] record — generating demo traces

[blackbox] --- success trace ---
Scenario:      Book a hotel for Alice this weekend.
Trace ID:      example-run-001
Output:        traces/example-trace.json
Steps:         15
Validation:    passed
Result:        Hotel booked for Alice on 2024-03-15 at 14:00.

[blackbox] --- error trace ---
Scenario:      Find the cheapest flight to Tokyo this weekend.
Trace ID:      example-error-run
Output:        traces/example-error-trace.json
Steps:         5
Validation:    passed
Status:        error
Reason:        unknown_tool
```

**Look for:** `Validation: passed` — both traces are hash-chain verified before the run exits. `Steps: 15` for the success path (model_input + model_output + tool_call + tool_result per tool round, plus a final model_input/model_output and a terminal metadata step).

---

### 2. List

```sh
npm run cli -- list
```

**What it does:** scans `traces/` for `.json` cassette files, loads each one, validates its hash chain, and prints a compact summary row. Files that fail to load or fail hash validation are counted as warnings and not included in the valid count.

**Files read:** all `.json` files in `traces/`

**Expected output shape:**

```
[blackbox] --- list (traces) ---

  traces/example-error-trace.json
    id=example-error-run  v=1  steps=5  status=error/unknown_tool  created=YYYY-MM-DD

  traces/example-trace.json
    id=example-run-001  v=1  steps=15  status=success  created=YYYY-MM-DD

[blackbox] 2 of 2 trace(s) valid, 0 warning(s).
```

**Look for:** `status=success` and `status=error/unknown_tool` side-by-side — the list distinguishes run outcomes without re-running anything. `0 warning(s)` confirms no hash-chain corruption.

---

### 3. Inspect

```sh
npm run cli -- inspect
```

**What it does:** loads `traces/example-trace.json`, validates its hash chain, replays it offline to compute the result, then prints a full step-by-step timeline. Each step shows its index, type, an 8-character hash prefix, and a brief payload summary.

**Files read:** `traces/example-trace.json`

**Expected output shape:**

```
[blackbox] --- inspect ---

--- trace ---
Path:                traces/example-trace.json
Trace ID:            example-run-001
Version:             1
Created:             <ISO timestamp>
Steps:               15

--- status ---
Status:              success
Result:              Hotel booked for Alice on 2024-03-15 at 14:00.

[blackbox] --- steps ---
   0  model_input     <hash>  Model called with 1 message(s)
   1  model_output    <hash>  Model → tool_call: search
   2  tool_call       <hash>  Tool called: search
   3  tool_result     <hash>  Tool result: search → ok
   4  model_input     <hash>  Model called with 3 message(s)
   5  model_output    <hash>  Model → tool_call: calendar
   6  tool_call       <hash>  Tool called: calendar
   7  tool_result     <hash>  Tool result: calendar → ok
   8  model_input     <hash>  Model called with 5 message(s)
   9  model_output    <hash>  Model → tool_call: booking
  10  tool_call       <hash>  Tool called: booking
  11  tool_result     <hash>  Tool result: booking → ok
  12  model_input     <hash>  Model called with 7 message(s)
  13  model_output    <hash>  Model → final_answer: "Hotel booked for Alice on 2024-03-15 at 14:00."
  14  metadata        <hash>  Run completed: "Hotel booked for Alice on 2024-03-15 at 14:00."
```

Note: `<hash>` above is an 8-character prefix of the SHA-256 hash for that step. Hashes include wall-clock timestamps, so they vary between recording sessions but are stable for a given cassette file.

**Look for:** the alternating model_input / model_output / tool_call / tool_result pattern showing how the agent loop progresses, and the terminal `metadata` step at index 14 carrying the final result.

---

### 4. Replay

```sh
npm run cli -- replay
```

**What it does:** loads `traces/example-trace.json`, validates the hash chain, then replays every event from the cassette — **without instantiating a model client or invoking any tools**. All output is derived entirely from the saved payloads.

**Files read:** `traces/example-trace.json`

**Expected output shape:**

```
[blackbox] --- replay ---
Path:          traces/example-trace.json
Trace ID:      example-run-001
Steps:         15
Validation:    passed

--- events ---
   0  model_input     Model called with 1 message(s)
   1  model_output    Model → tool_call: search
   2  tool_call       Tool called: search
   3  tool_result     Tool result: search → ok
   ...
  14  metadata        Run completed: "Hotel booked for Alice on 2024-03-15 at 14:00."

--- summary ---
Status:        success
Result:        Hotel booked for Alice on 2024-03-15 at 14:00.
```

**Key proof point:** replay is a structural guarantee, not a convention. The `replayTrace` function takes only a `Trace` — no `ModelClient` parameter, no `FixtureTool` parameter. It is impossible to make a model or tool call from inside replay. Every event is read from the cassette.

---

### 5. Fork

```sh
npm run cli -- fork
```

**What it does:** loads the parent cassette, injects a mutated tool result at step 3 (the search result: "no hotels available"), re-chains the hash chain from the mutation point, then continues the agent run from step 4 onward with a deterministic fake model. Saves the child trace and prints a diff.

**Files read:** `traces/example-trace.json`  
**Files written:** `traces/example-trace-fork.json`

**Expected output shape:**

```
[blackbox] --- fork ---

--- parent ---
Path:           traces/example-trace.json
Trace ID:       example-run-001
Steps:          15

--- mutation ---
Mode:           tool-result
Mutation step:  3
Fork index:     4
Verbatim:       steps 0–2  (3 step(s), hashes identical to parent)
Mutated:        step 3  tool_result → new hash
Prefix len:     4 step(s)

--- child ---
Path:           traces/example-trace-fork.json
Trace ID:       example-run-001-fork
Steps:          7
Result:         No hotels available for Alice this weekend. The area is fully booked — consider a different date.
Validation:     passed

--- trace diff ---
Parent:         example-run-001
Child:          example-run-001-fork
Shared prefix:  3 step(s)

Summary:        tool_result differs at index 3
First divergence at index 3
  parent  tool_result     <hash>  {"toolName":"search","result":{"results":[{"title":"Fixtu...
  child   tool_result     <hash>  {"toolName":"search","result":{"results":[],"available":f...
```

**Key proof points:**

- **Verbatim prefix:** steps 0–2 are copied byte-for-byte from the parent. Their hashes are SHA-256 identical to the corresponding parent steps. The mutation re-chains starting at step 3, so the child hash chain is valid and self-consistent.
- **Tool-result mutation:** the injected payload (`results: [], available: false`) replaces only the `result` field of the `tool_result` step. The `toolName` is preserved. The agent's subsequent reasoning (steps 4 onward) flows from the new result.
- **Child continues cleanly:** `Validation: passed` confirms the child's full hash chain is intact from prefix through the newly generated steps.
- **Diff is immediate:** the fork command runs `diffTraces` and prints the first divergence inline — no separate diff command needed.

---

### 6. Diff

```sh
npm run cli -- diff --parent traces/example-trace.json --child traces/example-trace-fork.json
```

**What it does:** loads both cassettes, validates their hash chains, and finds the first step index where their hashes diverge. Prints a human-readable summary and the raw step details at the divergence point.

**Files read:** `traces/example-trace.json`, `traces/example-trace-fork.json`

**Expected output shape:**

```
[blackbox] --- diff ---
Parent:  traces/example-trace.json
Child:   traces/example-trace-fork.json

--- trace diff ---
Parent:         example-run-001
Child:          example-run-001-fork
Shared prefix:  3 step(s)

Summary:        tool_result differs at index 3
First divergence at index 3
  parent  tool_result     <hash>  {"toolName":"search","result":{"results":[{"title":"Fixtu...
  child   tool_result     <hash>  {"toolName":"search","result":{"results":[],"available":f...
```

**Key proof points:**

- `Shared prefix: 3 step(s)` — diff confirms that steps 0, 1, and 2 have hash-identical payloads in both traces. The prefix is verified by hash, not by content comparison.
- `Summary: tool_result differs at index 3` — human-readable one-liner naming the step type and index.
- Raw step lines show the actual injected payload difference: parent received real hotel results; child received the empty/unavailable mutation.
- Diff works on any two cassettes. You can diff the error trace against the success trace, or any two arbitrarily forked runs.

---

## What Is Real vs. Mocked

| Component | Status |
|---|---|
| Trace recording (hash chain, append-only) | Real |
| Hash verification (`validateTrace`) | Real |
| Cassette persistence (`saveTrace` / `loadTrace`) | Real |
| Offline replay (no model/tool calls) | Real — structural guarantee |
| Fork prefix copy + hash re-chain | Real |
| Tool-result mutation + chain continuation | Real |
| First-divergence diff | Real |
| Model client (`FakeDeterministicModelClient`) | Fake — scripted, deterministic |
| Fixture tools (search, calendar, booking) | Fake — in-memory, no network |

---

## Current Limitations

- **Fake model and tools only (default CLI).** The default CLI demo shown above is fully deterministic: `FakeDeterministicModelClient` plays back scripted responses and fixture tools run in-memory. No real LLM API is called by any CLI command or by `npm test`. An optional Anthropic proof script exists — `npm run example:real-proof` — which records one real final-text-only run and replays it offline; it is opt-in (requires `ANTHROPIC_API_KEY`), is **not** CLI adapter wiring, and is **not** part of the default test suite.
- **Local CLI only.** Everything runs on the local filesystem. No hosted backend, no remote cassette storage, no sharing links.
- **No UI.** All interaction is terminal output. There is no web dashboard, branch graph, or timeline view.
- **Single-agent only.** The loop, recorder, and fork logic assume one agent running one tool at a time. Multi-agent orchestration is out of scope.
- **Not a generic observability platform.** Blackbox records structured traces for replay and forking — it is not an OpenTelemetry exporter or a production log aggregator.
- **Not npm-published.** The CLI is invoked via `npm run cli --` inside the repo. Packaging as a global binary or published package is a future phase.
- **Demo scenarios only.** The scripted hotel-booking and flight-error scenarios illustrate the loop. Running Blackbox against arbitrary agent code requires implementing the `ModelClient` interface and wiring up real tools.

---

## Running All Steps End to End

```sh
npm install
npm test -- --run
npm run cli -- record
npm run cli -- list
npm run cli -- inspect
npm run cli -- replay
npm run cli -- fork
npm run cli -- diff --parent traces/example-trace.json --child traces/example-trace-fork.json
```

All commands exit 0. The diff command confirms the first divergence at index 3 with a `tool_result differs` summary and raw hash/payload details for both sides.
