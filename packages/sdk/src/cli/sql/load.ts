import { assertUniqueLocalTailorDBTypeNames } from "#/cli/services/tailordb/type-name-validation";
import { loadConfigNamespaces } from "#/cli/shared/tailordb-namespaces";
import { KyselyGeneratorID } from "#/plugin/builtin/kysely-type/index";
import { resolvePluginConfig } from "#/plugin/get-plugin-config";
import { sqlDefinitionsOf, type SqlBundleContext, type SqlContextLoader } from "./definitions";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { Plugin, TailorDBNamespaceData } from "#/plugin/types";
import type { SqlDefinitions } from "#/utils/sql/analyze";

/**
 * Load the TailorDB tables of a loaded config the way deploy does, without
 * writing generated files.
 * @param config - Loaded config
 * @param plugins - Plugins exported by the config
 * @returns The loaded namespaces and the definitions `.sql` files are checked against
 */
export async function loadSqlDefinitions(
  config: LoadedConfig,
  plugins: Plugin[],
): Promise<{ namespaces: TailorDBNamespaceData[]; definitions: SqlDefinitions }> {
  const { application, namespaces } = await loadConfigNamespaces(config, plugins);
  assertUniqueLocalTailorDBTypeNames({ tailorDBServices: application.tailorDBServices });
  const temporal = resolvePluginConfig(plugins, KyselyGeneratorID)?.temporal ?? false;
  return { namespaces, definitions: sqlDefinitionsOf(namespaces, temporal) };
}

/**
 * Create a loader that reads the definitions for bundling once, on the first `.sql` import.
 * @param config - Loaded config
 * @param plugins - Plugins exported by the config
 * @returns The loader
 */
export function sqlContextLoaderFor(config: LoadedConfig, plugins: Plugin[]): SqlContextLoader {
  let pending: Promise<SqlBundleContext> | undefined;
  return () =>
    (pending ??= loadSqlDefinitions(config, plugins).then(({ definitions }) => ({
      definitions,
      dependencies: [],
    })));
}
