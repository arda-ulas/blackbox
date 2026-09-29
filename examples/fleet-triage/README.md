# Fleet triage: a root-cause investigation

A back-office fleet-maintenance agent triages a telematics alert: *VAN-14, DTC P0217 (Engine Coolant Over Temperature
Condition) set at 07:58.* Its telemetry tool serves a snapshot cached the evening before, so the agent sees a normal
coolant temperature and opens a routine work order for a van that is overheating.

Blackbox reproduces the run offline, isolates the stale reading, tests the hypothesis by forking with the live
reading, confirms the cause with `diff`, and pins the fix. Walkthrough:
[docs/example-fleet-triage.md](../../docs/example-fleet-triage.md).

```bash
npm install
npx blackbox replay cassettes/triage-incident.json -- node agent.mjs
npx blackbox inspect cassettes/triage-incident.json --step 5
npx blackbox fork cassettes/triage-incident.json --at 5 --set @inputs/live-reading.json --out my-fork.json --script inputs/urgent-replies.json -- node agent.mjs
npx blackbox diff cassettes/triage-incident.json my-fork.json
npx blackbox assert cassettes/triage-fixed.json --expect-status success --expect-tools lookup_dtc,get_telemetry,open_work_order
```

| File | What it is |
|---|---|
| `agent.mjs` | Runs the agent with Blackbox wired in |
| `triage.mjs` | The agent loop (plain Anthropic SDK) |
| `tools.mjs` | Four tools over `data/*.json`; `get_telemetry` carries the freshness check, `getTelemetryAsDeployed` the original bug |
| `cassettes/triage-incident.json` | The incident: a routine order from a stale reading |
| `cassettes/triage-hypothesis.json` | The incident forked at step 5 with the live reading |
| `cassettes/triage-fixed.json` | A new run with the freshness check (pinned in CI) |
| `inputs/` | The live reading and scripted model replies for a keyless fork |
| `make-cassettes.mjs` | Regenerates the cassettes with a scripted stand-in model |

Example data for illustration; not repair guidance. Telemetry uses COVESA VSS 6.1 signal paths with VISS data points
(`value`, capture time `ts`); the code title is the generic OBD-II (SAE J2012) title. The fleet, vehicles and readings
are invented.
