// Generate docs/cli.md from the CLI's own help table (src/cli/help.ts), so the
// reference page and `blackbox <command> --help` cannot drift apart.
//   npx tsx scripts/cliReference.ts          write docs/cli.md
//   npx tsx scripts/cliReference.ts --check  exit 1 if docs/cli.md is stale

import { readFileSync, writeFileSync } from "node:fs";
import { COMMANDS } from "../src/cli/help.ts";

/** Put `<placeholders>` and `--flags` in code spans (bare angle brackets would be read as HTML). */
function code(text: string): string {
  return text.replace(/(?<!`)(<[^>]+>|--[a-z][a-z-]*(?: (?:strict|sequence)\b)?)(?!`)/g, "`$1`");
}

export function renderCliReference(): string {
  const lines: string[] = [
    "# CLI reference",
    "",
    "<!-- Generated from src/cli/help.ts by scripts/cliReference.ts. Do not edit by hand. -->",
    "",
    "Every command also prints this with `blackbox <command> --help`. Commands that take a cassette accept it",
    "as the first argument.",
    "",
  ];
  for (const group of ["Your agent", "Cassettes", "Built-in demo"] as const) {
    lines.push(`## ${group}`, "");
    for (const command of COMMANDS.filter((c) => c.group === group)) {
      lines.push(`### \`${command.name}\``, "", `${command.summary}.`, "", "```text");
      lines.push(...command.usage);
      lines.push("```", "");
      if (command.description) lines.push(code(command.description.join(" ").replace(/\s+/g, " ")), "");
      if (command.flags.length > 0) {
        lines.push("| Flag | Meaning |", "|---|---|");
        for (const [flag, meaning] of command.flags) lines.push(`| \`${flag.replace(/\|/g, "\\|")}\` | ${code(meaning).replace(/\|/g, "\\|")} |`);
        lines.push("");
      }
      lines.push("```bash", ...command.examples, "```", "");
    }
  }
  return lines.join("\n");
}

const target = new URL("../docs/cli.md", import.meta.url);
if (process.argv[1]?.endsWith("cliReference.ts")) {
  const rendered = renderCliReference();
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== rendered) {
      console.error("docs/cli.md is out of date: run npx tsx scripts/cliReference.ts");
      process.exit(1);
    }
  } else {
    writeFileSync(target, rendered);
  }
}
