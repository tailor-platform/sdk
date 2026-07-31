import { defineApplication, type Application } from "#/cli/services/application";
import { PluginManager } from "#/plugin/manager";
import { loadConfig, type LoadedConfig } from "./config-loader";
import { generateUserTypes } from "./type-generator";
import type { Plugin, TailorDBNamespaceData } from "#/plugin/types";

/**
 * Namespace selection for {@link loadTailorDBNamespaces}: explicit namespace
 * names, or a selector deriving them from the loaded config and its plugins.
 * Returning `undefined` (or omitting the option) loads all owned namespaces.
 */
export type TailorDBNamespaceSelector =
  | string[]
  | ((config: LoadedConfig, plugins: Plugin[]) => string[] | undefined);

/**
 * Options for {@link loadTailorDBNamespaces}.
 */
export interface LoadTailorDBNamespacesOptions {
  /** Path to tailor.config.ts. Defaults to searching from the current directory. */
  configPath?: string;
  /** Namespaces to load. Omit to load all owned namespaces. */
  namespaces?: TailorDBNamespaceSelector;
}

/**
 * Result of {@link loadTailorDBNamespaces}.
 */
export interface LoadedTailorDBNamespaces {
  /** The loaded Tailor config. */
  config: LoadedConfig;
  /** Plugins collected from the config module's plugin-array exports (typically `definePlugins()`). */
  plugins: Plugin[];
  /** Loaded TailorDB namespace data, in config order. */
  namespaces: TailorDBNamespaceData[];
}

/**
 * Result of {@link loadApplicationNamespaces}: the loaded namespaces plus the
 * config plugins and application they were loaded through.
 */
export interface LoadedApplicationNamespaces extends LoadedTailorDBNamespaces {
  /** Application defined from the loaded config. */
  application: Application;
}

/**
 * Load local TailorDB namespaces along with the config plugins and the
 * defined application. Internal superset of {@link loadTailorDBNamespaces}.
 * @param options - Namespace loading options.
 * @returns The loaded config, plugins, application, and TailorDB namespace data.
 */
export async function loadApplicationNamespaces(
  options: LoadTailorDBNamespacesOptions = {},
): Promise<LoadedApplicationNamespaces> {
  const { config, plugins } = await loadConfig(options.configPath);

  await generateUserTypes({ config, configPath: config.path });

  const pluginManager = plugins.length > 0 ? new PluginManager(plugins) : undefined;
  const application = defineApplication({
    config,
    pluginManager,
  });
  const namespaceNames =
    typeof options.namespaces === "function"
      ? options.namespaces(config, plugins)
      : options.namespaces;
  const namespaceFilter = namespaceNames ? new Set(namespaceNames) : undefined;
  const services = namespaceFilter
    ? application.tailorDBServices.filter((db) => namespaceFilter.has(db.namespace))
    : application.tailorDBServices;

  if (namespaceFilter && services.length !== namespaceFilter.size) {
    const found = new Set(services.map((db) => db.namespace));
    const missing = [...namespaceFilter].filter((ns) => !found.has(ns)).join(", ");
    const available = application.tailorDBServices.map((db) => db.namespace).join(", ");
    throw new Error(
      `TailorDB namespace "${missing}" not found in local config.db.` +
        (available ? ` Available owned namespaces: ${available}` : ""),
    );
  }

  const namespaces: TailorDBNamespaceData[] = [];

  for (const db of services) {
    await db.loadTypes();
    await db.processNamespacePlugins();
    namespaces.push({
      namespace: db.namespace,
      types: { ...db.types },
      sourceInfo: new Map(Object.entries(db.typeSourceInfo)),
      pluginAttachments: db.pluginAttachments,
    });
  }

  return { config, plugins, application, namespaces };
}

/**
 * Load local TailorDB namespaces exactly as SDK generation/deploy sees them:
 * the config is loaded, user types are generated, and each selected
 * namespace's types are loaded with namespace plugins applied.
 * @param options - Namespace loading options.
 * @returns The loaded config and TailorDB namespace data.
 */
export async function loadTailorDBNamespaces(
  options: LoadTailorDBNamespacesOptions = {},
): Promise<LoadedTailorDBNamespaces> {
  const { config, plugins, namespaces } = await loadApplicationNamespaces(options);
  return { config, plugins, namespaces };
}
