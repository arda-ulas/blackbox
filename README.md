# Blackbox

Blackbox is a time-travel debugger for AI agents: record a multi-step run, replay it offline from cassette, fork it at any step with a mutated prompt, and diff the two histories.

## Status

Week-one technical proof.

## Goal

Build a from-scratch recorder, cassette replay engine, fork mechanism, and terminal diff for multi-step tool-using agent runs.

## Week-One Proof

- Record one multi-step tool-using agent run.
- Save an append-only trace.
- Replay the run fully offline from cassette.
- Fork at step `k`.
- Apply a prompt mutation.
- Continue live from the fork point.
- Verify the child trace shares a canonical-hash-identical prefix with the parent.
- Print a terminal diff showing the first divergence.

## Not Current Focus

- Web UI
- Dashboard
- Metrics charts
- LangChain
- Agent framework
- MCP
- Figma/design polish
- Hosted backend
- Auth
- Sharing

## Quick Start

```sh
npm test
npm run example:record   # records a multi-step trace to traces/example-trace.json
npm run example:replay   # replays the trace offline from cassette
npm run example:fork     # forks at step 8, mutates the prompt, diffs the histories
```
