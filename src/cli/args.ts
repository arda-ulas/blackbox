// Command-line argument parsing: `--flag value`, boolean `--flag`, positionals,
// and everything after a bare `--` as the command to launch.

export interface ParsedArgs {
  flags: Record<string, string | boolean>;
  positionals: string[];
  /** Tokens after a bare `--` (the agent command for record/replay/fork). */
  command: string[] | undefined;
  help: boolean;
}

/**
 * Parse `args`. A flag listed in `booleanFlags` never consumes the next token;
 * any other flag takes the next token as its value unless that token starts
 * with `--` (then the flag is `true`, which callers report as a missing value).
 */
export function parseArgs(args: readonly string[], booleanFlags: readonly string[] = []): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let command: string[] | undefined;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      command = args.slice(i + 1);
      break;
    }
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (booleanFlags.includes(key) || next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
      continue;
    }
    positionals.push(arg);
  }
  return { flags, positionals, command, help };
}
