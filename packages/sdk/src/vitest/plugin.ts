import { dirname, matchesGlob, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isBlockedModule, getBlockedMessage } from "./blocked-modules";
import type { Plugin, ResolvedConfig } from "vite";

const DEFAULT_TEST_INCLUDE = ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"];

// Matches static import/export declarations with string specifiers.
const IMPORT_RE = /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

/**
 * Vite plugin that blocks Node.js built-in module imports from production code.
 *
 * Uses the `transform` hook to scan non-test source files for `node:*` imports
 * and replaces them with code that throws a helpful error at runtime.
 * Vitest treats `node:*` as external SSR modules (skipping `resolveId`), so
 * source-level transformation is the only reliable interception point.
 * Other Node.js globals (`Buffer`, `global`, `setImmediate`) are removed by the environment.
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
      isTestFile = (id: string) => patterns.some((pattern) => matchesGlob(id, pattern));
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
 * Vite plugin that injects the setup file for the tailor-runtime environment.
 * @returns Vite plugin
 */
export function createSetupPlugin(): Plugin {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const setupPath = resolve(currentDir, "setup.mjs");

  return {
    name: "tailor-runtime-setup",

    config() {
      return {
        test: {
          setupFiles: [setupPath],
        },
      };
    },
  };
}

/**
 * Absolute path to the tailor-runtime environment module.
 * Vitest resolves paths starting with "/" directly as file paths.
 */
export const environmentPath: string = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "environment.mjs",
);
