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
