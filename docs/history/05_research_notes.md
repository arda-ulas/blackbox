# Research Notes

## Prior Art

### LangSmith (LangChain)
- Full hosted observability platform for LLM chains
- Trace capture, comparison, annotation, dataset management
- Requires LangChain SDK; no standalone replay or offline cassette
- Blackbox difference: offline replay from cassette, no cloud dependency, fork/mutate at any step

### Phoenix (Arize)
- Open-source LLM observability and evals
- OTEL-based trace ingestion, UI for span inspection
- No fork/replay mechanic; observation-only
- Blackbox difference: deterministic replay and branch diffing, not just observation

### PromptLayer
- Prompt versioning and run logging
- Dashboard-centric; no offline replay
- Blackbox difference: local CLI proof first, replay is a core primitive not a log viewer

### Weights & Biases (W&B) Traces
- Experiment tracking extended to LLM runs
- Heavy infra, requires account; no step-level fork
- Blackbox difference: fork at step k is the central mechanic

## Key Insight

None of the above tools let you *fork an agent run mid-execution, mutate one input, and diff the two resulting histories*. That is the unique mechanic Blackbox proves in week one.

## Cassette Pattern Reference

The cassette replay concept mirrors VCR-style HTTP mocking (vcr.py, nock):
- Record real interactions once
- Replay them deterministically offline in tests
- Blackbox extends this to full multi-step agent loops

## Hashing Reference

Canonical JSON serialization is established practice:
- Sorted keys, no whitespace variability
- Used in content-addressable storage (IPFS, git objects)
- Blackbox applies this to agent step payloads for deterministic prefix verification
