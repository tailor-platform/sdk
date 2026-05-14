import fs from "node:fs";
import path from "node:path";

/**
 * Quantify how well the AI's code respects the SDK's canonical import path
 * conventions. The benchmark target — `@tailor-platform/sdk` — exports
 * sub-paths like `@tailor-platform/sdk/plugin/kysely-type` and
 * `@tailor-platform/sdk/vitest`. Common AI failures:
 *
 * - Inventing a peer package: `@tailor-platform/kysely-types` (plural).
 * - camelCase sub-paths: `@tailor-platform/sdk/plugin/kyselyType`.
 * - Reaching into internals: `@tailor-platform/sdk/dist/...`.
 *
 * `canonicalImportRatio` = `canonical` / `total` where:
 *   - `total` counts every `@tailor-platform/...` import.
 *   - `canonical` counts those whose specifier starts with the canonical
 *     prefix `@tailor-platform/sdk` AND is not under `dist/` (internal).
 *
 * Returns 1.0 when there are zero imports (nothing to violate) so the
 * metric is safe to average across problems where the agent didn't touch
 * any SDK import.
 */
export type CanonicalnessStats = {
  totalImports: number;
  canonicalImports: number;
  canonicalImportRatio: number;
};

const IMPORT_REGEX = /(?:import|from|require)\s*\(?\s*["']([^"']+)["']\s*\)?/g;

const CANONICAL_PREFIX = "@tailor-platform/sdk";

export function isCanonicalSdkImport(specifier: string): boolean {
  if (!specifier.startsWith("@tailor-platform/")) return true; // not an SDK import
  if (!specifier.startsWith(CANONICAL_PREFIX)) return false;
  // Reaching into dist/ or src/ counts as non-canonical (bypasses exports map)
  if (specifier.startsWith(`${CANONICAL_PREFIX}/dist/`)) return false;
  if (specifier.startsWith(`${CANONICAL_PREFIX}/src/`)) return false;
  // The bare specifier or any non-internal sub-path is canonical
  return true;
}

/** Apply the canonicalness heuristic to a single source file string. */
export function analyzeFileCanonicalness(source: string): {
  total: number;
  canonical: number;
} {
  let total = 0;
  let canonical = 0;
  IMPORT_REGEX.lastIndex = 0;
  for (let m = IMPORT_REGEX.exec(source); m !== null; m = IMPORT_REGEX.exec(source)) {
    const spec = m[1] ?? "";
    if (!spec.startsWith("@tailor-platform/")) continue;
    total += 1;
    if (isCanonicalSdkImport(spec)) canonical += 1;
  }
  return { total, canonical };
}

/**
 * Recursively scan a work directory for `.ts` / `.tsx` files (excluding
 * `node_modules`, `.sdk`, `dist`) and compute aggregate canonicalness.
 * Missing or unreadable directories return all zeros / ratio = 1.0.
 */
export function computeCanonicalnessStats(workDir: string): CanonicalnessStats {
  if (!fs.existsSync(workDir)) {
    return { totalImports: 0, canonicalImports: 0, canonicalImportRatio: 1.0 };
  }
  let totalImports = 0;
  let canonicalImports = 0;
  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (
          ent.name === "node_modules" ||
          ent.name === ".sdk" ||
          ent.name === "dist" ||
          ent.name === ".git"
        ) {
          continue;
        }
        visit(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!/\.(ts|tsx|mts|cts)$/.test(ent.name)) continue;
      try {
        const content = fs.readFileSync(full, "utf-8");
        const { total, canonical } = analyzeFileCanonicalness(content);
        totalImports += total;
        canonicalImports += canonical;
      } catch {
        // skip unreadable files
      }
    }
  };
  visit(workDir);
  const ratio = totalImports === 0 ? 1.0 : canonicalImports / totalImports;
  return { totalImports, canonicalImports, canonicalImportRatio: ratio };
}
