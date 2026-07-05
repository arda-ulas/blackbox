# Blackbox — Claude Code Project Memory

## Project

Blackbox is a time-travel debugger for AI agents.

It records multi-step model/tool runs, replays them offline from cassette, forks from any step, mutates a prompt or tool result, and diffs the resulting execution histories.

## Current Milestone

Week-one CLI proof. Do not build beyond this scope.

## Core Loop

record → replay → fork → mutate → continue → diff

## What to Build

Build only the local TypeScript CLI proof:

1. From-scratch tool-loop agent
2. Deterministic fixture tools
3. Fake deterministic model client behind an interface
4. Append-only trace recorder
5. Canonical hashing
6. Cassette replay
7. Prompt fork
8. Prefix verification
9. Terminal first-divergence diff

## Required Scripts

- `npm test`
- `npm run example:record`
- `npm run example:replay`
- `npm run example:fork`

## Acceptance Criteria

- `npm test` passes
- `example:record` creates a trace file
- `example:replay` replays fully offline — does not call the model or execute tools
- `example:fork` creates a child trace
- Parent and child traces share a canonical-hash-identical prefix before the fork point
- Terminal output marks the first divergence clearly

## Technical Rules

- Use TypeScript. Do not use agent frameworks.
- Keep modules small and testable.
- Model calls must sit behind an interface (`ModelClient`).
- Replay is cassette playback — do not call the model or execute tools during replay.
- Use canonical serialization (sorted keys, stable JSON) for all hashes.
- Every meaningful behavior must have tests.

## Do Not Build

Do not reopen project ideation. Do not build any of the following until the week-one proof is complete and explicitly re-scoped:

- Web UI / Dashboard / React components
- LangChain / MCP proxy / Agent frameworks
- Auth / Hosted backend / Sharing
- Figma / design polish / metrics charts
- Multi-agent orchestration / Production SDK
- Timeline UI / Branch graph / Semantic diff / Chaos fork / OTEL export

## Response Format

When making changes, always summarize:

1. Files changed
2. What is real (live code paths)
3. What is mocked (fixtures, fakes, stubs)
4. Whether tests pass
5. Next safest task
