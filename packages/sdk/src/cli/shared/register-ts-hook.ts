import * as mod from "node:module";
import { isNativeTypeScriptRuntime } from "./runtime";

export async function registerTsHook(tsHookUrl: URL): Promise<void> {
  if (isNativeTypeScriptRuntime()) return;
  const { resolveSync, loadSync } = (await import(tsHookUrl.href)) as {
    resolveSync: Parameters<typeof mod.registerHooks>[0]["resolve"];
    loadSync: Parameters<typeof mod.registerHooks>[0]["load"];
  };
  mod.registerHooks({ resolve: resolveSync, load: loadSync });
}
