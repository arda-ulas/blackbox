// The docs site's CLI reference is generated from the help table; this fails
// when a command's help changes without regenerating docs/cli.md.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderCliReference } from "../scripts/cliReference.ts";

describe("docs/cli.md", () => {
  it("matches the CLI help table (regenerate with: npx tsx scripts/cliReference.ts)", () => {
    expect(readFileSync(new URL("../docs/cli.md", import.meta.url), "utf8")).toBe(renderCliReference());
  });
});
