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
 * Runs in the default phase (no `enforce: "pre"`) so esbuild's TypeScript
 * transform strips `import type` first; only runtime imports reach this hook.
 * Node.js globals not in the platform runtime are removed by the environment (whitelist-based).
 * Test file patterns are read from the resolved Vitest config (`test.include`).
 * @returns Vite plugin
 */
export function createBlockPlugin(): Plugin {
  let isTestFile: (id: string) => boolean = () => false;

  return {
    name: "tailor-runtime-block-node",

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

const ENVIRONMENT_NAME = "tailor-runtime";

/**
 * Vite plugin that resolves the tailor-runtime environment and injects setup files.
 *
 * Vitest resolves environments starting with "." or "/" as file paths.
 * This plugin rewrites `environment: "tailor-runtime"` to the absolute path
 * of the bundled environment module, both at the top-level and per-project.
 * It also injects the setup file that removes Vitest-dependent globals
 * (like `performance`) per-test via beforeEach/afterEach hooks.
 * @param options - Optional configuration
 * @param options.config - Path to tailor.config.ts to load SecretManager values into mock
 * @returns Vite plugin
 */
export function createEnvironmentPlugin(options?: { config?: string }): Plugin {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const environmentPath = resolve(currentDir, "environment.mjs");
  const setupPath = resolve(currentDir, "setup.mjs");

  return {
    name: "tailor-runtime-environment",

    config(config) {
      const testConfig = config.test as
        | (Record<string, unknown> & { projects?: Record<string, unknown>[] })
        | undefined;

      // Rewrite environment name to absolute path at top-level
      if (testConfig?.environment === ENVIRONMENT_NAME) {
        testConfig.environment = environmentPath;
      }

      // Rewrite in each project config
      if (testConfig?.projects) {
        for (const project of testConfig.projects) {
          const projectTest = project.test as Record<string, unknown> | undefined;
          if (projectTest?.environment === ENVIRONMENT_NAME) {
            projectTest.environment = environmentPath;
          }
        }
      }

      // Pass config path to setup.ts via env var (cross-process compatible)
      if (options?.config) {
        const configAbsPath = resolve(process.cwd(), options.config);
        process.env.__TAILOR_RUNTIME_CONFIG = configAbsPath;
      }

      return {
        test: {
          setupFiles: [setupPath],
        },
      };
    },
  };
}
