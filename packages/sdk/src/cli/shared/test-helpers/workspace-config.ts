import { toLoadedWorkspaceConfig, type LoadedWorkspaceConfig } from "#/cli/shared/config-loader";
import { internalError } from "#/cli/shared/errors";
import { parseConfigExport } from "#/parser/app-config/config-export";

/**
 * Parse the value of a `defineWorkspace()` or `defineApp()` call as the config loader does, without
 * a config file.
 * @param config - Value returned by `defineWorkspace()` or `defineApp()`
 * @param configPath - Path the loaded workspace reports as its config file
 * @returns The loaded workspace
 */
export function loadedWorkspace(
  config: unknown,
  configPath = "/project/tailor.config.ts",
): LoadedWorkspaceConfig {
  const parsed = parseConfigExport(config);
  if (!parsed.success || parsed.data.kind !== "workspace") {
    throw internalError("expected a valid workspace config");
  }
  return toLoadedWorkspaceConfig(parsed.data, configPath);
}

/**
 * Source of a config module whose default export carries the mark `defineWorkspace()` or
 * `defineApp()` gives it, for config files that cannot import those functions from the build.
 * @param kind - `"workspace-config"` for `defineWorkspace()`, `"app-config"` for `defineApp()`
 * @param source - Source of the object to export
 * @returns Source of the default export
 */
export function brandedDefault(kind: "workspace-config" | "app-config", source: string): string {
  return `export default Object.defineProperty(${source}, Symbol.for("tailor-platform/sdk"), { value: ${JSON.stringify(kind)} });`;
}
