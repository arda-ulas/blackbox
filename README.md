# Blackbox

Blackbox is a time-travel debugger for AI agents: record a multi-step run, replay it fully offline from cassette, fork at any step with a mutated prompt or tool result, and diff the two execution histories.

## Status

Week Four structured transcript migration (W4-D) is complete and tagged (`week-four-structured-transcript-migration`). The Week Four Anthropic adapter spike (`week-four-anthropic-adapter-spike`), adapter boundary (`week-four-adapter-boundary`), Week Three CLI packaging, Week-two hardening, and Week-one CLI proof are all accepted and tagged.

The core trace format is now **schema v2**: tool rounds are recorded as structured, provider-neutral transcript parts (`MessagePart`) carrying a deterministic `toolCallId`. See [docs/03_trace_schema.md](docs/03_trace_schema.md).

W4-E is **proven**: opt-in live proofs confirmed the full active-debugging loop against the real Anthropic Messages API. **E1** (`npm run example:real-tooluse-proof`) showed the API accepts Blackbox's synthetic `toolCallId` (`call-0`) as the request-local `tool_use.id` / `tool_result.tool_use_id` on a real tool-use record. **E2/E3** (`npm run example:real-fork-proof`) showed a **fresh** adapter continuing from a *mutated* structured v2 fork point using only cassette data — the API accepted it, and the child diffed with first divergence at the mutated `tool_result` over a hash-identical prefix. The full live **record → replay → fork → mutate → continue → diff** loop is proven, provider-neutral, and neutrality-clean.

All three Anthropic proofs are **opt-in, proof-script only** — none is wired into the CLI. The default CLI and all of `npm test` remain fully fake and deterministic, and replay is always cassette-only (no model or tool calls).

See [DEMO.md](DEMO.md) for a full command-by-command walkthrough.

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

## Week-Three CLI ✓

- **W3-A** — Unified `npm run cli --` entry point with `record`, `replay`, `fork`, `diff` subcommands; hand-rolled arg parser; flag validation
- **W3-B** — `list` and `inspect` subcommands; `list` validates hash chains before counting files as valid
- **W3-C** — Terminal output polish: consistent section headers, human-readable divergence summary (`Summary: tool_result differs at index 3`), `[blackbox]` prefixes on command headers
- **W3-D** — Demo walkthrough (`DEMO.md`)

## Not Current Focus

- Web UI / Dashboard / Metrics charts
- LangChain / Agent framework / MCP
- Figma / design polish
- Hosted backend / Auth / Sharing

## Quick Start

```sh
npm install
npm test -- --run
npm run cli -- record
npm run cli -- list
npm run cli -- inspect
npm run cli -- replay
npm run cli -- fork
npm run cli -- diff --parent traces/example-trace.json --child traces/example-trace-fork.json
```

See [DEMO.md](DEMO.md) for annotated expected output and explanation of each step.
