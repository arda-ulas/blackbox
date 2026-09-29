// Public API of @ardaulas/blackbox.
//
//   const bb = blackbox();                              // no-op unless a mode is set
//   const client = new Anthropic({ fetch: bb.fetch });  // or new OpenAI({ fetch: bb.fetch })
//   const tools = bb.tools({ search, book });           // your functions, same names
//   ...your agent...
//   await bb.finish();
//
// The mode comes from options or from the environment the `blackbox record |
// replay | fork -- <command>` launcher sets, so the same code records, replays
// and forks.

import { BlackboxSession } from "./session/session.ts";
import type { BlackboxOptions } from "./session/options.ts";

/** Create a recording/replay session. With no mode set it passes everything through. */
export function blackbox(options: BlackboxOptions = {}): BlackboxSession {
  return new BlackboxSession(options);
}

export { BlackboxSession };
export type { FinishOptions, FinishSummary, WrappedTools } from "./session/session.ts";
export type { BlackboxMode, BlackboxOptions, ContinueMode, MatchMode } from "./session/options.ts";
export type { NeutralOutput } from "./integrations/common.ts";
export {
  BlackboxError,
  BlackboxUnsupportedError,
  ReplayDivergenceError,
  isBlackboxError,
} from "./errors.ts";

// Offline analysis over cassettes (these never call a model or run a tool).
export type { Trace, TraceStep, TraceStepType, JsonValue } from "./trace/TraceTypes.ts";
export { loadTrace, saveTrace, validateTrace, replayTrace, type ReplaySummary } from "./replay/CassetteReplay.ts";
export { verifyTrace, verifyTraceFile, type VerifyReport } from "./trace/verifyTrace.ts";
export { diffTraces, diffTracesSemantic, formatDiffReport, type TraceDiff } from "./fork/diffTraces.ts";
export { diffOutcome, type OutcomeDiff } from "./fork/diffOutcome.ts";
export { assertCassette, assertCassetteFile, type AssertExpectations } from "./workflow/assertCassette.ts";
export { adaptClaudeCodeTranscript, parseClaudeCodeJsonl } from "./ingest/claudeCodeTranscript.ts";
