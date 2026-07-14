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
 * `module.registerHooks` (synchronous hooks) isn't available on every
 * Node.js version this CLI still supports, so registration is skipped
 * silently where it's missing — the pre-existing tsx-only behavior applies.
 * @param hookUrl - URL of the tsconfig-paths-hook.mjs module.
 */
export async function registerTsconfigPathsHook(hookUrl: URL): Promise<void> {
  if (isNativeTypeScriptRuntime()) return;
  if (typeof mod.registerHooks !== "function") return;

  const { resolveSync } = (await import(hookUrl.href)) as {
    resolveSync: Parameters<typeof mod.registerHooks>[0]["resolve"];
  };
  mod.registerHooks({ resolve: resolveSync });
}
