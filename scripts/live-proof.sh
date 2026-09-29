#!/usr/bin/env bash
# Opt-in live proof, run by hand: record an example agent against the real API,
# replay it offline, fork it with a changed tool result continuing live, and
# diff. Spends a few cents of your own API credit. Never run by `npm test` or CI.
#
#   npm run build && scripts/live-proof.sh anthropic   # needs ANTHROPIC_API_KEY
#   npm run build && scripts/live-proof.sh openai      # needs OPENAI_API_KEY

set -euo pipefail
provider="${1:?usage: scripts/live-proof.sh anthropic|openai}"
agent="examples/${provider}-agent.mjs"
out="traces/live-${provider}"
mkdir -p traces
cli="node dist/cli.js"

$cli record --out "$out.json" -- node "$agent"
env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY $cli replay "$out.json" -- node "$agent"
$cli inspect "$out.json"

# Fork at the first Lisbon tool result: make Lisbon rainy and continue live.
at=$(node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const s = t.steps.find((s) => s.type === "tool_result" && JSON.stringify(s.payload.result).includes("24"));
  if (!s) { console.error("no Lisbon tool result recorded"); process.exit(1); }
  console.log(s.index);' "$out.json")
$cli fork "$out.json" --at "$at" --set '{"tempC":9,"sky":"storm"}' --out "$out-fork.json" --live -- node "$agent"
$cli diff "$out.json" "$out-fork.json"
$cli verify "$out-fork.json"
