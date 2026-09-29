# Examples

Two small tool-use agents, one per provider, each with Blackbox wired in (the lines marked
`← Blackbox`). They are ordinary agents: recording them calls the real API with your key.

```bash
npm install && npm run build           # the examples import the built package
npx blackbox record --out traces/trip.json -- node examples/anthropic-agent.mjs
npx blackbox replay traces/trip.json -- node examples/anthropic-agent.mjs
```

`npm run proof:anthropic` and `npm run proof:openai` run the whole loop on an example
(record, replay offline, fork with a changed tool result continuing live, diff, verify) and
spend a few cents of your own API credit. Set `ANTHROPIC_MODEL` or `OPENAI_MODEL` to pick the
model. They never run in `npm test` or CI.
