import { defineApplication } from "#/cli/services/application";
import { assertUniqueLocalTailorDBTypeNames } from "#/cli/services/tailordb/type-name-validation";
import { PluginManager } from "#/plugin/manager";
import { sqlDefinitionsOf, type SqlBundleContext, type SqlContextLoader } from "./definitions";
import { sqlTemporal } from "./temporal";
import type { TailorDBService } from "#/cli/services/tailordb/service";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { Plugin } from "#/plugin/types";
import type { SqlDefinitions } from "#/utils/sql/analyze";

/**
 * Load the TailorDB tables of a loaded config the way deploy does, without
 * writing generated files.
 * @param config - Loaded config
 * @param plugins - Plugins exported by the config
 * @returns The loaded services and the definitions `.sql` files are checked against
 */
export async function loadSqlDefinitions(
  config: LoadedConfig,
  plugins: readonly Plugin[],
): Promise<{ services: readonly TailorDBService[]; definitions: SqlDefinitions }> {
  const pluginManager = plugins.length > 0 ? new PluginManager([...plugins]) : undefined;
  const { tailorDBServices } = defineApplication({ config, pluginManager });
  for (const service of tailorDBServices) {
    await service.loadTypes();
    await service.processNamespacePlugins();
  }
  assertUniqueLocalTailorDBTypeNames({ tailorDBServices });
  return {
    services: tailorDBServices,
    definitions: sqlDefinitionsOf(tailorDBServices, sqlTemporal(pluginManager)),
  };
}

/**
 * Create a loader that reads the definitions for bundling once, on the first `.sql` import.
 * @param config - Loaded config
 * @param plugins - Plugins exported by the config
 * @returns The loader
 */
export function sqlContextLoaderFor(
  config: LoadedConfig,
  plugins: readonly Plugin[],
): SqlContextLoader {
  let pending: Promise<SqlBundleContext> | undefined;
  return () =>
    (pending ??= loadSqlDefinitions(config, plugins).then(({ definitions }) => ({
      definitions,
      dependencies: [],
    })));
}
