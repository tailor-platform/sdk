import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFilter } from "vite";
import { isBlockedModule, getBlockedMessage } from "./blocked-modules";
import type { Plugin, ResolvedConfig } from "vite";

const DEFAULT_TEST_INCLUDE = ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"];

// Matches static import/export declarations with string specifiers.
// Captures: the full statement (for replacement) and the specifier.
const IMPORT_RE = /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

/**
 * Vite plugin that blocks Node.js built-in module imports from production code.
 *
 * Uses the `transform` hook to scan non-test source files for `node:*` imports
 * and replaces them with code that throws a helpful error at runtime.
 * Vitest treats `node:*` as external SSR modules (skipping `resolveId`), so
 * source-level transformation is the only reliable interception point.
 * Test file patterns are read from the resolved Vitest config (`test.include`).
 * @returns Vite plugin
 */
export function createBlockPlugin(): Plugin {
  let isTestFile: (id: string) => boolean = () => false;

  return {
    name: "tailor-runtime-block-node",
    enforce: "pre",

    configResolved(config: ResolvedConfig) {
      const testConfig = (config as ResolvedConfig & { test?: { include?: string[] } }).test;
      const patterns = testConfig?.include ?? DEFAULT_TEST_INCLUDE;
      const filter = createFilter(patterns);
      isTestFile = (id: string) => filter(id);
    },

    transform(code, id) {
      // Skip test files — they may freely use node:* modules
      if (isTestFile(id)) return undefined;
      // Skip node_modules
      if (id.includes("node_modules")) return undefined;

      let hasBlocked = false;
      const transformed = code.replace(IMPORT_RE, (match, specifier: string) => {
        if (isBlockedModule(specifier)) {
          hasBlocked = true;
          const message = getBlockedMessage(specifier).replace(/"/g, '\\"');
          return `throw new Error("${message}")`;
        }
        return match;
      });

      return hasBlocked ? { code: transformed, map: null } : undefined;
    },
  };
}

/**
 * Vite plugin that registers the tailor-runtime custom environment.
 *
 * Vitest resolves custom environments by looking for a package named
 * `vitest-environment-<name>`. This plugin aliases that resolution to
 * the environment module bundled within the SDK.
 * @returns Vite plugin
 */
export function createEnvironmentPlugin(): Plugin {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const environmentPath = resolve(currentDir, "environment.mjs");

  return {
    name: "tailor-runtime-environment",

    config() {
      return {
        resolve: {
          alias: {
            "vitest-environment-tailor-runtime": environmentPath,
          },
        },
      };
    },
  };
}
