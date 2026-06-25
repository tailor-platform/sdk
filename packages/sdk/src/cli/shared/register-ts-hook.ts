import { isNativeTypeScriptRuntime } from "./runtime";

// registerHooks is available since Node 22.15.0; fall back to register() on older versions.
export async function registerTsHook(tsHookUrl: URL): Promise<void> {
  if (isNativeTypeScriptRuntime()) return;
  const mod = await import("node:module");
  const registerHooks = (mod as unknown as Record<string, unknown>).registerHooks as
    | ((opts: { resolve?: unknown; load?: unknown }) => void)
    | undefined;
  if (registerHooks) {
    const { resolveSync, loadSync } = (await import(tsHookUrl.href)) as {
      resolveSync: (...args: unknown[]) => unknown;
      loadSync: (...args: unknown[]) => unknown;
    };
    registerHooks({ resolve: resolveSync, load: loadSync });
  } else {
    mod.register(tsHookUrl, import.meta.url);
  }
}
