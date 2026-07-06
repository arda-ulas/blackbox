// Deterministic fixture tools for the Blackbox agent loop.
//
// These tools never call any network, filesystem, or external service.
// Same input always produces the same output — essential for cassette replay.

import type { JsonValue, JsonObject } from "../trace/TraceTypes.ts";
import type { ToolDefinition, ToolExecutor } from "./modelClient.ts";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface FixtureTool {
  readonly name: string;
  execute(input: JsonValue): Promise<JsonValue>;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function asObject(input: JsonValue): JsonObject {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }
  return input as JsonObject;
}

function asString(v: JsonValue | undefined, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

const searchTool: FixtureTool = {
  name: "search",
  async execute(input) {
    const params = asObject(input);
    const query = asString(params["query"], "");
    return {
      results: [
        { title: `Fixture result A for "${query}"`, snippet: "First deterministic result." },
        { title: `Fixture result B for "${query}"`, snippet: "Second deterministic result." },
      ],
    };
  },
};

const calendarTool: FixtureTool = {
  name: "calendar",
  async execute(input) {
    const params = asObject(input);
    const date = asString(params["date"], "unknown");
    // Always returns the same three slots — deterministic regardless of date value.
    return {
      date,
      availableSlots: ["09:00", "14:00", "16:00"],
    };
  },
};

const bookingTool: FixtureTool = {
  name: "booking",
  async execute(input) {
    const params = asObject(input);
    const date = asString(params["date"], "");
    const time = asString(params["time"], "");
    const name = asString(params["name"], "guest");
    // Reference derived deterministically from input — same input → same reference.
    const datePart = date.replace(/-/g, "");
    const timePart = time.replace(":", "");
    const reference = `BK-${datePart}-${timePart}`;
    return { confirmed: true, reference, name };
  },
};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Returns the full default set of fixture tools. */
export function defaultFixtureTools(): FixtureTool[] {
  return [searchTool, calendarTool, bookingTool];
}

class FixtureToolExecutor implements ToolExecutor {
  private readonly tools: FixtureTool[];

  constructor(tools: FixtureTool[]) {
    this.tools = tools;
  }

  definitions(): ToolDefinition[] {
    // description mirrors name — matches the legacy agentLoop behaviour.
    return this.tools.map((t) => ({ name: t.name, description: t.name }));
  }

  async execute(name: string, input: JsonValue): Promise<JsonValue> {
    return executeTool(this.tools, name, input);
  }
}

/** Returns a ToolExecutor wrapping the full default set of fixture tools. */
export function defaultToolExecutor(): ToolExecutor {
  return new FixtureToolExecutor(defaultFixtureTools());
}

/** Wraps an arbitrary FixtureTool[] in a ToolExecutor. */
export function createToolExecutor(tools: FixtureTool[]): ToolExecutor {
  return new FixtureToolExecutor(tools);
}

/**
 * Execute the named tool from the given set.
 * Throws a descriptive error if the tool name is not found.
 */
export async function executeTool(
  tools: FixtureTool[],
  name: string,
  input: JsonValue,
): Promise<JsonValue> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    const known = tools.map((t) => `"${t.name}"`).join(", ");
    throw new Error(`Unknown fixture tool: "${name}". Known tools: ${known}`);
  }
  return tool.execute(input);
}
