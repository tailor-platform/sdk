import { defineApplication, type Application } from "#/cli/services/application";
import { PluginManager } from "#/plugin/manager";
import { loadConfig, type LoadedConfig } from "./config-loader";
import { CLIError } from "./errors";
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
 * Options for {@link loadConfigNamespaces}.
 */
export interface LoadConfigNamespacesOptions {
  /** Bundle each table's hook and validator scripts while loading. Defaults to `true`; turn it off when only the table definitions are read. */
  precompileScripts?: boolean;
}

/**
 * Result of {@link loadTailorDBNamespaces}.
 */
export interface LoadedTailorDBNamespaces {
  /** The loaded Tailor config. */
  config: LoadedConfig;
  /** Plugins from the config module's named `plugins` export (typically `definePlugins()`). */
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

  return loadConfigNamespaces(config, plugins, options.namespaces);
}

/**
 * Load local TailorDB namespaces of an already loaded config, without writing any generated
 * file.
 * @param config - Loaded config.
 * @param plugins - Plugins exported by the config.
 * @param selector - Namespaces to load. Omit to load all owned namespaces.
 * @param options - Loading options.
 * @returns The loaded config, plugins, application, and TailorDB namespace data.
 */
export async function loadConfigNamespaces(
  config: LoadedConfig,
  plugins: Plugin[],
  selector?: TailorDBNamespaceSelector,
  options: LoadConfigNamespacesOptions = {},
): Promise<LoadedApplicationNamespaces> {
  const pluginManager = plugins.length > 0 ? new PluginManager(plugins) : undefined;
  const application = defineApplication({
    config,
    pluginManager,
    precompileTailorDBScripts: options.precompileScripts,
  });
  const namespaceNames = typeof selector === "function" ? selector(config, plugins) : selector;
  const namespaceFilter = namespaceNames ? new Set(namespaceNames) : undefined;
  const services = namespaceFilter
    ? application.tailorDBServices.filter((db) => namespaceFilter.has(db.namespace))
    : application.tailorDBServices;

  if (namespaceFilter && services.length !== namespaceFilter.size) {
    const found = new Set(services.map((db) => db.namespace));
    const missing = [...namespaceFilter].filter((ns) => !found.has(ns));
    const available = application.tailorDBServices.map((db) => db.namespace);
    throw CLIError({
      code: "TAILORDB_NAMESPACE_NOT_FOUND",
      message:
        `TailorDB namespace "${missing.join(", ")}" not found in local config.db.` +
        (available.length > 0 ? ` Available owned namespaces: ${available.join(", ")}` : ""),
      context: { namespaces: missing, available },
    });
  }

  const namespaces: TailorDBNamespaceData[] = [];

  for (const db of services) {
    await db.loadTypes();
    await db.processNamespacePlugins();
    namespaces.push({
      namespace: db.namespace,
      tables: { ...db.types },
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
