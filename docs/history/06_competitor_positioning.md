# Competitor Positioning

## Blackbox vs. the Field

| Tool | Offline Replay | Fork at Step K | Prefix Verification | No Cloud Required |
|---|---|---|---|---|
| LangSmith | No | No | No | No |
| Phoenix (Arize) | No | No | No | Partial |
| PromptLayer | No | No | No | No |
| W&B Traces | No | No | No | No |
| **Blackbox** | **Yes** | **Yes** | **Yes** | **Yes** |

## Positioning Statement

Blackbox is not an observability dashboard. It is a time-travel debugger: you record a run, replay it offline, fork it at any step, mutate one input, and diff the two resulting execution histories.

The week-one proof demonstrates the core mechanic. Every other tool in the space records and visualizes. Only Blackbox replays and branches.

## Target Employer Signal

- LLM observability platforms (reliability, evals, tracing)
- Agent infrastructure (framework-agnostic tool loops, deterministic replay)
- Developer tooling (CLI-first, composable, no framework lock-in)
- Systems engineering (canonical hashing, append-only trace, prefix verification)

## What Blackbox Is Not

- Not a prompt management tool
- Not a model evaluation platform
- Not a hosted SaaS
- Not a wrapper around LangChain or any agent framework
