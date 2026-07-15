import * as mod from "node:module";
import { isNativeTypeScriptRuntime } from "./runtime";

/**
 * Register the tsconfig `paths` alias resolve hook alongside tsx.
 *
 * tsx's own tsconfig-paths support is scoped to the tsconfig discovered from
 * where tsx was registered, so a project-local alias in a dynamically
 * imported user file (resolver, executor, workflow, TailorDB type) can fail
 * to resolve, or resolve against an unrelated project's tsconfig. This hook
 * re-derives `paths` from each importing file's own directory as a resolve
 * fallback, without touching TypeScript transformation (left to tsx).
 *
 * Uses `module.register()` rather than `module.registerHooks()`: tsx itself
 * picks between the two APIs depending on the Node.js version, and a
 * `registerHooks()`-registered hook never gets a chance to run when tsx's
 * own hook was registered via `register()` — chaining another `register()`
 * loader after tsx's is the combination that composes correctly regardless
 * of which API tsx picked.
 * @param hookUrl - URL of the tsconfig-paths-hook.mjs module.
 */
export async function registerTsconfigPathsHook(hookUrl: URL): Promise<void> {
  if (isNativeTypeScriptRuntime()) return;
  if (typeof mod.register !== "function") return;

  mod.register(hookUrl);
}
