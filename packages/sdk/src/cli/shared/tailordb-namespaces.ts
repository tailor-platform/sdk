import * as path from "pathe";
import {
  createOwnedTailorDBService,
  defineApplication,
  type Application,
} from "#/cli/services/application";
import { PluginManager } from "#/plugin/manager";
import { extractOwnedNamespaces, normalizedDbOf } from "./config";
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

/**
 * Load TailorDB namespaces owned by a given tailor.config.ts.
 */
export type TailorDBNamespaceLoader = (
  configPath: string,
  namespaces?: string[],
) => Promise<TailorDBNamespaceData[]>;

/**
 * List the namespaces owned by a config.
 * @param config - Loaded config
 * @returns Namespace names in config order
 */
function ownedNamespacesOf(config: LoadedConfig): string[] {
  const owned = extractOwnedNamespaces(config);
  if (owned.length === 0) {
    throw CLIError({
      code: "TAILORDB_NAMESPACE_NOT_CONFIGURED",
      message: `${config.path} defines no owned TailorDB namespace.`,
    });
  }
  return owned;
}

interface LoadedNamespaceSource {
  config: LoadedConfig;
  pluginManager: PluginManager | undefined;
}

/**
 * Load one namespace a config owns, with that config's namespace plugins applied.
 * @param source - The owning config and its plugins
 * @param namespace - Namespace name in that config's `db`
 * @returns The namespace data
 */
async function loadNamespace(
  source: LoadedNamespaceSource,
  namespace: string,
): Promise<TailorDBNamespaceData> {
  const { config, pluginManager } = source;
  const dbEntries = normalizedDbOf(config);
  const entry = Object.hasOwn(dbEntries, namespace) ? dbEntries[namespace] : undefined;
  if (!entry) {
    throw CLIError({
      code: "TAILORDB_NAMESPACE_NOT_FOUND",
      message: `TailorDB namespace "${namespace}" not found in config.db of ${config.path}.`,
    });
  }
  if (!entry.owned) {
    throw CLIError({
      code: "TAILORDB_NAMESPACE_EXTERNAL",
      message: `TailorDB namespace "${namespace}" is external in ${config.path}. Point schemaFrom at the config that defines its tables.`,
    });
  }
  const baseDir = path.dirname(config.path);
  const db = createOwnedTailorDBService({
    namespace,
    serviceConfig: {
      ...entry.schemaSource.config,
      files: entry.schemaSource.config.files.map((pattern) => path.resolve(baseDir, pattern)),
    },
    baseDir,
    pluginManager,
  });
  await db.loadTypes();
  await db.processNamespacePlugins();
  return {
    namespace,
    tables: { ...db.types },
    sourceInfo: new Map(Object.entries(db.typeSourceInfo)),
    pluginAttachments: db.pluginAttachments,
  };
}

/**
 * Create a loader that reads TailorDB namespaces owned by other configs: the
 * namespace's tables are loaded from that config's `db` entry with that
 * config's namespace plugins applied. None of its generation hooks run.
 * @returns The namespace loader
 */
export function createTailorDBNamespaceLoader(): TailorDBNamespaceLoader {
  const configs = new Map<string, Promise<LoadedNamespaceSource>>();
  const namespaces = new Map<string, Promise<TailorDBNamespaceData>>();
  let previousLoad: Promise<unknown> = Promise.resolve();

  const loadConfigOnce = (configPath: string) => {
    let loaded = configs.get(configPath);
    if (!loaded) {
      loaded = loadConfig(configPath).then(({ config, plugins }) => ({
        config,
        pluginManager: plugins.length > 0 ? new PluginManager(plugins) : undefined,
      }));
      configs.set(configPath, loaded);
    }
    return loaded;
  };

  const loadNamespaceOnce = (source: LoadedNamespaceSource, namespace: string) => {
    const key = `${source.config.path}\0${namespace}`;
    let loaded = namespaces.get(key);
    if (!loaded) {
      loaded = previousLoad.then(() => loadNamespace(source, namespace));
      previousLoad = loaded.catch(() => undefined);
      namespaces.set(key, loaded);
    }
    return loaded;
  };

  return async (configPath, selected) => {
    const source = await loadConfigOnce(path.resolve(configPath));
    const loaded: TailorDBNamespaceData[] = [];
    for (const namespace of selected ?? ownedNamespacesOf(source.config)) {
      loaded.push(await loadNamespaceOnce(source, namespace));
    }
    return loaded;
  };
}
