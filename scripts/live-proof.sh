#!/usr/bin/env bash
# Opt-in live proof, run by hand: record an example agent against the real API,
# replay it offline, fork it with a changed tool result continuing live, and
# diff. Spends a few cents of your own API credit. Never run by `npm test` or CI.
#
#   npm run build && scripts/live-proof.sh anthropic   # needs ANTHROPIC_API_KEY
#   npm run build && scripts/live-proof.sh openai      # needs OPENAI_API_KEY

set -euo pipefail
provider="${1:-}"
case "$provider" in
  anthropic) key_var=ANTHROPIC_API_KEY ;;
  openai) key_var=OPENAI_API_KEY ;;
  *) echo "usage: scripts/live-proof.sh anthropic|openai" >&2; exit 2 ;;
esac
# Check the key before anything runs, instead of failing inside the SDK.
if [ -z "${!key_var:-}" ]; then
  echo "live proof needs $key_var: export $key_var=<your key> and run it again (it spends a few cents of your API credit)" >&2
  exit 1
fi
if [ ! -f dist/cli.js ]; then
  echo "live proof runs the built CLI: run npm run build first" >&2
  exit 1
fi
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
