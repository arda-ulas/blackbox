// JSON parsing whose errors never quote the input.
//
// A SyntaxError from JSON.parse quotes the text around the problem (for example
// `Unexpected token 'S', "SECRET_VAL"... is not valid JSON`). The text may be a
// cassette, a tool result or a credential file, so diagnostics built from it
// report only where the problem is: a line and column, never the content.

export class JsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonParseError";
  }
}

/** Where in `text` a JSON.parse SyntaxError points, as " (line L, column C)", or "". */
function location(text: string, error: unknown): string {
  const match = error instanceof Error ? /at position (\d+)/.exec(error.message) : null;
  if (match === null) return "";
  const offset = Math.min(Number(match[1]), text.length);
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  const column = offset - before.lastIndexOf("\n");
  return ` (line ${line}, column ${column})`;
}

/** JSON.parse(text), throwing a JsonParseError that names `what` and a position only. */
export function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new JsonParseError(`${what} is not valid JSON${location(text, error)}`);
  }
}
