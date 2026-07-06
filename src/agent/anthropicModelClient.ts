// Anthropic adapter — implements ModelClient behind the provider-neutral interface.
//
// FORK CONTINUATION LIMITATION:
// This adapter maintains pending tool_use_id state across calls within a single
// live run instance. It cannot reconstruct tool_use_id values from the legacy
// transcript encoding ([tool_call:<name>] / JSON.stringify(result)) when a fresh
// adapter instance is created from a saved cassette. Fork continuation via this
// adapter is therefore unsound with the current transcript encoding and is
// explicitly out of scope until structured transcript migration (Path B) is done.
//
// PENDING TOOL CALL STATE:
// After returning a tool_call ModelOutput, the adapter stores the corresponding
// tool_use_id and original input in #pendingToolCalls (FIFO). On the next
// complete() call the matching legacy transcript assistant message
// ([tool_call:<toolName>]) is reconstructed into a proper tool_use content block.
// The proof scenario must use each tool at most once per run to avoid name
// collisions in the pending queue.
//
// SDK CLIENT INJECTION:
// The constructor accepts an optional `client` field so that tests can inject a
// fake AnthropicLikeClient without needing ANTHROPIC_API_KEY in the environment.

import {
  AuthenticationError,
  APIConnectionTimeoutError,
  RateLimitError,
  APIError,
} from "@anthropic-ai/sdk";
import Anthropic from "@anthropic-ai/sdk";
import {
  type ModelClient,
  type ModelInput,
  type ModelOutput,
  type Message,
  type ToolDefinition,
  ModelCallError,
} from "./modelClient.ts";
import type { JsonValue } from "../trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// SDK surface interface — minimal, test-injectable.
// ---------------------------------------------------------------------------

export interface AnthropicLikeClient {
  messages: {
    create(params: unknown): Promise<unknown>;
  };
}

// ---------------------------------------------------------------------------
// Internal API shape types
// Defined locally so tests do not need to import from @anthropic-ai/sdk.
// ---------------------------------------------------------------------------

interface InternalToolParam {
  name: string;
  description?: string;
  input_schema: { type: string; [key: string]: unknown };
}

interface InternalMessageParam {
  role: "user" | "assistant";
  content: string | unknown[];
}

interface InternalCreateParams {
  model: string;
  max_tokens: number;
  messages: InternalMessageParam[];
  system?: string;
  tools?: InternalToolParam[];
}

// Content blocks — only the fields the adapter reads.
type InternalContentBlock = { type: string; [key: string]: unknown };

interface InternalApiResponse {
  stop_reason: string | null;
  content: InternalContentBlock[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 1024;
const TOOL_CALL_PATTERN = /^\[tool_call:(.+)\]$/;

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class AnthropicModelClient implements ModelClient {
  readonly #client: AnthropicLikeClient;
  readonly #model: string;

  // FIFO queue of pending tool calls from the most recent tool_use response.
  // Each entry holds the tool_use_id and original input needed to reconstruct
  // the assistant+user message pair on the next complete() call.
  readonly #pendingToolCalls: Array<{ id: string; name: string; input: unknown }> = [];

  constructor(options?: { apiKey?: string; client?: AnthropicLikeClient; model?: string }) {
    this.#model = options?.model ?? DEFAULT_MODEL;

    if (options?.client !== undefined) {
      // Test injection — no env read, no network.
      this.#client = options.client;
      return;
    }

    const apiKey = options?.apiKey ?? process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      throw new ModelCallError(
        "ANTHROPIC_API_KEY is not set. " +
          "Provide it via environment variable or inject a client for testing.",
        "provider_auth_error",
      );
    }

    try {
      this.#client = new Anthropic({ apiKey });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Anthropic client construction failed";
      throw new ModelCallError(msg, "provider_auth_error");
    }
  }

  async complete(input: ModelInput): Promise<ModelOutput> {
    const params = this.buildParams(input);

    let raw: unknown;
    try {
      raw = await this.#client.messages.create(params);
    } catch (err) {
      throw this.normalizeError(err);
    }

    return this.translateResponse(raw);
  }

  // ---------------------------------------------------------------------------
  // Request translation — private helpers
  // ---------------------------------------------------------------------------

  private buildParams(input: ModelInput): InternalCreateParams {
    const params: InternalCreateParams = {
      model: this.#model,
      max_tokens: DEFAULT_MAX_TOKENS,
      messages: this.translateMessages(input.messages),
    };

    if (input.systemPrompt !== undefined) {
      params.system = input.systemPrompt;
    }

    if (input.tools !== undefined && input.tools.length > 0) {
      params.tools = input.tools.map((def: ToolDefinition): InternalToolParam => ({
        name: def.name,
        description: def.description,
        input_schema: { type: "object", ...(def.inputSchema ?? {}) },
      }));
    }

    return params;
  }

  private translateMessages(messages: Message[]): InternalMessageParam[] {
    const result: InternalMessageParam[] = [];
    let i = 0;

    while (i < messages.length) {
      const msg = messages[i];
      const toolMatch = msg.role === "assistant" ? TOOL_CALL_PATTERN.exec(msg.content) : null;

      if (toolMatch) {
        // Legacy transcript assistant turn: "[tool_call:<toolName>]"
        // Reconstruct as a proper Anthropic tool_use content block.
        const toolName = toolMatch[1];
        const pendingIdx = this.#pendingToolCalls.findIndex((p) => p.name === toolName);

        if (pendingIdx < 0) {
          throw new ModelCallError(
            `Cannot reconstruct tool_use block for "${toolName}": no pending tool call state. ` +
              "Fork continuation from cassette is unsupported until structured transcript migration.",
            "provider_malformed_response",
          );
        }

        const [pending] = this.#pendingToolCalls.splice(pendingIdx, 1);

        result.push({
          role: "assistant",
          content: [{ type: "tool_use", id: pending.id, name: pending.name, input: pending.input }],
        });

        // Consume the paired user tool-result message that immediately follows.
        i++;
        const resultMsg = messages[i];
        if (!resultMsg || resultMsg.role !== "user") {
          throw new ModelCallError(
            "Malformed message sequence: expected user tool-result message after tool-call assistant message.",
            "provider_malformed_response",
          );
        }

        result.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: pending.id, content: resultMsg.content }],
        });
      } else {
        // Plain text message — pass through as a string (shorthand form accepted by the API).
        result.push({ role: msg.role, content: msg.content });
      }

      i++;
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Response translation — private helpers
  // ---------------------------------------------------------------------------

  private translateResponse(raw: unknown): ModelOutput {
    const response = raw as InternalApiResponse;
    const { stop_reason, content } = response;

    if (stop_reason === "tool_use") {
      const block = content.find((b) => b["type"] === "tool_use");
      if (!block) {
        throw new ModelCallError(
          "Response has stop_reason tool_use but no tool_use content block.",
          "provider_malformed_response",
        );
      }

      const id = block["id"] as string;
      const name = block["name"] as string;
      const input = block["input"];

      // Store id so the next complete() call can reconstruct the message pair.
      this.#pendingToolCalls.push({ id, name, input });

      // Return provider-neutral output — no tool_use_id, no Anthropic-native fields.
      return { type: "tool_call", toolName: name, toolInput: input as JsonValue };
    }

    if (stop_reason === "end_turn") {
      const block = content.find((b) => b["type"] === "text");
      if (!block) {
        throw new ModelCallError(
          "Response has stop_reason end_turn but no text content block.",
          "provider_malformed_response",
        );
      }
      return { type: "final_answer", text: block["text"] as string };
    }

    if (stop_reason === "refusal") {
      throw new ModelCallError("Provider refused the request.", "provider_refusal");
    }

    throw new ModelCallError(
      `Unexpected stop_reason: ${String(stop_reason)}.`,
      "provider_malformed_response",
    );
  }

  // ---------------------------------------------------------------------------
  // Error normalization — private helpers
  // ---------------------------------------------------------------------------

  private normalizeError(err: unknown): ModelCallError {
    if (err instanceof ModelCallError) return err;

    // Classify known SDK error types — raw SDK objects never escape.
    if (err instanceof AuthenticationError) {
      return new ModelCallError("Provider authentication failed.", "provider_auth_error");
    }
    if (err instanceof APIConnectionTimeoutError) {
      return new ModelCallError("Provider request timed out.", "provider_timeout");
    }
    if (err instanceof RateLimitError) {
      return new ModelCallError("Provider rate limit exceeded.", "unknown");
    }
    if (err instanceof APIError) {
      return new ModelCallError("Provider API error.", "unknown");
    }

    const msg = err instanceof Error ? err.message : "Unknown provider error.";
    return new ModelCallError(msg, "unknown");
  }
}
