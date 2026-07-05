// Model client interface and a fake deterministic implementation.
//
// Real model calls always sit behind ModelClient so the agent loop can run
// identically against the fake (recording, tests) or a real API (live use).

import type { JsonValue } from "../trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
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
