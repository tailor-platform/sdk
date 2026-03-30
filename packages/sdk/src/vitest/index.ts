import { createBlockPlugin, createEnvironmentPlugin } from "./plugin";
import type { Plugin } from "vite";

/**
 * Creates Vitest plugins that emulate the Tailor Platform function runtime environment.
 *
 * This sets up two things:
 * 1. **Node.js module blocking** - Imports of `node:*` modules throw errors with
 *    helpful suggestions for Web Standard API alternatives
 * 2. **Environment registration** - Registers the `tailor-runtime` custom Vitest
 *    environment so it can be used with `environment: "tailor-runtime"`
 * @example
 * ```typescript
 * // vitest.config.ts
 * import { defineConfig } from "vitest/config";
 * import { tailorRuntime } from "@tailor-platform/sdk/vitest";
 *
 * export default defineConfig({
 *   plugins: [tailorRuntime()],
 *   test: {
 *     environment: "tailor-runtime",
 *   },
 * });
 * ```
 * @returns Array of Vite plugins
 */
export function tailorRuntime(): Plugin[] {
  return [createBlockPlugin(), createEnvironmentPlugin()];
}

export { tailordbMock, workflowMock } from "./mock";
