import type { Signal } from "../types.ts";
import type { Inventory } from "../variants/inventory.ts";
import type { ParsedImport } from "./parse.ts";

const SDK_PREFIX = "@tailor-platform/sdk";

/** Known sub-paths the SDK exports. */
const KNOWN_SDK_SUBPATHS = new Set([
  "@tailor-platform/sdk",
  "@tailor-platform/sdk/cli",
  "@tailor-platform/sdk/test",
  "@tailor-platform/sdk/kysely",
  "@tailor-platform/sdk/plugin",
  "@tailor-platform/sdk/plugin/kysely-type",
  "@tailor-platform/sdk/plugin/enum-constants",
  "@tailor-platform/sdk/plugin/file-utils",
  "@tailor-platform/sdk/plugin/seed",
  "@tailor-platform/sdk/seed",
]);

export function checkImports(imports: ParsedImport[], inventory: Inventory): Signal[] {
  const out: Signal[] = [];

  for (const imp of imports) {
    if (!imp.path.startsWith(SDK_PREFIX)) continue;

    if (!KNOWN_SDK_SUBPATHS.has(imp.path)) {
      out.push({ type: "wrong_import_path", path: imp.path });
      continue;
    }

    if (imp.path !== SDK_PREFIX) continue;

    for (const name of imp.named) {
      if (!inventory.symbols.has(name)) {
        out.push({ type: "hallucinated_import", path: imp.path, symbol: name });
      }
    }
  }

  return out;
}
