# Example: root-causing a triage agent's wrong call

A back-office fleet-maintenance agent receives a telematics alert for a delivery van:

> Telematics alert for VAN-14: check-engine light on, DTC P0217 set at 2026-09-29T07:58:00Z. Please triage.

P0217 is the generic OBD-II code *Engine Coolant Over Temperature Condition*. The agent looks up the code, reads the
van's telemetry, checks its service history and opens a **routine** work order: coolant looks normal, so it blames the
temperature sensor and keeps the van in service. The van was overheating.

This page runs the root-cause investigation with Blackbox, offline and with no API key. It is the same idea as
replaying logged vehicle data against new software on a hardware-in-the-loop bench, applied to an agent: reproduce
the run exactly, isolate the fact that misled it, test the hypothesis by changing only that fact, confirm the cause,
and pin the fix.

| Step | Command | What you see |
|---|---|---|
| Symptom | — | A routine work order for a van with an overtemperature code |
| Reproduce | `replay` | The same routine answer, offline, no network |
| Isolate | `inspect` | Step 5: a telemetry reading captured before the fault was set |
| Test the hypothesis | `fork --at 5 --set …` | The fresh reading injected at step 5; the run continues with the live model (with a key) or scripted replies (without) |
| Confirm the cause | `diff` | First divergence at step 5; the priority, the answer and the tool path change |
| Preventive action | freshness check in `get_telemetry`; `npm run check` re-records and compares | Stale data is rejected; undoing the fix fails the check at step 5 |

> Example data for illustration; not repair guidance. Telemetry uses [COVESA VSS 6.1](https://covesa.github.io/vehicle_signal_specification/)
> signal paths, and each reading is a [VISS](https://github.com/COVESA/vehicle-information-service-specification)
> data point: `{ "value", "ts" }`, where `ts` is the time the value was captured. The fleet, vehicles and readings are
> invented.

## Just look (1 minute, nothing to install)

```bash
mkdir fleet-triage && cd fleet-triage
curl -sLO https://raw.githubusercontent.com/arda-ulas/blackbox/master/examples/fleet-triage/cassettes/triage-incident.json
curl -sLO https://raw.githubusercontent.com/arda-ulas/blackbox/master/examples/fleet-triage/cassettes/triage-hypothesis.json
npx @ardaulas/blackbox inspect triage-incident.json --step 5
npx @ardaulas/blackbox diff triage-incident.json triage-hypothesis.json
```

## Run the investigation (5 minutes, offline)

The example is a normal Node project: an Anthropic tool-use agent
([`triage.mjs`](https://github.com/arda-ulas/blackbox/blob/master/examples/fleet-triage/triage.mjs)), four tools over
small JSON tables ([`tools.mjs`](https://github.com/arda-ulas/blackbox/blob/master/examples/fleet-triage/tools.mjs)),
and three Blackbox lines in
[`agent.mjs`](https://github.com/arda-ulas/blackbox/blob/master/examples/fleet-triage/agent.mjs).

```bash
git clone --depth 1 https://github.com/arda-ulas/blackbox
cd blackbox/examples/fleet-triage
npm install    # the Anthropic SDK and Blackbox; no API key needed
```

### 1. Symptom

The recorded run, `cassettes/triage-incident.json`, ended with a routine work order for VAN-14.

### 2. Reproduce

Run the agent again against the recording. Every model call is answered from the cassette and every tool result is
served from it, so the run is exactly the one that happened, and nothing reaches the network.

```bash
npx blackbox replay cassettes/triage-incident.json -- node agent.mjs
```

```text
Routine: I opened work order WO-9610DE for VAN-14's next scheduled service. Coolant is normal at 91 °C, so P0217 most likely comes from the temperature sensor or its wiring, and the van can stay in service.
◼ blackbox · replay  ✓ PASS  replayed 17 steps from cassettes/triage-incident.json with no network calls (success)
```

### 3. Isolate

```bash
npx blackbox inspect cassettes/triage-incident.json
```

```text
   0  model_input     f4dadc31  Model called with 1 message(s)
   1  model_output    87030bbf  Model → tool_calls: lookup_dtc, get_telemetry (with text)
   2  tool_call       e4b15efb  Tool called: lookup_dtc
   3  tool_result     382a63da  Tool result: lookup_dtc → ok
   4  tool_call       de735110  Tool called: get_telemetry
   5  tool_result     a2044742  Tool result: get_telemetry → ok
   6  model_input     0b0461cc  Model called with 3 message(s)
   7  model_output    198b3de1  Model → tool_calls: get_service_history (with text)
   ...
  11  model_output    7e078428  Model → tool_calls: open_work_order
  ...
```

The agent's reasoning turns on step 5, the telemetry it received:

```bash
npx blackbox inspect cassettes/triage-incident.json --step 5
```

```text
{
  "toolCallId": "call-1",
  "toolName": "get_telemetry",
  "result": {
    "vehicle_id": "VAN-14",
    "data": [
      {
        "path": "Vehicle.Powertrain.CombustionEngine.EngineCoolant.Temperature",
        "dp": {
          "value": "91",
          "ts": "2026-09-28T17:05:00Z"
        }
      },
      ...
      {
        "path": "Vehicle.Diagnostics.DTCList",
        "dp": {
          "value": [],
          "ts": "2026-09-28T17:05:00Z"
        }
      }
    ]
  }
}
```

Every value was captured at 17:05 the day before, almost fifteen hours before P0217 was set at 07:58, and the snapshot's
own DTC list is empty. The agent reasoned about the van's current fault from a reading taken before the fault
existed.

### 4. Test the hypothesis

**Hypothesis:** with the reading it should have received, the agent makes the right call. Test it by changing that
one fact. The live reading, captured at 08:52, is in `inputs/live-reading.json`. Replay the run up to step 5, hand the
agent that reading, and let it continue. Without a key, the model's replies after the fork come from
`inputs/urgent-replies.json`:

```bash
npx blackbox fork cassettes/triage-incident.json --at 5 --set @inputs/live-reading.json --out my-fork.json --script inputs/urgent-replies.json -- node agent.mjs
```

```text
Urgent: take VAN-14 off the road now. Its coolant is at 124 °C, above the 110 °C threshold for P0217, so I opened an urgent work order to tow it to the depot for a cooling-system inspection.
◼ blackbox · fork  wrote my-fork.json (13 steps, success); steps 0–4 are copied from cassettes/triage-incident.json, step 5 is your new result
```

Steps 0–4 were replayed and checked against the recording. After step 5 the tools ran for real: the urgent work order
is in `work-orders.jsonl`.

**What this shows, and what it does not.** Without a key, the model's replies after step 5 are the ones in
`inputs/urgent-replies.json`: you state what a careful triager would answer, and Blackbox checks everything around
it. The agent's code made the same requests up to step 5, took the new reading, turned those replies into an urgent
work order, and the tools ran. How the model itself reasons from the fresh reading is tested with `--live` (see
[With an API key](#with-an-api-key)), where the real model continues from step 5.

### 5. Confirm the cause

```bash
npx blackbox diff cassettes/triage-incident.json my-fork.json
```

```text
First divergence at index 5
  ...
  changed fields:
    result.data[0].dp.value: "91" → "124"
    result.data[0].dp.ts: "2026-09-28T17:05:00Z" → "2026-09-29T08:52:00Z"
    result.data[1].dp.value: "84391200" → "84433900"
    result.data[1].dp.ts: "2026-09-28T17:05:00Z" → "2026-09-29T08:52:00Z"
    result.data[2].dp.value[0]: (absent) → "P0217"
    result.data[2].dp.ts: "2026-09-28T17:05:00Z" → "2026-09-29T08:52:00Z"

Outcome:        same final status (success), but the final answer changed
  parent answer: Routine: I opened work order WO-9610DE for VAN-14's next scheduled service. Coolant is normal at 91 °C, so P0217 most likely comes from the temperature sensor or its wiring, and the van can stay in service.
  child answer:  Urgent: take VAN-14 off the road now. Its coolant is at 124 °C, above the 110 °C threshold for P0217, so I opened an urgent work order to tow it to the depot for a cooling-system inspection.
  parent tools:  lookup_dtc → get_telemetry → get_service_history → open_work_order
  child tools:   lookup_dtc → get_telemetry → open_work_order
```

Everything before step 5 is hash-identical, so the telemetry reading is the only input that changed. In the keyless
walkthrough the new answer comes from the replies file; run the same fork with `--live` and the answer and tool path
are the model's own response to the fresh reading. If the call changes, as here, the stale reading is confirmed as the
cause.

### 6. Five whys

1. **Why did the van stay in service?** The agent opened a routine work order.
2. **Why routine?** It saw a normal coolant temperature (91 °C) and attributed P0217 to the sensor.
3. **Why 91 °C?** `get_telemetry` returned a snapshot captured at 17:05 the evening before.
4. **Why that snapshot?** Snapshots synced at the depot are cached with no expiry, and a cached snapshot wins over the
   live reading.
5. **Why was that not caught?** Nothing compared a reading's capture time with the fault's, and no test pinned the
   triage outcome for an overtemperature fault.

**Root cause:** telemetry freshness was never checked against the fault time.

### 7. Preventive action

**The fix.** `get_telemetry` now rejects a snapshot captured before the vehicle's latest fault, uses the live reading
instead, and says so; if no fresh reading exists, it returns `stale: true` rather than passing old data off as
current ([`tools.mjs`](https://github.com/arda-ulas/blackbox/blob/master/examples/fleet-triage/tools.mjs)):

```js
const fresh = (snapshot) => snapshot && (!fault || capturedAt(snapshot) >= fault.set_at);

if (fresh(cached)) return { vehicle_id, data: cached, stale: false };
if (fresh(live)) {
  const freshness = { stale: false };
  if (cached) freshness.cache_rejected = `snapshot captured ${capturedAt(cached)}, before ${fault.dtc} was set at ${fault.set_at}`;
  return { vehicle_id, data: live, ...freshness };
}
// no fresh reading: return the newest one with stale: true and a warning
```

**The new run.** `cassettes/triage-fixed.json` is the same ticket recorded again with the fix in place (by
`make-cassettes.mjs`, with the stand-in model). Replaying it with the current code shows the agent still sends the
same requests, and `inspect` shows what the fixed tool returned at step 5:

```bash
npx blackbox replay cassettes/triage-fixed.json -- node agent.mjs
npx blackbox inspect cassettes/triage-fixed.json --step 5
```

```text
Urgent: take VAN-14 off the road now. Its coolant is at 124 °C, above the 110 °C threshold for P0217, so I opened urgent work order WO-9E2562 to tow it to the depot for a cooling-system inspection.
◼ blackbox · replay  ✓ PASS  replayed 13 steps from cassettes/triage-fixed.json with no network calls (success)
...
    "stale": false,
    "cache_rejected": "snapshot captured 2026-09-28T17:05:00Z, before P0217 was set at 2026-09-29T07:58:00Z"
```

**The guard.** Replay alone cannot catch this regression: it serves recorded tool results, so it never runs
`get_telemetry`. The guard records again instead. `npm run check` re-records the ticket offline with the current
code and compares each run with the committed cassette, step by step:

```bash
npm run check
```

```text
triage-incident.json: matches
triage-hypothesis.json: matches
triage-fixed.json: matches
```

Undo the freshness check and the same command fails, at the step that matters:

```text
triage-fixed.json no longer matches what the current code records:
First divergence at index 5
  ...
  parent tools:  lookup_dtc → get_telemetry → open_work_order
  child tools:   lookup_dtc → get_telemetry → get_service_history → open_work_order
```

This repository runs that check, including the undo, in its test suite. `assert` states the fixed run's expected
outcome in a form a script can check:

```bash
npx blackbox assert cassettes/triage-fixed.json --expect-status success --expect-tools lookup_dtc,get_telemetry,open_work_order
```

```text
expectations
  status               pass  success
  tools                pass  lookup_dtc, get_telemetry, open_work_order
```

## With an API key

Record the same ticket against a real model, and continue a fork with it:

```bash
export ANTHROPIC_API_KEY=...
npx blackbox record --out my-triage.json -- node agent.mjs
npx blackbox fork my-triage.json --at 5 --set @inputs/live-reading.json --out my-live-fork.json --live -- node agent.mjs
```

`agent.mjs` runs the fixed `get_telemetry`, so a new recording shows the fixed behavior. A real model decides for
itself, so check `inspect` for the step index of the `get_telemetry` result before forking. `ANTHROPIC_MODEL` picks
the model (default `claude-haiku-4-5`).

## How the cassettes were made

`make-cassettes.mjs` records all three with a **scripted stand-in model** in place of the API, so the walkthrough
behaves the same for everyone. The agent code, the tools and the cassette format are the real ones; only the model's
replies are scripted. The incident run uses `get_telemetry` as it was deployed at the time (`getTelemetryAsDeployed`
in `tools.mjs`), and the fixed run uses the current one. `node make-cassettes.mjs` regenerates them offline.
