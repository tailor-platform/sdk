import { createBlockPlugin, createSetupPlugin, environmentPath } from "./plugin";
import type { Plugin } from "vite";

/**
 * Creates Vitest plugins that emulate the Tailor Platform function runtime environment.
 *
 * ## What it does
 * 1. **Node.js module blocking** (transform hook) — Imports of `node:*` modules
 *    (and bare builtins like `crypto`, `fs`) in non-test source files are replaced
 *    with code that throws an error with a suggestion for the Web Standard API alternative.
 *    Test files (`*.test.ts`, `*.spec.ts`) are exempt and can use `node:*` freely.
 * 2. **Node.js globals removal** (environment) — Non-whitelisted globals are removed
 *    from `globalThis`. Only ECMAScript standard, Web Standard APIs, and platform mocks remain.
 * 3. **Platform API mocks** (environment) — `globalThis.tailordb`, `globalThis.tailor`,
 *    `TailorErrors`, `TailorErrorMessage`, `TailorDBFileError` are auto-injected.
 *    Use `tailordbMock` and `workflowMock` to configure mock responses.
 * 4. **Setup file** (auto-injected) — Removes Vitest-dependent globals (`performance`)
 *    per-test via `beforeEach`/`afterEach`.
 *
 * ## Known limitations
 * - **`process`** is NOT removed or blocked. Vitest's internal runner depends on it.
 * - **`require`** is NOT blocked for the same reason.
 * - **Dynamic `import()`** of bundled files bypasses the transform hook.
 * @example
 * ```typescript
 * // vitest.config.ts
 * import { defineConfig } from "vitest/config";
 * import { tailorRuntime, tailorRuntimeEnvironment } from "@tailor-platform/sdk/vitest";
 *
 * export default defineConfig({
 *   plugins: [tailorRuntime()],
 *   test: {
 *     environment: tailorRuntimeEnvironment,
 *   },
 * });
 * ```
 * @returns Array of Vite plugins
 */
export function tailorRuntime(): Plugin[] {
  return [createBlockPlugin(), createSetupPlugin()];
}

/**
 * Path to the tailor-runtime Vitest environment module.
 * Pass this to `test.environment` in your Vitest config.
 */
export const tailorRuntimeEnvironment: string = environmentPath;

export { tailordbMock, workflowMock } from "./mock";
