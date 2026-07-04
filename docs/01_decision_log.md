# Decision Log

## 2026-07-04 — Choose Blackbox as the next portfolio project

### Decision

Build Blackbox: a time-travel debugger for AI agent runs.

### Why

- Strong current AI/agent infrastructure relevance
- Maps to employer themes like LLM observability, evals, agentic systems, platform tooling, and reliability
- Reuses replay/timeline strengths from prior work
- Avoids generic chatbot/wrapper territory
- Has a concrete week-one proof

### Consequences

- Start with CLI trace/replay/fork proof.
- Do not build UI until the trace system works.
- Do not brainstorm further unless week-one proof fails under the defined failure condition.
