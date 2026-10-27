import { KyselyGeneratorID } from "#/plugin/builtin/kysely-type/index";
import type { PluginManager } from "#/plugin/manager";

/**
 * Whether `.sql` queries type date/datetime/time values as Temporal objects,
 * following `kyselyTypePlugin`'s `temporal` option.
 * @param pluginManager - Configured plugins, if any
 * @returns The option, or false when the plugin is not configured
 */
export function sqlTemporal(pluginManager: PluginManager | undefined): boolean {
  return pluginManager?.getPluginConfig(KyselyGeneratorID)?.temporal ?? false;
}
