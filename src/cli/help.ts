// Help text for every command. The same table renders `blackbox --help`,
// `blackbox <command> --help`, and the CLI reference page of the docs site
// (scripts/cliReference.ts), so the three never drift apart.

export interface CommandSpec {
  name: string;
  group: "Your agent" | "Cassettes" | "Built-in demo";
  summary: string;
  usage: string[];
  description?: string[];
  flags: Array<[flag: string, description: string]>;
  examples: string[];
}

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: "record",
    group: "Your agent",
    summary: "Run your agent and record its model calls and tool results to a cassette",
    usage: ["blackbox record --out <cassette.json> [--id <trace-id>] -- <command...>"],
    description: [
      "Runs <command> with recording switched on. Your agent must create a session with",
      "blackbox() and pass bb.fetch to its Anthropic or OpenAI client; wrap its tools with",
      "bb.tools({...}) to record their results too. Calls go to the real API as usual.",
    ],
    flags: [
      ["--out <path>", "Where to write the cassette (required)"],
      ["--id <trace-id>", "Trace id stored in the cassette (default: the file name)"],
    ],
    examples: ["blackbox record --out runs/weather.json -- node agent.js"],
  },
  {
    name: "replay",
    group: "Your agent",
    summary: "Re-run your agent offline from a cassette, or summarize a cassette",
    usage: [
      "blackbox replay <cassette.json> [--match strict|sequence] -- <command...>",
      "blackbox replay <cassette.json>",
    ],
    description: [
      "With a command: runs your agent again with every model call answered from the",
      "cassette and every wrapped tool returning its recorded result. Nothing reaches the",
      "network and no API key is needed. The run fails at the first request that differs",
      "from the recording (--match sequence skips that check).",
      "Without a command: prints the cassette's recorded steps and outcome.",
    ],
    flags: [
      ["--match strict|sequence", "Compare each request to the recording (strict, default) or serve responses in order (sequence)"],
      ["--trace <path>", "The cassette, instead of the positional argument"],
    ],
    examples: ["blackbox replay runs/weather.json -- node agent.js", "blackbox replay runs/weather.json"],
  },
  {
    name: "fork",
    group: "Your agent",
    summary: "Re-run your agent with one recorded tool result changed",
    usage: [
      "blackbox fork <cassette.json> --at <step> --set <json> --out <fork.json> (--live | --script <replies.json>) -- <command...>",
      "blackbox fork --trace <cassette.json> [--mutation-step N --payload-json JSON | --mode prompt --prompt TEXT]",
    ],
    description: [
      "With a command: replays your agent up to the tool_result step --at, hands it the",
      "--set value instead of the recorded result, then continues. After the fork point the",
      "model is your live API client (--live, uses your key) or the replies in a script file",
      "(--script: a JSON array like [{\"type\":\"final_answer\",\"text\":\"...\"}]); wrapped",
      "tools run for real. Then `blackbox diff` shows the first step that changed.",
      "Without a command: forks with Blackbox's built-in demo agent (offline).",
    ],
    flags: [
      ["--at <step>", "Index of the recorded tool_result step to replace (see `blackbox inspect`)"],
      ["--set <json>", "The replacement tool result, as JSON"],
      ["--out <path>", "Where to write the forked cassette"],
      ["--live", "Continue after the fork point with your real API client"],
      ["--script <path>", "Continue after the fork point with scripted model replies"],
      ["--match strict|sequence", "How the replayed prefix is checked (default strict)"],
    ],
    examples: [
      "blackbox fork runs/weather.json --at 3 --set '{\"temp\":35}' --out runs/hot.json --live -- node agent.js",
      "blackbox fork runs/weather.json --at 3 --set '{\"temp\":35}' --out runs/hot.json --script replies.json -- node agent.js",
    ],
  },
  {
    name: "diff",
    group: "Cassettes",
    summary: "Find the first step where two cassettes diverge",
    usage: ["blackbox diff <parent.json> <child.json> [--semantic]"],
    description: [
      "Compares step by step and reports the first divergence, the value that changed, and",
      "whether the outcome (status, final answer, tool path) changed. By default steps are",
      "compared by hash, which is right for a fork and its parent. --semantic compares step",
      "type and payload only, for two separate recordings of the same run.",
    ],
    flags: [
      ["--semantic", "Ignore timestamps and hash-chain fields"],
      ["--parent <path> --child <path>", "The two cassettes, instead of positional arguments"],
    ],
    examples: ["blackbox diff runs/weather.json runs/hot.json"],
  },
  {
    name: "verify",
    group: "Cassettes",
    summary: "Check a cassette's schema, hash chain, provider neutrality and replayability",
    usage: ["blackbox verify <cassette.json>"],
    flags: [["--trace <path>", "The cassette, instead of the positional argument"]],
    examples: ["blackbox verify runs/weather.json"],
  },
  {
    name: "assert",
    group: "Cassettes",
    summary: "Verify a cassette and check its outcome; exits 1 on failure (for CI)",
    usage: ["blackbox assert <cassette.json> [--expect-status S] [--expect-final-answer TEXT] [--expect-tools a,b] [--expect-failure-reason R]"],
    flags: [
      ["--expect-status success|error|incomplete", "Expected terminal status"],
      ["--expect-final-answer <text>", "Expected final answer (exact)"],
      ["--expect-tools <a,b,...>", "Expected tool-call sequence (recorded tool calls, in order)"],
      ["--expect-failure-reason <reason>", "Expected failure reason"],
      ["--trace <path>", "The cassette, instead of the positional argument"],
    ],
    examples: ["blackbox assert runs/weather.json --expect-status success --expect-tools weather,weather"],
  },
  {
    name: "inspect",
    group: "Cassettes",
    summary: "Show a cassette's metadata and step timeline, or one step in full",
    usage: ["blackbox inspect <cassette.json> [--step N]"],
    flags: [
      ["--step <N>", "Print step N in full: its type, hash, time and complete payload"],
      ["--trace <path>", "The cassette, instead of the positional argument"],
    ],
    examples: ["blackbox inspect runs/weather.json", "blackbox inspect runs/weather.json --step 3"],
  },
  {
    name: "list",
    group: "Cassettes",
    summary: "List the cassettes in a directory",
    usage: ["blackbox list [dir]"],
    flags: [["--dir <path>", "The directory, instead of the positional argument (default: traces)"]],
    examples: ["blackbox list runs"],
  },
  {
    name: "import",
    group: "Cassettes",
    summary: "Convert a Claude Code session or chat JSON transcript into a cassette",
    usage: ["blackbox import --from claude-code|chat-json --in <file> --out <cassette.json> [--id <trace-id>]"],
    description: [
      "claude-code reads a session file from ~/.claude/projects/<project>/<session>.jsonl.",
      "The cassette is written only if it passes verify.",
    ],
    flags: [
      ["--from claude-code|chat-json", "The transcript format"],
      ["--in <path>", "The transcript to read"],
      ["--out <path>", "Where to write the cassette"],
      ["--id <trace-id>", "Trace id stored in the cassette (default: the file name)"],
    ],
    examples: ["blackbox import --from claude-code --in ~/.claude/projects/my-app/1234.jsonl --out runs/session.json"],
  },
  {
    name: "demo",
    group: "Built-in demo",
    summary: "Write the two sample cassettes (a hotel booking and a failing run)",
    usage: ["blackbox demo [--scenario success|error|all] [--out-dir <dir>]"],
    flags: [
      ["--scenario success|error|all", "Which sample run to record (default all)"],
      ["--out-dir <dir>", "Where to write them (default traces)"],
    ],
    examples: ["blackbox demo --out-dir traces"],
  },
  {
    name: "check",
    group: "Built-in demo",
    summary: "Run the whole loop offline on the built-in demo and print one verdict",
    usage: ["blackbox check [--out-dir <dir>]"],
    flags: [["--out-dir <dir>", "Keep the cassettes it writes (default: in memory only)"]],
    examples: ["blackbox check"],
  },
];

export function findCommand(name: string): CommandSpec | undefined {
  return COMMANDS.find((command) => command.name === name);
}

export function commandHelp(spec: CommandSpec): string {
  const lines: string[] = [spec.summary, "", "Usage:"];
  for (const usage of spec.usage) lines.push(`  ${usage}`);
  if (spec.description) lines.push("", ...spec.description);
  if (spec.flags.length > 0) {
    lines.push("", "Flags:");
    const width = Math.max(...spec.flags.map(([flag]) => flag.length));
    for (const [flag, description] of spec.flags) lines.push(`  ${flag.padEnd(width)}  ${description}`);
  }
  lines.push("", "Example:");
  for (const example of spec.examples) lines.push(`  ${example}`);
  return lines.join("\n");
}

export function mainHelp(version: string): string {
  const lines = [
    `Blackbox ${version}: a time-travel debugger for AI agents.`,
    "Record your agent's run to a hash-chained cassette, replay it offline, fork it with one",
    "tool result changed, and diff to the first step where the runs part.",
    "",
    "Usage: blackbox <command> [flags]",
  ];
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  for (const group of ["Your agent", "Cassettes", "Built-in demo"] as const) {
    lines.push("", `${group}:`);
    for (const command of COMMANDS.filter((c) => c.group === group)) {
      lines.push(`  ${command.name.padEnd(width)}  ${command.summary}`);
    }
  }
  lines.push(
    "",
    "Run `blackbox <command> --help` for a command's flags and an example.",
    "Docs: https://arda-ulas.github.io/blackbox/",
  );
  return lines.join("\n");
}
