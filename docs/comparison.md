# How it compares

Checked in September 2026. If something here is out of date, please open an issue.

| | Records | Replays your agent offline | Fork with a changed fact | Tamper-evident trace | Runs without a server |
|---|---|---|---|---|---|
| **Blackbox** | Model calls via the SDK `fetch` option, plus wrapped tools | Yes, with field-by-field request checks | Yes, at any recorded tool result; continue live or scripted | Yes (hash chain) | Yes |
| **Laminar** | OpenTelemetry-style traces | Its debugger reruns with earlier LLM calls served from a cache | Rerun from a point | No | No (cloud or self-hosted) |
| **LangGraph time travel** | Graph-state checkpoints | No: steps after the checkpoint re-run live | Yes (`update_state`) | No | Yes, but LangGraph agents only |
| **backspin** | SDK wrapper or proxy, to a file | Yes (fingerprint matching) | Yes (`branch`) | No | Yes |
| **HTTP cassette recorders** (VCR-style, Polly.js) | Raw HTTP traffic | Yes, at the HTTP level | No | No | Yes |

## Notes

- **[Laminar](https://github.com/lmnr-ai/lmnr)** (Apache-2.0) is a tracing and evaluation platform. Its agent
  debugger reruns an agent with the calls before your change served from a cache. It is the better choice if you
  want hosted traces, dashboards and evaluations. Blackbox is a set of local files and a CLI.
- **[LangGraph time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel)** forks a LangGraph
  run from a checkpoint by updating its state. Checkpoints capture graph state, not individual model calls, and
  execution after the fork calls the model live. Blackbox works under any agent loop that uses the official SDKs,
  and can continue a fork from scripted replies.
- **[backspin](https://github.com/zaibuchihuoji/backspin)** is closest in shape: it records runs to a file, replays
  them offline, branches with a changed value and diffs to the first divergence. It is Python-first (its TypeScript
  SDK is installed from GitHub), matches requests by fingerprint, and has no hash chain, so you cannot check a
  branch's shared prefix against its parent by comparing hashes.
- **HTTP recorders** make tests deterministic at the network level. They have no notion of a tool result to
  change, no divergence report, and no check that a recording was not edited.
