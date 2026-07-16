import * as mod from "node:module";
import { isNativeTypeScriptRuntime } from "./runtime";

/**
 * Register the tsconfig `paths` alias resolve hook alongside tsx.
 *
 * tsx's own tsconfig-paths support is scoped to the tsconfig discovered from
 * where tsx was registered, so a project-local alias in a dynamically
 * imported user file (resolver, executor, workflow, TailorDB type) can fail
 * to resolve when the importing file lives outside that directory. This
 * hook activates only when tsx's own resolution throws (a fallback, not an
 * override): it then re-derives `paths` from each importing file's own
 * directory, without touching TypeScript transformation (left to tsx).
 *
 * Uses `module.register()` rather than `module.registerHooks()`: chaining
 * another `register()` loader after tsx's composes correctly regardless of
 * which of the two internal registration APIs tsx itself picks (it varies
 * by Node.js version).
 * @param hookUrl - URL of the tsconfig-paths-hook.mjs module.
 */
export async function registerTsconfigPathsHook(hookUrl: URL): Promise<void> {
  if (isNativeTypeScriptRuntime()) return;
  if (typeof mod.register !== "function") return;

  mod.register(hookUrl);
}
