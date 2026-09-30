// Session options, resolved from explicit options first and environment second.
//
// The CLI launcher (`blackbox record|replay|fork -- <command>`) communicates
// with the session in the child process through these environment variables,
// so the user's code never changes between modes.

import { BlackboxError } from "../errors.ts";
import type { NeutralOutput } from "../integrations/common.ts";
import type { JsonValue } from "../trace/TraceTypes.ts";

export type BlackboxMode = "off" | "record" | "replay" | "fork";

/** The key the CLI sets for offline runs so SDK constructors start; never a secret. */
export const PLACEHOLDER_KEY = "blackbox-offline-placeholder";

/** The environment variables that may hold a provider API key. */
export const API_KEY_ENV_VARS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const;

/** The API keys set in `env`, by variable name (the offline placeholder excluded). */
export function envApiKeys(env: NodeJS.ProcessEnv): Array<{ name: string; value: string }> {
  const keys: Array<{ name: string; value: string }> = [];
  for (const name of API_KEY_ENV_VARS) {
    const value = env[name];
    if (value !== undefined && value.length > 0 && value !== PLACEHOLDER_KEY) keys.push({ name, value });
  }
  return keys;
}

/**
 * Every environment variable the session reads. The CLI launcher owns all of
 * them: it clears each one before setting the current invocation's, so a value
 * left in the environment by an outer run never reaches the agent.
 */
export const SESSION_ENV_VARS = [
  "BLACKBOX_MODE",
  "BLACKBOX_CASSETTE",
  "BLACKBOX_OUT",
  "BLACKBOX_TRACE_ID",
  "BLACKBOX_FORK_AT",
  "BLACKBOX_FORK_SET",
  "BLACKBOX_CONTINUE",
  "BLACKBOX_SCRIPT",
  "BLACKBOX_MATCH",
  "BLACKBOX_REPORT",
] as const;
export type MatchMode = "strict" | "sequence";
export type ContinueMode = "live" | "script";

export interface BlackboxOptions {
  /** `off` (default) passes everything through untouched. */
  mode?: BlackboxMode;
  /** Cassette to replay or fork from. */
  cassette?: string;
  /** Where record and fork write the new cassette. */
  out?: string;
  /** Trace id for the new cassette (default: the output file name). */
  traceId?: string;
  /** Fork: index of the recorded `tool_result` step to replace. */
  forkAt?: number;
  /** Fork: the replacement tool result. */
  forkSet?: JsonValue;
  /** Fork: how the run continues after the fork point. */
  continueWith?: ContinueMode;
  /** Fork with `continueWith: "script"`: model outputs served in order after the fork point. */
  script?: NeutralOutput[];
  /** Replay and fork prefix: compare each request to the recording (`strict`, default) or not. */
  match?: MatchMode;
  /** The fetch used for live calls (default: globalThis.fetch). Tests inject a fake. */
  baseFetch?: typeof fetch;
  /** Where to write a JSON status report for the CLI launcher. */
  reportPath?: string;
  /** Print session errors to stderr as they happen (default: true). */
  logErrors?: boolean;
}

export interface ResolvedOptions {
  mode: BlackboxMode;
  cassette?: string;
  out?: string;
  traceId?: string;
  forkAt?: number;
  forkSet?: JsonValue;
  continueWith?: ContinueMode;
  script?: NeutralOutput[];
  scriptPath?: string;
  match: MatchMode;
  baseFetch: typeof fetch;
  reportPath?: string;
  logErrors: boolean;
}

const MODES: readonly BlackboxMode[] = ["off", "record", "replay", "fork"];

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value !== undefined && value.length > 0 ? value : undefined;
}

export function resolveOptions(options: BlackboxOptions, env: NodeJS.ProcessEnv): ResolvedOptions {
  const mode = options.mode ?? (envValue(env, "BLACKBOX_MODE") as BlackboxMode | undefined) ?? "off";
  if (!MODES.includes(mode)) {
    throw new BlackboxError(`BLACKBOX_MODE must be one of ${MODES.join(", ")}`);
  }

  let forkAt = options.forkAt;
  const envForkAt = envValue(env, "BLACKBOX_FORK_AT");
  if (forkAt === undefined && envForkAt !== undefined) {
    if (!/^(0|[1-9]\d*)$/.test(envForkAt)) {
      throw new BlackboxError("BLACKBOX_FORK_AT must be a step index (a non-negative integer)");
    }
    forkAt = Number(envForkAt);
  }

  let forkSet = options.forkSet;
  const envForkSet = envValue(env, "BLACKBOX_FORK_SET");
  if (forkSet === undefined && envForkSet !== undefined) {
    try {
      forkSet = JSON.parse(envForkSet) as JsonValue;
    } catch {
      throw new BlackboxError("BLACKBOX_FORK_SET must be JSON (the replacement tool result)");
    }
  }

  const continueWith = options.continueWith ?? (envValue(env, "BLACKBOX_CONTINUE") as ContinueMode | undefined);
  if (continueWith !== undefined && continueWith !== "live" && continueWith !== "script") {
    throw new BlackboxError('BLACKBOX_CONTINUE must be "live" or "script"');
  }
  const match = options.match ?? (envValue(env, "BLACKBOX_MATCH") as MatchMode | undefined) ?? "strict";
  if (match !== "strict" && match !== "sequence") {
    throw new BlackboxError('BLACKBOX_MATCH must be "strict" or "sequence"');
  }

  const resolved: ResolvedOptions = {
    mode,
    match,
    baseFetch: options.baseFetch ?? globalThis.fetch.bind(globalThis),
    logErrors: options.logErrors ?? true,
  };
  const cassette = options.cassette ?? envValue(env, "BLACKBOX_CASSETTE");
  const out = options.out ?? envValue(env, "BLACKBOX_OUT");
  const traceId = options.traceId ?? envValue(env, "BLACKBOX_TRACE_ID");
  const reportPath = options.reportPath ?? envValue(env, "BLACKBOX_REPORT");
  const scriptPath = envValue(env, "BLACKBOX_SCRIPT");
  if (cassette !== undefined) resolved.cassette = cassette;
  if (out !== undefined) resolved.out = out;
  if (traceId !== undefined) resolved.traceId = traceId;
  if (reportPath !== undefined) resolved.reportPath = reportPath;
  if (forkAt !== undefined) resolved.forkAt = forkAt;
  if (forkSet !== undefined) resolved.forkSet = forkSet;
  if (continueWith !== undefined) resolved.continueWith = continueWith;
  if (options.script !== undefined) resolved.script = options.script;
  else if (scriptPath !== undefined) resolved.scriptPath = scriptPath;
  return resolved;
}
