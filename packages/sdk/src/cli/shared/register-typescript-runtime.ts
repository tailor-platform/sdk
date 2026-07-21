import { registerTsconfigPathsHook } from "./register-tsconfig-paths-hook";
import { isNativeTypeScriptRuntime } from "./runtime";

/**
 * Register TypeScript loading for the CLI: tsx for transformation, plus the
 * tsconfig `paths` alias resolve hook tsx's own cwd-scoped resolver misses.
 *
 * Shared by both the `tailor` binary entrypoint and the programmatic `./cli`
 * API entrypoint so the two registration steps can't drift apart.
 * @param hookUrl - URL of the tsconfig-paths-hook.mjs module, resolved by the
 * caller via its own `import.meta.url`. Bundling can move this shared module
 * to a different output location than tsconfig-paths-hook.mjs, so the URL
 * can't be resolved relative to this file — it must come from an entrypoint
 * whose bundled output path stays predictable.
 */
export async function registerTypeScriptRuntime(hookUrl: URL): Promise<void> {
  // Bun and Deno handle TypeScript natively, so registration is skipped.
  // tsx's own register() picks `module.registerHooks` on Node ≥ 24.11.1 / 25.1 / 26
  // (avoiding the DEP0205 deprecation) and falls back to `module.register` on older runtimes.
  if (!isNativeTypeScriptRuntime()) {
    const { register } = await import("tsx/esm/api");
    register();
  }
  await registerTsconfigPathsHook(hookUrl);
}
