# Claude Code session example

`session.jsonl` is a real Claude Code session: a subagent that added a regression test to this repository (commit
`46f091b`). It was scrubbed before publishing: absolute paths became repo-relative, provider ids became placeholders, session metadata was dropped, and the model's private thinking
and the harness's context messages were removed.

```bash
npx @ardaulas/blackbox import --from claude-code --in session.jsonl --out session.json
npx @ardaulas/blackbox inspect session.json
```

Walkthrough: [docs/example-claude-code.md](../../docs/example-claude-code.md). An imported session can be inspected,
verified, diffed and asserted, but not re-run.
