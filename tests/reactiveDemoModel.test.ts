// Unit tests for the reactive deterministic demo-continuation model (W7-A).
// Fully offline, pure, zero live calls. Proves the five-rule table, determinism,
// input non-mutation, and that the client always returns final_answer.

import { describe, it, expect } from "vitest";
import { ReactiveDemoModelClient } from "../src/agent/reactiveDemoModel.ts";
import type { Message, ModelInput } from "../src/agent/modelClient.ts";
import type { JsonValue } from "../src/trace/TraceTypes.ts";

// ---------------------------------------------------------------------------
// Transcript builders
// ---------------------------------------------------------------------------

/** A transcript whose latest tool round carries a result-variant tool_result. */
function withToolResult(result: JsonValue, toolName = "search"): ModelInput {
  const messages: Message[] = [
    { role: "user", content: "Book a hotel for Alice this weekend." },
    {
      role: "assistant",
      content: [{ type: "tool_use", toolCallId: "call-0", toolName, toolInput: { query: "hotels" } }],
    },
    {
      role: "user",
      content: [{ type: "tool_result", toolCallId: "call-0", toolName, result }],
    },
  ];
  return { messages };
}

/** A transcript whose latest tool round carries an error-variant tool_result. */
function withToolError(error: string, toolName = "search"): ModelInput {
  const messages: Message[] = [
    { role: "user", content: "Book a hotel for Alice this weekend." },
    {
      role: "assistant",
      content: [{ type: "tool_use", toolCallId: "call-0", toolName, toolInput: { query: "hotels" } }],
    },
    {
      role: "user",
      content: [{ type: "tool_result", toolCallId: "call-0", toolName, error }],
    },
  ];
  return { messages };
}

/** A prompt-only transcript with no tool_result (the prompt-mode fork shape). */
function promptOnly(text: string): ModelInput {
  return { messages: [{ role: "user", content: text }] };
}

const model = new ReactiveDemoModelClient();

async function answer(input: ModelInput): Promise<string> {
  const out = await model.complete(input);
  expect(out.type).toBe("final_answer");
  return (out as { type: "final_answer"; text: string }).text;
}

// ---------------------------------------------------------------------------
// Rule 2 — no availability (embeds the payload message)
// ---------------------------------------------------------------------------

describe("ReactiveDemoModelClient — rule 2 (no availability)", () => {
  it("available:false / empty results → embeds the payload message", async () => {
    const text = await answer(
      withToolResult({ results: [], available: false, message: "No hotels available for that date." }),
    );
    expect(text).toContain("No hotels available for that date.");
    expect(text).toContain("no options are available");
  });

  it("a different message → a different answer (derivation is visible)", async () => {
    const a = await answer(
      withToolResult({ results: [], available: false, message: "No hotels available for that date." }),
    );
    const b = await answer(
      withToolResult({ results: [], available: false, message: "Fully booked in that city." }),
    );
    expect(a).not.toEqual(b);
    expect(b).toContain("Fully booked in that city.");
  });

  it("empty results with no available flag → still an unavailable answer", async () => {
    const text = await answer(withToolResult({ results: [] }));
    expect(text).toContain("no options are available");
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — availability
// ---------------------------------------------------------------------------

describe("ReactiveDemoModelClient — rule 3 (availability)", () => {
  it("non-empty results → availability answer embedding a payload field", async () => {
    const text = await answer(
      withToolResult({ results: [{ title: "Grand Hotel" }, { title: "Seaside Inn" }], available: true }),
    );
    expect(text).toContain("2 option(s) are available");
    expect(text).toContain("Grand Hotel");
  });

  it("differs from a rule-2 unavailable answer", async () => {
    const avail = await answer(withToolResult({ results: [{ title: "Grand Hotel" }] }));
    const none = await answer(withToolResult({ results: [], available: false, message: "none" }));
    expect(avail).not.toEqual(none);
  });
});

// ---------------------------------------------------------------------------
// Rule 1 — error variant
// ---------------------------------------------------------------------------

describe("ReactiveDemoModelClient — rule 1 (error)", () => {
  it("error-variant tool_result → answer names the tool and embeds the error", async () => {
    const text = await answer(withToolError("upstream timeout", "search"));
    expect(text).toContain("search");
    expect(text).toContain("upstream timeout");
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — no tool_result (prompt-derived fallback)
// ---------------------------------------------------------------------------

describe("ReactiveDemoModelClient — rule 4 (no tool_result)", () => {
  it("no tool_result in transcript → deterministic prompt-derived answer", async () => {
    const text = await answer(promptOnly("Try a different city instead"));
    expect(text).toContain("Try a different city instead");
    expect(text).not.toContain("no options are available"); // not a rule-2 answer
  });

  it("empty transcript → deterministic no-op answer, does not throw", async () => {
    const text = await answer({ messages: [] });
    expect(text.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — unrecognized shape
// ---------------------------------------------------------------------------

describe("ReactiveDemoModelClient — rule 5 (unrecognized shape)", () => {
  it("object without results/available → deterministic fallback, does not throw", async () => {
    const text = await answer(withToolResult({ confirmed: true, reference: "BK-1" }, "booking"));
    expect(text).toContain("booking");
    expect(text).toContain("unrecognized result shape");
  });

  it("non-object result → deterministic fallback, does not throw", async () => {
    const text = await answer(withToolResult("just a string", "search"));
    expect(text).toContain("unrecognized result shape");
  });
});

// ---------------------------------------------------------------------------
// Determinism, purity, and output type
// ---------------------------------------------------------------------------

describe("ReactiveDemoModelClient — determinism & purity", () => {
  it("identical input twice → identical output", async () => {
    const input = withToolResult({ results: [], available: false, message: "No hotels available for that date." });
    const a = await answer(input);
    const b = await answer(input);
    expect(a).toEqual(b);
  });

  it("does not mutate its input object", async () => {
    const input = withToolResult({ results: [], available: false, message: "No hotels available for that date." });
    const snapshot = structuredClone(input);
    await model.complete(input);
    expect(input).toEqual(snapshot);
  });

  it("always returns final_answer, never tool_call", async () => {
    const inputs: ModelInput[] = [
      withToolResult({ results: [], available: false, message: "x" }),
      withToolResult({ results: [{ title: "A" }] }),
      withToolError("boom"),
      promptOnly("hello"),
      withToolResult("scalar"),
    ];
    for (const input of inputs) {
      const out = await model.complete(input);
      expect(out.type).toBe("final_answer");
    }
  });
});
