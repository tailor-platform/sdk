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
 *    Test files (`*.test.ts`, `*.spec.ts`) are exempt and can use `node:*` freely.
 *
 * 2. **Node.js globals removal** (environment) — `Buffer`, `global`, `setImmediate`,
 *    `clearImmediate`, `__dirname`, `__filename` are removed from `globalThis`.
 *
 * 3. **Platform API mocks** (environment) — `globalThis.tailordb`, `globalThis.tailor`,
 *    `TailorErrors`, `TailorErrorMessage`, `TailorDBFileError` are auto-injected.
 *    Use `tailordbMock` and `workflowMock` to configure mock responses.
 *
 * 4. **Environment registration** — Registers `tailor-runtime` as a custom Vitest environment.
 *
 * ## Known limitations
 *
 * - **`process`** is NOT removed or blocked. Vitest's internal runner depends on it
 *   (`process.env`, `process.cwd()`, etc.), so removing it breaks Vitest itself.
 *   On the real Tailor Platform runtime, `process` does not exist.
 * - **`require`** is NOT blocked for the same reason.
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
