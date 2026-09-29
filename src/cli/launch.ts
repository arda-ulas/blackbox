// Launch the user's agent command with a recording, replay or fork session
// switched on through the environment, then report what happened.
//
// This module only spawns a process and reads the session's report file. It
// never calls a model: the agent's own code does that through its own client,
// exactly as it would without Blackbox (and in replay, not at all).

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type LaunchMode = "record" | "replay" | "fork";

export interface LaunchOptions {
  mode: LaunchMode;
  command: string[];
  cassette?: string;
  out?: string;
  traceId?: string;
  forkAt?: number;
  forkSet?: string;
  continueWith?: "live" | "script";
  script?: string;
  match?: "strict" | "sequence";
}

export interface SessionReport {
  ok: boolean;
  mode?: string;
  path?: string;
  steps?: number;
  status?: string;
  replayedSteps?: number;
  finished?: boolean;
  error?: string;
}

export interface LaunchResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  report: SessionReport | undefined;
}

export { PLACEHOLDER_KEY } from "../session/options.ts";
import { PLACEHOLDER_KEY } from "../session/options.ts";

export function launchEnv(options: LaunchOptions, reportPath: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, BLACKBOX_MODE: options.mode, BLACKBOX_REPORT: reportPath };
  if (options.cassette !== undefined) env["BLACKBOX_CASSETTE"] = resolve(options.cassette);
  if (options.out !== undefined) env["BLACKBOX_OUT"] = resolve(options.out);
  if (options.traceId !== undefined) env["BLACKBOX_TRACE_ID"] = options.traceId;
  if (options.forkAt !== undefined) env["BLACKBOX_FORK_AT"] = String(options.forkAt);
  if (options.forkSet !== undefined) env["BLACKBOX_FORK_SET"] = options.forkSet;
  if (options.continueWith !== undefined) env["BLACKBOX_CONTINUE"] = options.continueWith;
  if (options.script !== undefined) env["BLACKBOX_SCRIPT"] = resolve(options.script);
  if (options.match !== undefined) env["BLACKBOX_MATCH"] = options.match;

  // Offline modes never send a request, but SDK constructors may refuse to start
  // without a key. Fill in a placeholder only where none is set.
  const offline = options.mode === "replay" || (options.mode === "fork" && options.continueWith === "script");
  if (offline) {
    for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) {
      if (env[name] === undefined || env[name] === "") env[name] = PLACEHOLDER_KEY;
    }
  }
  return env;
}

// cmd.exe metacharacters, escaped with ^ (the approach of the cross-spawn package).
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/**
 * Quote one argument for a cmd.exe command line so it reaches the program
 * unchanged: backslash-escape embedded quotes (and the backslashes before
 * them), wrap in double quotes, then ^-escape every metacharacter. `.cmd` and
 * `.bat` launchers parse their arguments a second time, so the ^-escaping is
 * doubled for them. This also stops `%NAME%` from expanding.
 */
export function quoteForCmd(arg: string, batchLauncher = true): string {
  let quoted = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  quoted = `"${quoted}"`.replace(CMD_META, "^$1");
  return batchLauncher ? quoted.replace(CMD_META, "^$1") : quoted;
}

/**
 * How to start the agent command. Arguments are passed to the program directly
 * (no shell re-parsing), except:
 *  - a single argument containing spaces (`-- "node agent.js"`) is given to the
 *    shell to split, as the user intended;
 *  - on Windows, npm/npx-style `.cmd`/`.bat` launchers can only start through
 *    cmd.exe, so the command line is escaped for it.
 */
/**
 * Resolve a Windows command the way cmd.exe would (PATH × PATHEXT) and report
 * whether it is a batch file. Only batch files (npm's `.cmd` shims, `.bat`)
 * need cmd.exe; a real `.exe` is spawned directly.
 */
export function isBatchCommand(program: string, env: NodeJS.ProcessEnv, exists: (path: string) => boolean = existsSync): boolean {
  if (/\.(cmd|bat)$/i.test(program)) return true;
  if (/\.[a-z0-9]+$/i.test(program)) return false;
  const extensions = (env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const directories = /[\\/]/.test(program) ? [""] : (env["PATH"] ?? env["Path"] ?? "").split(";").filter(Boolean);
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = directory ? `${directory.replace(/[\\/]+$/, "")}\\${program}${extension}` : `${program}${extension}`;
      if (exists(candidate)) return /^\.(cmd|bat)$/i.test(extension);
    }
  }
  return false;
}

export function spawnPlan(
  command: readonly string[],
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): { program: string; args: string[]; shell: boolean } {
  const [program, ...args] = command;
  if (args.length === 0 && /\s/.test(program)) return { program, args: [], shell: true };
  if (platform === "win32") {
    if (isBatchCommand(program, env, exists)) {
      const line = [program.replace(CMD_META, "^$1"), ...args.map((arg) => quoteForCmd(arg))].join(" ");
      return { program: line, args: [], shell: true };
    }
  }
  return { program, args, shell: false };
}

export async function launch(options: LaunchOptions): Promise<LaunchResult> {
  const reportPath = join(tmpdir(), `blackbox-report-${process.pid}-${randomUUID()}.json`);
  const env = launchEnv(options, reportPath, process.env);
  const { program, args, shell } = spawnPlan(options.command, process.platform);

  // Let Ctrl-C reach the agent (same process group) and let it exit on its own.
  const ignoreInterrupt = (): void => {};
  process.on("SIGINT", ignoreInterrupt);
  try {
    const { exitCode, signal } = await new Promise<{ exitCode: number; signal: NodeJS.Signals | null }>((done, fail) => {
      const child = spawn(program, args, { stdio: "inherit", env, shell });
      child.once("error", (error: NodeJS.ErrnoException) =>
        fail(error.code === "ENOENT" ? new Error(`could not start "${program}": command not found`) : error),
      );
      child.once("exit", (code, sig) =>
        done({ exitCode: code ?? (sig ? 128 + (constants.signals[sig] ?? 0) : 1), signal: sig }),
      );
    });
    let report: SessionReport | undefined;
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8")) as SessionReport;
    } catch {
      report = undefined;
    }
    return { exitCode, signal, report };
  } finally {
    process.off("SIGINT", ignoreInterrupt);
    rmSync(reportPath, { force: true });
  }
}
