// Tests for the Anthropic adapter (W4-C1 skeleton + W4-C2 translation).
//
// All tests in this file run in the default suite — no ANTHROPIC_API_KEY required.
// Tests use injected fake AnthropicLikeClient objects; no network calls are made.
// Live integration tests (key-gated) are deferred to the W4-C3 proof script.

import { describe, it, expect } from "vitest";
import {
  AuthenticationError,
  APIConnectionTimeoutError,
  RateLimitError,
  APIError,
} from "@anthropic-ai/sdk";
import {
  AnthropicModelClient,
  type AnthropicLikeClient,
} from "../src/agent/anthropicModelClient.ts";
import {
  ModelCallError,
  FakeDeterministicModelClient,
} from "../src/agent/modelClient.ts";
import type { ModelInput, Message, ToolDefinition } from "../src/agent/modelClient.ts";

// ---------------------------------------------------------------------------
// Fake client builders
// ---------------------------------------------------------------------------

// Client that captures the params passed to create() and returns a fixed response.
function makeCapturingClient(response: unknown): {
  client: AnthropicLikeClient;
  lastParams: () => unknown;
} {
  let captured: unknown;
  return {
    client: {
      messages: {
        async create(params: unknown): Promise<unknown> {
          captured = params;
          return response;
        },
      },
    },
    lastParams: () => captured,
  };
}

// Client that always returns the given response.
function makeReturningClient(response: unknown): AnthropicLikeClient {
  return {
    messages: {
      async create(_params: unknown): Promise<unknown> {
        return response;
      },
    },
  };
}

// Client that throws the given error.
function makeThrowingClient(err: unknown): AnthropicLikeClient {
  return {
    messages: {
      async create(_params: unknown): Promise<unknown> {
        throw err;
      },
    },
  };
}

// Client that tracks whether create() was called.
function makeTrackingClient(response: unknown): {
  client: AnthropicLikeClient;
  wasCalled: () => boolean;
} {
  let called = false;
  return {
    client: {
      messages: {
        async create(_params: unknown): Promise<unknown> {
          called = true;
          return response;
        },
      },
    },
    wasCalled: () => called,
  };
}

// Canned API responses.
const finalAnswerResponse = {
  stop_reason: "end_turn",
  content: [{ type: "text", text: "The answer is 42.", citations: null }],
};

const toolUseResponse = {
  stop_reason: "tool_use",
  content: [
    { type: "tool_use", id: "toolu_abc123", name: "search", input: { query: "hotels" } },
  ],
};

const minimalInput: ModelInput = {
  messages: [{ role: "user", content: "Hello." }],
};

// A cassette-derived structured (v2) multi-turn history: a search tool round
// followed by the mutated/plain tool result, correlated purely by toolCallId.
const structuredHistory: Message[] = [
  { role: "user", content: "Find hotels." },
  {
    role: "assistant",
    content: [
      { type: "tool_use", toolCallId: "call-0", toolName: "search", toolInput: { query: "hotels" } },
    ],
  },
  {
    role: "user",
    content: [
      { type: "tool_result", toolCallId: "call-0", toolName: "search", result: { results: [] } },
    ],
  },
];

// Extract every structured content block across all message params.
function contentBlocks(params: unknown): Array<Record<string, unknown>> {
  const messages = (params as Record<string, unknown>)["messages"] as Array<
    Record<string, unknown>
  >;
  return messages.flatMap((m) =>
    Array.isArray(m["content"]) ? (m["content"] as Array<Record<string, unknown>>) : [],
  );
}

// Env guard helper.
function withoutKey<T>(fn: () => T): T {
  const orig = process.env["ANTHROPIC_API_KEY"];
  delete process.env["ANTHROPIC_API_KEY"];
  try {
    return fn();
  } finally {
    if (orig !== undefined) {
      process.env["ANTHROPIC_API_KEY"] = orig;
    }
  }
}

// ---------------------------------------------------------------------------
// Construction — injected client (W4-C1, still valid)
// ---------------------------------------------------------------------------

describe("AnthropicModelClient — construction with injected client", () => {
  it("constructs without ANTHROPIC_API_KEY when a client is injected", () => {
    withoutKey(() => {
      const { client } = makeCapturingClient(finalAnswerResponse);
      expect(() => new AnthropicModelClient({ client })).not.toThrow();
    });
  });

  it("constructs with default options when a client is injected", () => {
    withoutKey(() => {
      const { client } = makeCapturingClient(finalAnswerResponse);
      const adapter = new AnthropicModelClient({ client });
      expect(adapter).toBeDefined();
    });
  });

  it("implements the ModelClient interface (has a complete method)", () => {
    const { client } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    expect(typeof adapter.complete).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Construction — missing key, no injected client (W4-C1, still valid)
// ---------------------------------------------------------------------------

describe("AnthropicModelClient — missing API key", () => {
  it("throws when no client is injected and ANTHROPIC_API_KEY is absent", () => {
    withoutKey(() => {
      expect(() => new AnthropicModelClient()).toThrow();
    });
  });

  it("throws a ModelCallError (not a plain Error) when key is absent", () => {
    withoutKey(() => {
      let caught: unknown;
      try {
        new AnthropicModelClient();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ModelCallError);
    });
  });

  it("ModelCallError has errorKind provider_auth_error", () => {
    withoutKey(() => {
      let caught: unknown;
      try {
        new AnthropicModelClient();
      } catch (err) {
        caught = err;
      }
      expect((caught as ModelCallError).errorKind).toBe("provider_auth_error");
    });
  });

  it("error message is a non-empty string", () => {
    withoutKey(() => {
      let caught: unknown;
      try {
        new AnthropicModelClient();
      } catch (err) {
        caught = err;
      }
      const msg = (caught as ModelCallError).message;
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Request translation — W4-C2
// ---------------------------------------------------------------------------

describe("AnthropicModelClient — request translation", () => {
  it("passes model and max_tokens to create()", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    await adapter.complete(minimalInput);
    const params = lastParams() as Record<string, unknown>;
    expect(typeof params["model"]).toBe("string");
    expect((params["model"] as string).length).toBeGreaterThan(0);
    expect(typeof params["max_tokens"]).toBe("number");
    expect((params["max_tokens"] as number)).toBeGreaterThan(0);
  });

  it("uses the model from constructor options when provided", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client, model: "claude-custom-model" });
    await adapter.complete(minimalInput);
    const params = lastParams() as Record<string, unknown>;
    expect(params["model"]).toBe("claude-custom-model");
  });

  it("translates a plain user message to an Anthropic message param", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    await adapter.complete({ messages: [{ role: "user", content: "What time is it?" }] });
    const params = lastParams() as Record<string, unknown>;
    const messages = params["messages"] as Array<{ role: string; content: unknown }>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("What time is it?");
  });

  it("passes systemPrompt as the system field when provided", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    await adapter.complete({
      messages: [{ role: "user", content: "Hi." }],
      systemPrompt: "You are a helpful assistant.",
    });
    const params = lastParams() as Record<string, unknown>;
    expect(params["system"]).toBe("You are a helpful assistant.");
  });

  it("omits system field when systemPrompt is absent", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    await adapter.complete(minimalInput);
    const params = lastParams() as Record<string, unknown>;
    expect("system" in params).toBe(false);
  });

  it("translates ToolDefinition[] to Anthropic tool params with input_schema", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    const tools: ToolDefinition[] = [
      { name: "search", description: "Search the web" },
    ];
    await adapter.complete({ messages: [{ role: "user", content: "Search." }], tools });
    const params = lastParams() as Record<string, unknown>;
    const apiTools = params["tools"] as Array<Record<string, unknown>>;
    expect(apiTools).toHaveLength(1);
    expect(apiTools[0]["name"]).toBe("search");
    expect(apiTools[0]["description"]).toBe("Search the web");
    // input_schema must be present.
    expect(apiTools[0]["input_schema"]).toBeDefined();
  });

  it("uses permissive fallback input_schema { type: 'object' } when inputSchema is absent", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    const tools: ToolDefinition[] = [{ name: "ping", description: "Ping" }];
    await adapter.complete({ messages: [{ role: "user", content: "Ping." }], tools });
    const params = lastParams() as Record<string, unknown>;
    const apiTools = params["tools"] as Array<Record<string, unknown>>;
    const schema = apiTools[0]["input_schema"] as Record<string, unknown>;
    expect(schema["type"]).toBe("object");
  });

  it("merges provided inputSchema fields into input_schema alongside type: 'object'", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    const tools: ToolDefinition[] = [
      {
        name: "search",
        description: "Search",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
      },
    ];
    await adapter.complete({ messages: [{ role: "user", content: "Go." }], tools });
    const params = lastParams() as Record<string, unknown>;
    const apiTools = params["tools"] as Array<Record<string, unknown>>;
    const schema = apiTools[0]["input_schema"] as Record<string, unknown>;
    expect(schema["type"]).toBe("object");
    expect(schema["properties"]).toBeDefined();
  });

  it("translates [tool_call:<name>] assistant message using stored pending id", async () => {
    // Step 1: first call returns tool_use → adapter stores pending id.
    const responses = [toolUseResponse, finalAnswerResponse];
    let callCount = 0;
    let secondCallParams: unknown;
    const client: AnthropicLikeClient = {
      messages: {
        async create(params: unknown): Promise<unknown> {
          if (callCount === 1) secondCallParams = params;
          return responses[callCount++];
        },
      },
    };
    const adapter = new AnthropicModelClient({ client });

    // Step 2: first complete() — plain user message.
    const out1 = await adapter.complete({ messages: [{ role: "user", content: "Find hotels." }] });
    expect(out1.type).toBe("tool_call");

    // Step 3: second complete() — legacy transcript messages including the tool call pair.
    const out2 = await adapter.complete({
      messages: [
        { role: "user", content: "Find hotels." },
        { role: "assistant", content: "[tool_call:search]" },
        { role: "user", content: JSON.stringify({ results: [] }) },
      ],
    });
    expect(out2.type).toBe("final_answer");

    // Verify the second call's params reconstructed the tool_use+tool_result pair.
    const params = secondCallParams as Record<string, unknown>;
    const messages = params["messages"] as Array<Record<string, unknown>>;

    const assistantMsg = messages.find((m) => m["role"] === "assistant");
    expect(assistantMsg).toBeDefined();
    const assistantContent = assistantMsg!["content"] as Array<Record<string, unknown>>;
    expect(assistantContent[0]["type"]).toBe("tool_use");
    expect(assistantContent[0]["id"]).toBe("toolu_abc123");
    expect(assistantContent[0]["name"]).toBe("search");

    const userToolMsg = messages.find(
      (m) => m["role"] === "user" && Array.isArray(m["content"]),
    );
    expect(userToolMsg).toBeDefined();
    const userContent = userToolMsg!["content"] as Array<Record<string, unknown>>;
    expect(userContent[0]["type"]).toBe("tool_result");
    expect(userContent[0]["tool_use_id"]).toBe("toolu_abc123");
  });
});

// ---------------------------------------------------------------------------
// Structured transcript translation — W4-D4
// ---------------------------------------------------------------------------

describe("AnthropicModelClient — structured MessagePart[] translation", () => {
  it("translates a structured text part to an Anthropic text block", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    await adapter.complete({
      messages: [{ role: "assistant", content: [{ type: "text", text: "Let me check." }] }],
    });
    const blocks = contentBlocks(lastParams());
    expect(blocks).toContainEqual({ type: "text", text: "Let me check." });
  });

  it("translates a structured tool_use part to a tool_use block with id === toolCallId", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    await adapter.complete({
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", toolCallId: "call-0", toolName: "search", toolInput: { query: "hotels" } },
          ],
        },
      ],
    });
    const block = contentBlocks(lastParams()).find((b) => b["type"] === "tool_use");
    expect(block).toBeDefined();
    expect(block!["id"]).toBe("call-0");
    expect(block!["name"]).toBe("search");
    expect(block!["input"]).toEqual({ query: "hotels" });
  });

  it("translates a structured tool_result part to a tool_result block with tool_use_id === toolCallId", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    await adapter.complete({
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", toolCallId: "call-0", toolName: "search", result: { ok: true } },
          ],
        },
      ],
    });
    const block = contentBlocks(lastParams()).find((b) => b["type"] === "tool_result");
    expect(block).toBeDefined();
    expect(block!["tool_use_id"]).toBe("call-0");
    // Result is carried as a JSON-safe string.
    expect(block!["content"]).toBe(JSON.stringify({ ok: true }));
  });

  it("translates a structured tool_result error part safely with is_error", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    await adapter.complete({
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", toolCallId: "call-1", toolName: "search", error: "tool exploded" },
          ],
        },
      ],
    });
    const block = contentBlocks(lastParams()).find((b) => b["type"] === "tool_result");
    expect(block).toBeDefined();
    expect(block!["tool_use_id"]).toBe("call-1");
    expect(block!["content"]).toBe("tool exploded");
    expect(block!["is_error"]).toBe(true);
  });

  it("a fresh adapter translates cassette-derived multi-turn structured history with no pending state", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    // Fresh instance — it never returned a tool_use response, so #pendingToolCalls
    // is empty. The legacy path would have thrown; the structured path must not.
    const adapter = new AnthropicModelClient({ client });
    const out = await adapter.complete({ messages: structuredHistory });
    expect(out.type).toBe("final_answer");

    const toolUse = contentBlocks(lastParams()).find((b) => b["type"] === "tool_use");
    const toolResult = contentBlocks(lastParams()).find((b) => b["type"] === "tool_result");
    expect(toolUse).toBeDefined();
    expect(toolResult).toBeDefined();
    // Correlation reconstructed entirely from cassette data (toolCallId), not memory.
    expect(toolUse!["id"]).toBe("call-0");
    expect(toolResult!["tool_use_id"]).toBe("call-0");
    expect(toolUse!["id"]).toBe(toolResult!["tool_use_id"]);
  });

  it("structured tool_result correlation requires no pendingToolCalls state", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    // A lone tool_result as the very first message — impossible to satisfy via
    // pending state. Must still translate correctly from toolCallId alone.
    await expect(
      adapter.complete({
        messages: [
          {
            role: "user",
            content: [
              { type: "tool_result", toolCallId: "call-7", toolName: "calendar", result: { slots: [] } },
            ],
          },
        ],
      }),
    ).resolves.toBeDefined();
    const block = contentBlocks(lastParams()).find((b) => b["type"] === "tool_result");
    expect(block!["tool_use_id"]).toBe("call-7");
  });

  it("uses only the synthetic toolCallId as the block id — no provider-native id substituted", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    await adapter.complete({ messages: structuredHistory });
    const toolUse = contentBlocks(lastParams()).find((b) => b["type"] === "tool_use");
    // The id is exactly the cassette's call-N, never a "toolu_..." provider id.
    expect(toolUse!["id"]).toBe("call-0");
    expect(String(toolUse!["id"]).startsWith("toolu_")).toBe(false);
  });

  it("plain string messages still translate unchanged alongside the structured path", async () => {
    const { client, lastParams } = makeCapturingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    await adapter.complete({ messages: structuredHistory });
    const messages = (lastParams() as Record<string, unknown>)["messages"] as Array<
      Record<string, unknown>
    >;
    // The leading plain user string is passed through as a string.
    expect(messages[0]["role"]).toBe("user");
    expect(messages[0]["content"]).toBe("Find hotels.");
  });
});

// ---------------------------------------------------------------------------
// Response translation — W4-C2
// ---------------------------------------------------------------------------

describe("AnthropicModelClient — response translation", () => {
  it("translates end_turn + text block to { type: 'final_answer', text }", async () => {
    const client = makeReturningClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    const output = await adapter.complete(minimalInput);
    expect(output.type).toBe("final_answer");
    if (output.type === "final_answer") {
      expect(output.text).toBe("The answer is 42.");
    }
  });

  it("translates tool_use block to { type: 'tool_call', toolName, toolInput }", async () => {
    const client = makeReturningClient(toolUseResponse);
    const adapter = new AnthropicModelClient({ client });
    const output = await adapter.complete(minimalInput);
    expect(output.type).toBe("tool_call");
    if (output.type === "tool_call") {
      expect(output.toolName).toBe("search");
      expect(output.toolInput).toEqual({ query: "hotels" });
    }
  });

  it("ModelOutput from tool_use does not contain tool_use_id", async () => {
    const client = makeReturningClient(toolUseResponse);
    const adapter = new AnthropicModelClient({ client });
    const output = await adapter.complete(minimalInput);
    // The provider-neutral ModelOutput type has no tool_use_id field.
    // Verify no such field leaks through.
    expect((output as Record<string, unknown>)["tool_use_id"]).toBeUndefined();
    expect((output as Record<string, unknown>)["id"]).toBeUndefined();
  });

  it("ModelOutput from end_turn does not contain provider-native fields", async () => {
    const client = makeReturningClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    const output = await adapter.complete(minimalInput);
    const keys = Object.keys(output);
    // Only the two provider-neutral fields should be present.
    expect(keys).toContain("type");
    expect(keys).toContain("text");
    expect(keys).not.toContain("usage");
    expect(keys).not.toContain("stop_sequence");
    expect(keys).not.toContain("id");
    expect(keys).not.toContain("model");
  });

  it("throws ModelCallError(provider_malformed_response) for unexpected stop_reason", async () => {
    const client = makeReturningClient({
      stop_reason: "max_tokens",
      content: [],
    });
    const adapter = new AnthropicModelClient({ client });
    await expect(adapter.complete(minimalInput)).rejects.toBeInstanceOf(ModelCallError);
    await expect(adapter.complete(minimalInput)).rejects.toMatchObject({
      errorKind: "provider_malformed_response",
    });
  });

  it("throws ModelCallError(provider_refusal) for stop_reason refusal", async () => {
    const client = makeReturningClient({ stop_reason: "refusal", content: [] });
    const adapter = new AnthropicModelClient({ client });
    await expect(adapter.complete(minimalInput)).rejects.toMatchObject({
      errorKind: "provider_refusal",
    });
  });

  it("throws ModelCallError when end_turn response has no text block", async () => {
    const client = makeReturningClient({ stop_reason: "end_turn", content: [] });
    const adapter = new AnthropicModelClient({ client });
    await expect(adapter.complete(minimalInput)).rejects.toBeInstanceOf(ModelCallError);
  });

  it("throws ModelCallError when tool_use response has no tool_use block", async () => {
    const client = makeReturningClient({ stop_reason: "tool_use", content: [] });
    const adapter = new AnthropicModelClient({ client });
    await expect(adapter.complete(minimalInput)).rejects.toBeInstanceOf(ModelCallError);
  });
});

// ---------------------------------------------------------------------------
// Error normalization — W4-C2
// ---------------------------------------------------------------------------

describe("AnthropicModelClient — error normalization", () => {
  it("normalizes AuthenticationError to ModelCallError(provider_auth_error)", async () => {
    const authErr = new AuthenticationError(401, {}, "Bad credentials", new Headers());
    const client = makeThrowingClient(authErr);
    const adapter = new AnthropicModelClient({ client });
    let caught: unknown;
    try {
      await adapter.complete(minimalInput);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ModelCallError);
    expect((caught as ModelCallError).errorKind).toBe("provider_auth_error");
  });

  it("normalizes APIConnectionTimeoutError to ModelCallError(provider_timeout)", async () => {
    const timeoutErr = new APIConnectionTimeoutError({ message: "Request timed out." });
    const client = makeThrowingClient(timeoutErr);
    const adapter = new AnthropicModelClient({ client });
    let caught: unknown;
    try {
      await adapter.complete(minimalInput);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ModelCallError);
    expect((caught as ModelCallError).errorKind).toBe("provider_timeout");
  });

  it("normalizes RateLimitError to ModelCallError(unknown)", async () => {
    const rateLimitErr = new RateLimitError(429, {}, "Rate limited.", new Headers());
    const client = makeThrowingClient(rateLimitErr);
    const adapter = new AnthropicModelClient({ client });
    let caught: unknown;
    try {
      await adapter.complete(minimalInput);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ModelCallError);
    expect((caught as ModelCallError).errorKind).toBe("unknown");
  });

  it("normalizes generic APIError to ModelCallError(unknown)", async () => {
    const apiErr = new APIError(500, {}, "Internal server error.", new Headers());
    const client = makeThrowingClient(apiErr);
    const adapter = new AnthropicModelClient({ client });
    let caught: unknown;
    try {
      await adapter.complete(minimalInput);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ModelCallError);
    expect((caught as ModelCallError).errorKind).toBe("unknown");
  });

  it("normalizes a plain Error to ModelCallError(unknown) with its message", async () => {
    const plainErr = new Error("Something broke.");
    const client = makeThrowingClient(plainErr);
    const adapter = new AnthropicModelClient({ client });
    let caught: unknown;
    try {
      await adapter.complete(minimalInput);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ModelCallError);
    expect((caught as ModelCallError).errorKind).toBe("unknown");
    expect((caught as ModelCallError).message).toBe("Something broke.");
  });

  it("raw error object is not stored in the thrown ModelCallError — only a string message", async () => {
    const sdkErr = new AuthenticationError(401, {}, "Auth failed.", new Headers());
    const client = makeThrowingClient(sdkErr);
    const adapter = new AnthropicModelClient({ client });
    let caught: unknown;
    try {
      await adapter.complete(minimalInput);
    } catch (err) {
      caught = err;
    }
    // The thrown value must be a ModelCallError, not the raw SDK error.
    expect(caught).toBeInstanceOf(ModelCallError);
    expect(caught).not.toBeInstanceOf(AuthenticationError);
    // The message must be a plain string, not the SDK error object.
    expect(typeof (caught as ModelCallError).message).toBe("string");
  });

  it("complete() reaches create() before error normalization", async () => {
    const { client, wasCalled } = makeTrackingClient(finalAnswerResponse);
    const adapter = new AnthropicModelClient({ client });
    await adapter.complete(minimalInput);
    expect(wasCalled()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FakeDeterministicModelClient — unaffected (W4-C1, still valid)
// ---------------------------------------------------------------------------

describe("FakeDeterministicModelClient — unaffected by Anthropic adapter addition", () => {
  it("still returns a final_answer without touching the Anthropic adapter", async () => {
    const model = new FakeDeterministicModelClient([
      { type: "final_answer", text: "All good." },
    ]);
    const result = await model.complete(minimalInput);
    expect(result).toEqual({ type: "final_answer", text: "All good." });
  });

  it("still returns a tool_call without touching the Anthropic adapter", async () => {
    const model = new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "search", toolInput: { query: "test" } },
    ]);
    const result = await model.complete(minimalInput);
    expect(result.type).toBe("tool_call");
  });
});

// ---------------------------------------------------------------------------
// ToolDefinition inputSchema — additive change (W4-C1, still valid)
// ---------------------------------------------------------------------------

describe("ToolDefinition — inputSchema field backward compatibility", () => {
  it("fixture tool definitions do not set inputSchema (field is optional)", async () => {
    const { defaultToolExecutor } = await import("../src/agent/fixtureTools.ts");
    const defs = defaultToolExecutor().definitions();
    for (const def of defs) {
      expect(typeof def.name).toBe("string");
      expect(typeof def.description).toBe("string");
      expect("inputSchema" in def).toBe(false);
    }
  });
});
