# Project Brief: Blackbox

## Mission

Blackbox is a time-travel debugger for AI agents.

It records multi-step model/tool runs, replays them offline from cassette, forks from any step, mutates a prompt or tool result, and diffs the resulting execution histories.

## Why This Project

Blackbox was chosen because it combines:
- current AI/agent infrastructure relevance
- strong employer signal
- real systems engineering
- replay/time-travel interaction
- a clear 30-second demo
- a week-one technical proof

## Portfolio Signal

Blackbox should demonstrate:
- trace schema design
- deterministic replay through cassette playback
- agent tool-loop implementation
- execution-tree diffing
- fork/branch mechanics
- disciplined scope control

## Core Interaction

Record → replay → fork → mutate → continue → diff.

## First Milestone

A CLI proof that records, replays, forks, and diffs one fixture agent run.
