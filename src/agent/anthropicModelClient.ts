// Anthropic adapter — implements ModelClient behind the provider-neutral interface.
//
// STRUCTURED TRANSCRIPT PATH (W4-D4):
// Structured v2 messages (Message.content as MessagePart[]) are translated
// directly: a tool_use part maps to an Anthropic tool_use block whose `id` is the
// cassette's deterministic toolCallId, and a tool_result part maps to a
// tool_result block whose `tool_use_id` is that same toolCallId. Correlation
// therefore lives entirely in the cassette data — a FRESH adapter instance can
// translate a saved multi-turn history with no prior in-memory state. This
// removes the adapter-memory dependency for mocked structured translation;
// live provider acceptance of synthetic ids is deferred to W4-E.
//
// NOTE: The synthetic `call-N` ids are self-consistent within the request we
// build (tool_use.id === matching tool_result.tool_use_id). These mocked tests do
// not assert that a live Anthropic endpoint accepts such synthetic ids.
//
// LEGACY STRING FALLBACK (pre-v2):
// Plain-string content still passes through, and the legacy
// "[tool_call:<name>]" assistant encoding is still reconstructed via
// #pendingToolCalls (FIFO) for backward compatibility. This pending state is
// used ONLY for the legacy string path; the structured path never touches it.
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
  type MessagePart,
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

      // Structured v2 path: MessagePart[] content maps 1:1 to an Anthropic
      // message param, with each part translated independently. Self-contained —
      // toolCallId supplies both tool_use.id and tool_result.tool_use_id, so no
      // #pendingToolCalls memory is consulted or required here.
      if (Array.isArray(msg.content)) {
        result.push({
          role: msg.role,
          content: msg.content.map((part) => this.translatePart(part)),
        });
        i++;
        continue;
      }

      // Legacy string path (pre-v2 fallback): plain text, or the
      // "[tool_call:<name>]" assistant encoding reconstructed via pending state.
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

  /**
   * Translate a single structured MessagePart into an Anthropic content block.
   * The synthetic toolCallId is carried straight through as the block id /
   * tool_use_id, keeping tool_use ↔ tool_result correlation self-consistent
   * within the built request — no provider-native ids and no pending state.
   */
  private translatePart(part: MessagePart): InternalContentBlock {
    switch (part.type) {
      case "text":
        return { type: "text", text: part.text };

      case "tool_use":
        return {
          type: "tool_use",
          id: part.toolCallId,
          name: part.toolName,
          input: part.toolInput,
        };

      case "tool_result":
        if ("error" in part) {
          // is_error is a supported field on the SDK's ToolResultBlockParam.
          return {
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: part.error,
            is_error: true,
          };
        }
        return {
          type: "tool_result",
          tool_use_id: part.toolCallId,
          content: JSON.stringify(part.result),
        };
    }
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
