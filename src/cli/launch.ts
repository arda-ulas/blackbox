// Launch the user's agent command with a recording, replay or fork session
// switched on through the environment, then report what happened.
//
// This module only spawns a process and reads the session's report file. It
// never calls a model: the agent's own code does that through its own client,
// exactly as it would without Blackbox (and in replay, not at all).

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** A placeholder so SDK constructors that insist on a key work offline. */
export const PLACEHOLDER_KEY = "blackbox-offline-placeholder";

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

export async function launch(options: LaunchOptions): Promise<LaunchResult> {
  const reportPath = join(tmpdir(), `blackbox-report-${process.pid}-${randomUUID()}.json`);
  const env = launchEnv(options, reportPath, process.env);
  const [program, ...args] = options.command;
  // `-- "node agent.js"` arrives as one argument; let the shell split it.
  const viaShell = process.platform === "win32" || (args.length === 0 && /\s/.test(program));

  // Let Ctrl-C reach the agent (same process group) and let it exit on its own.
  const ignoreInterrupt = (): void => {};
  process.on("SIGINT", ignoreInterrupt);
  try {
    const { exitCode, signal } = await new Promise<{ exitCode: number; signal: NodeJS.Signals | null }>((done, fail) => {
      const child = spawn(program, args, { stdio: "inherit", env, shell: viaShell });
      child.once("error", (error: NodeJS.ErrnoException) =>
        fail(error.code === "ENOENT" ? new Error(`could not start "${program}": command not found`) : error),
      );
      child.once("exit", (code, sig) => done({ exitCode: code ?? 1, signal: sig }));
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
