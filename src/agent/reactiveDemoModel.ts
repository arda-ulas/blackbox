// Reactive deterministic demo-continuation model (W7-A).
//
// A tiny ModelClient whose final answer is COMPUTED from the transcript it is
// handed — specifically from the most recent tool_result MessagePart — rather
// than read from a script. It exists to close the demo-credibility gap in the
// offline fork walkthrough: when `fork`/`check` continue a run past a mutated
// tool result, the child's answer must visibly REACT to that mutation (change
// the mutation, change the answer) instead of returning a hardcoded string.
//
// It is NOT a framework and NOT a planner:
//   - one class, one fixed rule table, no configuration surface, no plugins;
//   - it always returns `final_answer`, never `tool_call` — it is a one-round
//     continuation model, so the demo child stays at 7 steps.
//
// It is pure and deterministic by construction: complete(input) is a pure
// function of ModelInput — no Date.now, no randomness, no I/O, no network, no
// provider import — so the same input always yields byte-identical output. It
// never mutates its input. Its output text is provider-neutral (no provider
// markers), so child traces pass the neutrality audit.
//
// FakeDeterministicModelClient (scripted playback) is deliberately unchanged and
// remains the default for record paths, the fixtures generator, and tests that
// script a fixed sequence. This client is used only for the fork/`check`
// continuation step.

import { canonicalize } from "../trace/hash.ts";
import type { JsonValue } from "../trace/TraceTypes.ts";
import type {
  Message,
  MessagePart,
  ModelClient,
  ModelInput,
  ModelOutput,
} from "./modelClient.ts";

// ---------------------------------------------------------------------------
// Transcript scanning helpers (pure)
// ---------------------------------------------------------------------------

/** The result-bearing variant of a tool_result MessagePart. */
type ToolResultResultPart = Extract<MessagePart, { type: "tool_result"; result: JsonValue }>;
/** The error-bearing variant of a tool_result MessagePart. */
type ToolResultErrorPart = Extract<MessagePart, { type: "tool_result"; error: string }>;
type ToolResultPart = ToolResultResultPart | ToolResultErrorPart;

/**
 * Scan the transcript for the most recent tool_result part. Walks messages and
 * their structured content from the end so the latest tool round wins. Returns
 * null when no tool_result is present (e.g. a prompt-mode fork whose transcript
 * carries only the mutated user prompt).
 */
function latestToolResult(messages: ReadonlyArray<Message>): ToolResultPart | null {
  for (let m = messages.length - 1; m >= 0; m--) {
    const content = messages[m].content;
    if (typeof content === "string") continue;
    for (let p = content.length - 1; p >= 0; p--) {
      const part = content[p];
      if (part.type === "tool_result") return part;
    }
  }
  return null;
}

/** Extract the last user message's plain text, for the no-tool_result fallback. */
function latestUserText(messages: ReadonlyArray<Message>): string {
  for (let m = messages.length - 1; m >= 0; m--) {
    const msg = messages[m];
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string") return msg.content;
    // Structured user turns concatenate any text parts (tool_result-only turns
    // yield "", which the fallback wording handles).
    const text = msg.content
      .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join(" ");
    if (text.length > 0) return text;
  }
  return "";
}

function isObject(v: JsonValue): v is { [k: string]: JsonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: JsonValue | undefined): string | null {
  return typeof v === "string" ? v : null;
}

// ---------------------------------------------------------------------------
// ReactiveDemoModelClient
// ---------------------------------------------------------------------------

export class ReactiveDemoModelClient implements ModelClient {
  // Constructor takes no required arguments by design — there is no
  // configuration surface. Kept explicit for symmetry with the interface.
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor() {}

  async complete(input: ModelInput): Promise<ModelOutput> {
    return { type: "final_answer", text: this.answer(input) };
  }

  /** Pure rule table: derive the final answer text from the transcript. */
  private answer(input: ModelInput): string {
    const messages = input.messages ?? [];
    const latest = latestToolResult(messages);

    // Rule 4: no tool_result in the transcript (every prompt-mode fork hits
    // this — forkRun only reconstructs tool rounds under tool-result mutations).
    // Derive a deterministic answer from the last user message text.
    if (latest === null) {
      const prompt = latestUserText(messages);
      return prompt.length > 0
        ? `No tool results were available; responding to the request directly: "${prompt}".`
        : "No tool results were available and no request text was provided; nothing to act on.";
    }

    const toolName = latest.toolName;

    // Rule 1: error-variant tool_result → name the tool and embed the error.
    if ("error" in latest) {
      return `The ${toolName} tool call failed with error: ${latest.error}. I cannot complete this request.`;
    }

    const result = latest.result;

    if (isObject(result)) {
      const available = result["available"];
      const results = result["results"];

      // Rule 2: no availability — available === false, or an empty results
      // array. Embed a payload-derived field (the message when present) so the
      // answer visibly changes when the mutation's message changes.
      const emptyResults = Array.isArray(results) && results.length === 0;
      if (available === false || emptyResults) {
        const message = asString(result["message"]);
        const detail =
          message ??
          `available=${JSON.stringify(available ?? null)}, ${Array.isArray(results) ? results.length : 0} result(s)`;
        return `Based on the ${toolName} result, no options are available: "${detail}". I could not complete the booking.`;
      }

      // Rule 3: availability — a non-empty results array. Embed a deterministic
      // payload field (result count and the first result's title when present).
      if (Array.isArray(results) && results.length > 0) {
        const first = results[0];
        const firstTitle = isObject(first) ? asString(first["title"]) : null;
        const firstDesc = firstTitle ?? canonicalize(first);
        return `Based on the ${toolName} result, ${results.length} option(s) are available (first: "${firstDesc}"). Proceeding to complete the booking.`;
      }
    }

    // Rule 5: unrecognized-but-JSON-safe result shape → deterministic fallback
    // embedding the tool name and a short canonical rendering. Never throws.
    return `The ${toolName} tool returned an unrecognized result shape: ${canonicalize(result)}. I cannot reliably act on it.`;
  }
}
