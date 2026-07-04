# Week-One Proof

## Objective

Prove Blackbox's core architecture:
record a multi-step agent run, replay it offline from cassette, fork from a chosen step, mutate the prompt, continue live, and diff the parent/child traces.

## Acceptance Criteria

- A small from-scratch tool-loop agent exists.
- The agent uses deterministic local fixture tools.
- A recorder writes an append-only trace.
- Cassette replay works fully offline.
- Forking at step `k` creates a child trace.
- Parent and child traces share a canonical-hash-identical prefix before the fork point.
- Terminal output marks the first divergence.

## Non-Goals

- Web UI
- Dashboard
- LangChain
- MCP
- Model observability metrics
- Auth
- Backend
- Figma/design polish
