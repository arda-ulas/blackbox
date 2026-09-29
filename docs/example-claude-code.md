# Example: what did my coding agent do?

Claude Code keeps a transcript of every session. `blackbox import` turns one into a cassette, and then you can
**see** what the agent did step by step, **check** the file is intact, and **pin** it: which tools it used, in what
order, and how it ended.

The session here is real. A Claude Code subagent was asked to add one regression test to this repository, and it
did: that test landed as commit
[`46f091b`](https://github.com/arda-ulas/blackbox/commit/46f091b). The transcript in
[`examples/claude-code-session/session.jsonl`](https://github.com/arda-ulas/blackbox/blob/master/examples/claude-code-session/session.jsonl)
was scrubbed before publishing: absolute paths became repo-relative, and the model's private thinking and the
harness's context messages were removed. Everything else is as recorded.

## Import it

```bash
curl -sLO https://raw.githubusercontent.com/arda-ulas/blackbox/master/examples/claude-code-session/session.jsonl
npx @ardaulas/blackbox import --from claude-code --in session.jsonl --out session.json
```

```text
◼ blackbox · import
From:           session.jsonl (claude-code)
Out:            session.json
Steps:          39
Status:         success
Tools:          Bash → Read → Read → Bash → Bash → Bash → Edit → Bash → Bash → SubagentHandback
```

## See what it did

```bash
npx @ardaulas/blackbox inspect session.json
```

```text
   0  model_input     989766b0  Model called with 1 message(s)
   1  model_output    e4b333a9  Model → tool_calls: Bash
   ...
   5  model_output    79cac980  Model → tool_calls: Read, Read
   ...
  23  model_output    ddaa71ca  Model → tool_calls: Edit, Bash
  24  tool_call       314d5c06  Tool called: Edit
  25  tool_result     1c01dca0  Tool result: Edit → ok
  26  tool_call       d17c5021  Tool called: Bash
  27  tool_result     b61264cf  Tool result: Bash → ok
  ...
  37  model_output    f0a6e630  Model → final_answer: "I added a test to the replay tests in `tests/session.test.ts` …"
```

It searched the test file, read two ranges of it, read the code that computes divergence paths, then made one edit
and ran the tests in the same turn. `SubagentHandback` is how a Claude Code subagent reports back to the session
that started it. To read the edit itself:

```bash
npx @ardaulas/blackbox inspect session.json --step 24
```

## Check and pin it

```bash
npx @ardaulas/blackbox verify session.json
npx @ardaulas/blackbox assert session.json --expect-status success \
  --expect-tools Bash,Read,Read,Bash,Bash,Bash,Edit,Bash,Bash,SubagentHandback
```

```text
expectations
  status               pass  success
  tools                pass  Bash, Read, Read, Bash, Bash, Bash, Edit, Bash, Bash, SubagentHandback
```

`verify` checks the cassette's hash chain and that no provider ids or keys are in it. `assert` states what you expect of the
session in a form a script can check. The most useful comparison is between two sessions of the same task: run it
again after changing your instructions (a `CLAUDE.md` rule, a prompt), import both, and
`blackbox diff --semantic first.json second.json` names the first step where the agent did something different.

## What an imported session cannot do

An imported session can be inspected, verified, diffed and asserted. It **cannot be re-run**: Blackbox was not in
Claude Code's call path when the session happened, so there is no agent to replay against it. `blackbox fork` on an
imported cassette continues with Blackbox's built-in demo agent, not with Claude Code, so a fork's answer tells you
nothing about what Claude Code would have done.

## Your own sessions

```bash
ls ~/.claude/projects/                                  # one folder per project
npx @ardaulas/blackbox import --from claude-code --in ~/.claude/projects/<project>/<session>.jsonl --out my-session.json
```

A subagent's transcript is at `~/.claude/projects/<project>/<session>/subagents/agent-*.jsonl` and imports the same
way. Transcripts contain everything the agent read and ran, so review a cassette before you share it. `import`
refuses to write one that contains a real-looking API key.
