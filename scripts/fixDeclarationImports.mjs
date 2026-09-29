// tsc rewrites relative `.ts` import specifiers to `.js` in emitted JavaScript
// (rewriteRelativeImportExtensions) but leaves them as `.ts` in declaration
// files. Rewrite them in dist/**/*.d.ts so consumers resolve the declarations.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".d.ts")) {
      const source = readFileSync(path, "utf8");
      const fixed = source.replace(/(from\s+["']|import\(["'])(\.{1,2}\/[^"']+)\.ts(["'])/g, "$1$2.js$3");
      if (fixed !== source) writeFileSync(path, fixed);
    }
  }
}

walk(new URL("../dist", import.meta.url).pathname);
