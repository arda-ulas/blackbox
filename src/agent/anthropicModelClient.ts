// Anthropic adapter — implements ModelClient behind the provider-neutral interface.
//
// W4-C1 status: skeleton only. complete() is not yet implemented.
// Full request/response translation is added in W4-C2.
//
// FORK CONTINUATION LIMITATION:
// This adapter maintains pending tool_use_id state across calls within a single
// live run. It cannot reconstruct tool_use_id values from the legacy transcript
// encoding ([tool_call:<name>] / JSON.stringify(result)) when an adapter instance
// is freshly constructed from a saved cassette. Fork continuation using this
// adapter is therefore unsound with the current transcript encoding and is
// explicitly out of scope until structured transcript migration (Path B) is done.
//
// SDK CLIENT INJECTION:
// The constructor accepts an optional `client` override so that tests can inject
// a fake without needing ANTHROPIC_API_KEY in the environment.

import Anthropic from "@anthropic-ai/sdk";
import { type ModelClient, type ModelInput, type ModelOutput, ModelCallError } from "./modelClient.ts";

// ---------------------------------------------------------------------------
// Minimal SDK-surface interface — used for test injection.
//
// Tests implement this interface with a plain object. Only the surface the
// adapter actually uses is listed here so the fake stays minimal.
// ---------------------------------------------------------------------------

export interface AnthropicLikeClient {
  messages: {
    create(params: unknown): Promise<unknown>;
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class AnthropicModelClient implements ModelClient {
  readonly #client: AnthropicLikeClient;

  constructor(options?: { apiKey?: string; client?: AnthropicLikeClient; model?: string }) {
    if (options?.client !== undefined) {
      // Test injection path — no env read, no network.
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
      // Wrap SDK construction errors so raw provider objects never escape.
      const msg = err instanceof Error ? err.message : "Anthropic client construction failed";
      throw new ModelCallError(msg, "provider_auth_error");
    }
  }

  // W4-C1 stub — full implementation in W4-C2.
  async complete(_input: ModelInput): Promise<ModelOutput> {
    throw new ModelCallError(
      "AnthropicModelClient.complete() is not yet implemented (W4-C2).",
      "unknown",
    );
  }
}
