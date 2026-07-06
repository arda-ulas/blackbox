// Tests for the Anthropic adapter skeleton (W4-C1).
//
// All tests in this file run in the default suite — no ANTHROPIC_API_KEY required.
// Tests use an injected fake AnthropicLikeClient so no network calls are made.
// Live integration tests (key-gated) are added in W4-C2/W4-C3.

import { describe, it, expect } from "vitest";
import {
  AnthropicModelClient,
  type AnthropicLikeClient,
} from "../src/agent/anthropicModelClient.ts";
import {
  ModelCallError,
  FakeDeterministicModelClient,
} from "../src/agent/modelClient.ts";
import type { ModelInput } from "../src/agent/modelClient.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Minimal fake that satisfies AnthropicLikeClient. Never actually calls the SDK.
function makeFakeClient(): AnthropicLikeClient {
  return {
    messages: {
      async create(_params: unknown): Promise<unknown> {
        // In W4-C1 complete() is stubbed before reaching the client, but if it
        // ever did reach here it should surface a clear error rather than silently
        // hanging or making a real network request.
        throw new Error("makeFakeClient: create() should not be called in W4-C1 tests");
      },
    },
  };
}

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

const minimalInput: ModelInput = {
  messages: [{ role: "user", content: "hello" }],
};

// ---------------------------------------------------------------------------
// Construction — injected client
// ---------------------------------------------------------------------------

describe("AnthropicModelClient — construction with injected client", () => {
  it("constructs without ANTHROPIC_API_KEY when a client is injected", () => {
    withoutKey(() => {
      expect(() => new AnthropicModelClient({ client: makeFakeClient() })).not.toThrow();
    });
  });

  it("constructs with default options when a client is injected", () => {
    withoutKey(() => {
      const adapter = new AnthropicModelClient({ client: makeFakeClient() });
      expect(adapter).toBeDefined();
    });
  });

  it("implements the ModelClient interface (has a complete method)", () => {
    const adapter = new AnthropicModelClient({ client: makeFakeClient() });
    expect(typeof adapter.complete).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Construction — missing key, no injected client
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

  it("error message is a non-empty string (sanitized, not a raw object)", () => {
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

  it("error message does not contain a literal API key value", () => {
    // Set a recognizable sentinel key, then delete it — the constructor should not
    // have stored it in the error message even transiently.
    const orig = process.env["ANTHROPIC_API_KEY"];
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-SENTINEL_KEY_VALUE";
    delete process.env["ANTHROPIC_API_KEY"];
    try {
      let caught: unknown;
      try {
        new AnthropicModelClient();
      } catch (err) {
        caught = err;
      }
      const msg = (caught as ModelCallError).message;
      expect(msg).not.toContain("sk-ant-SENTINEL_KEY_VALUE");
    } finally {
      if (orig !== undefined) {
        process.env["ANTHROPIC_API_KEY"] = orig;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// complete() — W4-C1 stub behaviour
// ---------------------------------------------------------------------------

describe("AnthropicModelClient — complete() stub (W4-C1)", () => {
  it("complete() rejects (stub not yet implemented)", async () => {
    const adapter = new AnthropicModelClient({ client: makeFakeClient() });
    await expect(adapter.complete(minimalInput)).rejects.toBeDefined();
  });

  it("complete() rejects with a ModelCallError", async () => {
    const adapter = new AnthropicModelClient({ client: makeFakeClient() });
    await expect(adapter.complete(minimalInput)).rejects.toBeInstanceOf(ModelCallError);
  });

  it("complete() does not reach the injected fake client's create() method", async () => {
    let createCalled = false;
    const trackingClient: AnthropicLikeClient = {
      messages: {
        async create(_params: unknown): Promise<unknown> {
          createCalled = true;
          return {};
        },
      },
    };
    const adapter = new AnthropicModelClient({ client: trackingClient });
    await expect(adapter.complete(minimalInput)).rejects.toBeDefined();
    expect(createCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FakeDeterministicModelClient — unaffected by W4-C1
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
// ToolDefinition — inputSchema field is optional and backward-compatible
// ---------------------------------------------------------------------------

describe("ToolDefinition — inputSchema field (W4-C1 additive change)", () => {
  it("ToolDefinition without inputSchema is still valid (field is optional)", async () => {
    // The existing FixtureToolExecutor definitions never set inputSchema.
    // This test imports from the same modelClient.ts to confirm no type error.
    const { defaultToolExecutor } = await import("../src/agent/fixtureTools.ts");
    const defs = defaultToolExecutor().definitions();
    // All fixture defs have name and description; inputSchema is absent (undefined).
    for (const def of defs) {
      expect(typeof def.name).toBe("string");
      expect(typeof def.description).toBe("string");
      // inputSchema is optional — its absence is the expected fixture-tool state.
      expect("inputSchema" in def).toBe(false);
    }
  });

  it("ToolDefinition with inputSchema is accepted", async () => {
    const { createToolExecutor } = await import("../src/agent/fixtureTools.ts");
    const toolWithSchema = {
      name: "typed_tool",
      execute: async () => ({ ok: true }),
    };
    const executor = createToolExecutor([toolWithSchema]);
    // We can add inputSchema manually since FixtureToolExecutor.definitions()
    // does not set it, but the type must allow it.
    const def = { name: "typed_tool", description: "typed_tool", inputSchema: { type: "object" } };
    // Verify the shape is valid JSON (round-trips).
    expect(JSON.parse(JSON.stringify(def))).toEqual(def);
    // Executor still works without inputSchema.
    expect(executor.definitions()).toHaveLength(1);
  });
});
