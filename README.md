# Blackbox

Blackbox is a time-travel debugger for AI agents: scrub any run, fork it at any step, edit the prompt or break a tool, and diff the two histories.

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

## First Success Signal

`npm test`, `npm run example:record`, `npm run example:replay`, and `npm run example:fork` all work.
