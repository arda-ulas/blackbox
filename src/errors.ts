// Errors raised by the recording/replay session.
//
// Inside an SDK call these never escape as thrown fetch errors: the SDKs wrap a
// failed fetch as a retryable connection error. The session instead answers the
// request with a non-retryable HTTP 400 whose message starts with "[blackbox]",
// keeps the typed error, and rethrows it from `finish()`. `isBlackboxError`
// recognizes both the typed error and an SDK error that wraps one.

export class BlackboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlackboxError";
  }
}

/** A request uses something this version cannot record or replay (streaming, images, …). */
export class BlackboxUnsupportedError extends BlackboxError {
  constructor(message: string) {
    super(message);
    this.name = "BlackboxUnsupportedError";
  }
}

/** During replay or a fork prefix, the agent sent a request the cassette did not record. */
export class ReplayDivergenceError extends BlackboxError {
  readonly stepIndex: number;
  readonly path: string;
  readonly expected: string;
  readonly actual: string;

  constructor(details: { stepIndex: number; path: string; expected: string; actual: string; hint?: string }) {
    super(
      `replay diverged at step ${details.stepIndex}, ${details.path}\n` +
        `  recorded: ${details.expected}\n` +
        `  actual:   ${details.actual}` +
        (details.hint ? `\n${details.hint}` : ""),
    );
    this.name = "ReplayDivergenceError";
    this.stepIndex = details.stepIndex;
    this.path = details.path;
    this.expected = details.expected;
    this.actual = details.actual;
  }
}

/** True for a Blackbox error, or an SDK error whose message or cause carries one. */
export function isBlackboxError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth++) {
    if (current instanceof BlackboxError) return true;
    if (current instanceof Error && current.message.includes("[blackbox]")) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
