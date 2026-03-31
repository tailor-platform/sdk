import { createBlockPlugin, createEnvironmentPlugin } from "./plugin";
import type { Plugin } from "vite";

/**
 * Creates Vitest plugins that emulate the Tailor Platform function runtime environment.
 *
 * ## What it does
 *
 * 1. **Node.js module blocking** (transform hook) — Imports of `node:*` modules
 *    (and bare builtins like `crypto`, `fs`) in non-test source files are replaced
 *    with code that throws an error with a suggestion for the Web Standard API alternative.
 *    Test files are exempt and can use `node:*` freely. Test file patterns are read
 *    from the resolved Vitest config (`test.include`).
 *
 * 2. **Node.js globals removal** (environment + setup) — Only globals available in the
 *    Tailor Platform runtime are kept (whitelist: ECMAScript standard, Web Standard APIs
 *    from bootstrap.js, platform mocks). All others (`Buffer`, `global`, `setImmediate`,
 *    `__dirname`, `__filename`, etc.) are removed. `performance` is removed per-test
 *    via beforeEach/afterEach since Vitest needs it during initialization.
 *
 * 3. **Platform API mocks** (environment) — `globalThis.tailordb`, `globalThis.tailor`,
 *    `TailorErrors`, `TailorErrorMessage`, `TailorDBFileError` are auto-injected.
 *    Use `tailordbMock` and `workflowMock` to configure mock responses.
 *
 * 4. **Environment resolution** — Rewrites `environment: "tailor-runtime"` to the
 *    absolute path of the bundled environment module via the config hook.
 *
 * ## Known limitations
 *
 * - **`process`** and **`require`** are NOT removed or blocked. Vitest's internal
 *   runner depends on them. On the real Tailor Platform runtime, they do not exist.
 * - **Dynamic `import()`** of bundled files (via `createImportMain()`) bypasses
 *   the transform hook since those files are loaded through Node.js native loader.
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
