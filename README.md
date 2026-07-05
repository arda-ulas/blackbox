# Blackbox

Blackbox is a time-travel debugger for AI agents: record a multi-step run, replay it fully offline from cassette, fork at any step with a mutated prompt or tool result, and diff the two execution histories.

## Status

Week Two hardening complete (W2-A through W2-D). Week-one CLI proof accepted and tagged.

## What It Does

- **Record** — runs a scripted multi-step tool-using agent and saves an append-only, hash-chained trace to disk
- **Replay** — replays a saved trace entirely offline; no model or tool calls are made
- **Fork** — branches from any step with a mutated prompt or injected tool result; prefix hashes are provably identical to the parent up to the first divergent step (the fork point for prompt forks, the mutation target step for tool-result forks)
- **Diff** — finds the first divergence between two traces and prints it to the terminal

## Week-One Proof ✓

- Record one multi-step tool-using agent run
- Save an append-only hash-chained trace
- Replay the run fully offline from cassette
- Fork at step `k` with a mutated prompt
- Verify the child trace shares a canonical-hash-identical prefix with the parent
- Print a terminal diff showing the first divergence

## Week-Two Hardening ✓

- **W2-A** — Cassette schema versioning: `loadTrace` rejects stale or unsupported cassettes
- **W2-B** — Tool-result mutation: inject a different result at any prefix step, re-chain the hash chain from that point onward
- **W2-C** — Fork-point semantics: defined and documented for every step type; `metadata` steps are rejected as fork points
- **W2-D** — Richer demos: success path (search → calendar → booking) and error path (unknown tool) both recorded; `example:fork` demonstrates tool-result mutation

## Not Current Focus

- Web UI / Dashboard / Metrics charts
- LangChain / Agent framework / MCP
- Figma / design polish
- Hosted backend / Auth / Sharing

## Quick Start

```sh
npm test
npm run example:record   # records a success trace and an error trace to traces/
npm run example:replay   # replays the success trace offline from cassette
npm run example:fork     # injects a different search result, forks at step 4, diffs the histories
```
