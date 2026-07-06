// Model client interface and a fake deterministic implementation.
//
// Real model calls always sit behind ModelClient so the agent loop can run
// identically against the fake (recording, tests) or a real API (live use).

import type { JsonObject, JsonValue } from "../trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

/**
 * A single structured part of a message's content (W4-D structured transcript).
 *
 * Provider-neutral by design: `toolCallId` is a Blackbox-generated correlation
 * key (see toolCallId.ts), never a provider-native id such as Anthropic's
 * `tool_use_id`. This lets tool-call correlation live in cassette data rather
 * than adapter memory.
 *
 * STATUS (W4-D, schema v2): these structured parts are now emitted. `agentLoop`
 * records tool rounds as `MessagePart[]`, `forkRun` reconstructs structured
 * `MessagePart[]` histories, and `AnthropicModelClient` consumes them on its
 * structured translation path. The legacy `[tool_call:<name>]` / stringified
 * result encoding survives only as a narrow fallback for plain-string content.
 * Whether a live provider accepts a synthetic `toolCallId` as its `tool_use.id`
 * is not proven here and remains deferred to W4-E.
 */
export type MessagePart =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolCallId: string; toolName: string; toolInput: JsonValue }
  | { type: "tool_result"; toolCallId: string; toolName: string; result: JsonValue }
  | { type: "tool_result"; toolCallId: string; toolName: string; error: string };

export interface Message {
  role: "user" | "assistant";
  /**
   * Plain-string text shorthand, or a structured list of parts. String content
   * remains fully supported (all current call sites use it); structured parts
   * are introduced for tool rounds starting in W4-D2.
   */
  content: string | MessagePart[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema describing the tool's input. Required by real provider adapters; optional for fixture tools. */
  inputSchema?: JsonObject;
}

/** Provider-neutral tool execution boundary. Decouples agentLoop from fixture-tool internals. */
export interface ToolExecutor {
  /** Returns JSON-safe tool metadata for inclusion in model input. */
  definitions(): ToolDefinition[];
  /** Executes the named tool with the given input. Throws if the tool is unknown. */
  execute(name: string, input: JsonValue): Promise<JsonValue>;
}

export interface ModelInput {
  systemPrompt?: string;
  messages: Message[];
  tools?: ToolDefinition[];
}

/** The model either requests a tool call or produces a final answer. */
export type ModelOutput =
  | { type: "tool_call"; toolName: string; toolInput: JsonValue }
  | { type: "final_answer"; text: string };

// ---------------------------------------------------------------------------
// Model-call error classification
// ---------------------------------------------------------------------------

/** Semantic classification of a model-call failure. Used in the terminal metadata step. */
export type ModelErrorKind =
  | "provider_auth_error"
  | "provider_timeout"
  | "provider_refusal"
  | "provider_malformed_response"
  | "unknown";

/**
 * Throw from a ModelClient.complete() implementation to signal a classified failure.
 * agentLoop catches this and records a terminal metadata step with the given errorKind
 * before re-throwing so callers know the run failed.
 */
export class ModelCallError extends Error {
  readonly errorKind: ModelErrorKind;

  constructor(message: string, errorKind: ModelErrorKind = "unknown") {
    super(message);
    this.name = "ModelCallError";
    this.errorKind = errorKind;
  }
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ModelClient {
  complete(input: ModelInput): Promise<ModelOutput>;
}

// ---------------------------------------------------------------------------
// Fake deterministic implementation
// ---------------------------------------------------------------------------

/**
 * Returns scripted responses in order. Deterministic by construction:
 * call N always returns response[N] regardless of the actual input.
 *
 * Throws if the agent loop calls complete() more times than there are
 * scripted responses — this surfaces prompt-loop runaway early in tests.
 */
export class FakeDeterministicModelClient implements ModelClient {
  private readonly responses: ModelOutput[];
  private callCount = 0;

  constructor(responses: ModelOutput[]) {
    this.responses = responses.map((r) => structuredClone(r));
  }

  async complete(_input: ModelInput): Promise<ModelOutput> {
    if (this.callCount >= this.responses.length) {
      throw new Error(
        `FakeDeterministicModelClient: no scripted response for call index ${this.callCount} ` +
          `(${this.responses.length} response(s) scripted)`,
      );
    }
    const response = this.responses[this.callCount];
    this.callCount += 1;
    return structuredClone(response);
  }

  /** How many times complete() has been called. Useful in tests. */
  callsMade(): number {
    return this.callCount;
  }
}
