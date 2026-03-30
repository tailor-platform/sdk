import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isBlockedModule, getBlockedMessage } from "./blocked-modules";
import type { Plugin } from "vite";

const VIRTUAL_PREFIX = "\0tailor-blocked:";

/**
 * Vite plugin that blocks Node.js built-in module imports.
 *
 * When a test file imports a `node:*` module (or bare Node.js builtin),
 * the import is resolved to a virtual module that throws an error at runtime
 * with a helpful message suggesting the Web Standard API alternative.
 * @returns Vite plugin
 */
export function createBlockPlugin(): Plugin {
  return {
    name: "tailor-runtime-block-node",
    enforce: "pre",

    resolveId(source) {
      if (isBlockedModule(source)) {
        return `${VIRTUAL_PREFIX}${source}`;
      }
      return undefined;
    },

    load(id) {
      if (id.startsWith(VIRTUAL_PREFIX)) {
        const specifier = id.slice(VIRTUAL_PREFIX.length);
        const message = getBlockedMessage(specifier).replace(/"/g, '\\"');
        return `throw new Error("${message}");`;
      }
      return undefined;
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
