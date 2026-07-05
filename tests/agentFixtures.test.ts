import { describe, it, expect } from "vitest";
import {
  FakeDeterministicModelClient,
} from "../src/agent/modelClient.ts";
import type { ModelInput, ModelOutput } from "../src/agent/modelClient.ts";
import { defaultFixtureTools, executeTool } from "../src/agent/fixtureTools.ts";

// ---------------------------------------------------------------------------
// FakeDeterministicModelClient
// ---------------------------------------------------------------------------

describe("FakeDeterministicModelClient", () => {
  const input: ModelInput = { messages: [{ role: "user", content: "hello" }] };

  it("returns deterministic output for the same input across independent instances", async () => {
    const script: ModelOutput[] = [{ type: "final_answer", text: "Hi there" }];
    const a = new FakeDeterministicModelClient(script);
    const b = new FakeDeterministicModelClient(script);
    expect(await a.complete(input)).toEqual(await b.complete(input));
  });

  it("returns a tool-call-shaped output when scripted", async () => {
    const client = new FakeDeterministicModelClient([
      { type: "tool_call", toolName: "search", toolInput: { query: "test" } },
    ]);
    const output = await client.complete(input);
    expect(output.type).toBe("tool_call");
    if (output.type === "tool_call") {
      expect(output.toolName).toBe("search");
      expect(output.toolInput).toEqual({ query: "test" });
    }
  });

  it("returns a final-answer-shaped output when scripted", async () => {
    const client = new FakeDeterministicModelClient([
      { type: "final_answer", text: "Done." },
    ]);
    const output = await client.complete(input);
    expect(output.type).toBe("final_answer");
    if (output.type === "final_answer") {
      expect(output.text).toBe("Done.");
    }
  });

  it("throws clearly when called beyond the scripted response count", async () => {
    const client = new FakeDeterministicModelClient([
      { type: "final_answer", text: "only one" },
    ]);
    await client.complete(input); // call 0 — OK
    await expect(client.complete(input)).rejects.toThrow(
      "no scripted response for call index 1",
    );
  });

  it("tracks how many calls have been made", async () => {
    const client = new FakeDeterministicModelClient([
      { type: "final_answer", text: "a" },
      { type: "final_answer", text: "b" },
    ]);
    expect(client.callsMade()).toBe(0);
    await client.complete(input);
    expect(client.callsMade()).toBe(1);
    await client.complete(input);
    expect(client.callsMade()).toBe(2);
  });

  it("does not expose scripted response internals to caller mutation", async () => {
    const script: ModelOutput[] = [
      { type: "tool_call", toolName: "search", toolInput: { query: "original" } },
    ];
    const client = new FakeDeterministicModelClient(script);
    const output = await client.complete(input);

    // Mutate the returned output.
    if (output.type === "tool_call") {
      (output.toolInput as { query: string }).query = "mutated";
    }

    // The original script array should be unaffected.
    expect(
      (script[0] as { toolInput: { query: string } }).toolInput.query,
    ).toBe("original");
  });
});

// ---------------------------------------------------------------------------
// Fixture tools
// ---------------------------------------------------------------------------

describe("fixture tools — search", () => {
  it("returns deterministic results for the same query", async () => {
    const tools = defaultFixtureTools();
    const a = await executeTool(tools, "search", { query: "hotels" });
    const b = await executeTool(tools, "search", { query: "hotels" });
    expect(a).toEqual(b);
  });

  it("reflects the query in the result titles", async () => {
    const tools = defaultFixtureTools();
    const result = await executeTool(tools, "search", { query: "flights" });
    const titles = (result as { results: { title: string }[] }).results.map(
      (r) => r.title,
    );
    expect(titles.every((t) => t.includes("flights"))).toBe(true);
  });
});

describe("fixture tools — calendar", () => {
  it("returns deterministic slots for the same date", async () => {
    const tools = defaultFixtureTools();
    const a = await executeTool(tools, "calendar", { date: "2024-03-01" });
    const b = await executeTool(tools, "calendar", { date: "2024-03-01" });
    expect(a).toEqual(b);
  });

  it("includes the requested date in the response", async () => {
    const tools = defaultFixtureTools();
    const result = await executeTool(tools, "calendar", { date: "2024-06-15" });
    expect((result as { date: string }).date).toBe("2024-06-15");
  });
});

describe("fixture tools — booking", () => {
  it("returns a deterministic reference for the same input", async () => {
    const tools = defaultFixtureTools();
    const booking = { date: "2024-03-01", time: "09:00", name: "Alice" };
    const a = await executeTool(tools, "booking", booking);
    const b = await executeTool(tools, "booking", booking);
    expect(a).toEqual(b);
  });

  it("returns confirmed: true", async () => {
    const tools = defaultFixtureTools();
    const result = await executeTool(tools, "booking", {
      date: "2024-03-01",
      time: "14:00",
      name: "Bob",
    });
    expect((result as { confirmed: boolean }).confirmed).toBe(true);
  });
});

describe("fixture tools — error handling", () => {
  it("throws clearly for an unknown tool name via executeTool", async () => {
    const tools = defaultFixtureTools();
    await expect(executeTool(tools, "nonexistent", {})).rejects.toThrow(
      'Unknown fixture tool: "nonexistent"',
    );
  });

  it("does not mutate the caller-provided input object", async () => {
    const tools = defaultFixtureTools();
    const input = { query: "hotels" };
    const before = JSON.stringify(input);
    await executeTool(tools, "search", input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
