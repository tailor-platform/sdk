import { defineApplication } from "@/cli/services/application";
import { loadConfig } from "@/cli/shared/config-loader";
import { generateUserTypes } from "@/cli/shared/type-generator";
import { PluginManager } from "@/plugin/manager";
import type { LoadedConfig } from "@/cli/shared/config-loader";
import type { TailorDBNamespaceData } from "@/plugin/types";

export interface LoadLocalErdSchemaOptions {
  configPath?: string;
  namespaces?: string[];
  requireErdSite?: boolean;
}

export interface LocalErdSchemaContext {
  config: LoadedConfig;
  namespaces: TailorDBNamespaceData[];
}

export interface ResolveLocalErdSchemaNamespacesOptions {
  /** Explicit namespace selection. */
  namespaces?: string[];
  /** Limit implicit selection to owned namespaces with erdSite configured. */
  requireErdSite?: boolean;
}

/**
 * Resolve TailorDB namespaces that need local type loading for ERD generation.
 * @param config - Loaded Tailor config.
 * @param options - Namespace selection options.
 * @returns Namespace names to load, or undefined to load all owned namespaces.
 */
export function resolveLocalErdSchemaNamespaces(
  config: LoadedConfig,
  options: ResolveLocalErdSchemaNamespacesOptions,
): string[] | undefined {
  if (options.namespaces) {
    return options.namespaces;
  }
  if (!options.requireErdSite) {
    return undefined;
  }

  return Object.entries(config.db ?? {}).flatMap(([namespace, dbConfig]) =>
    "external" in dbConfig || !dbConfig.erdSite ? [] : [namespace],
  );
}

/**
 * Load local TailorDB namespaces exactly as SDK generation/deploy sees them.
 * @param options - Local schema loading options.
 * @returns Loaded TailorDB namespace data.
 */
export async function loadLocalErdSchema(
  options: LoadLocalErdSchemaOptions,
): Promise<LocalErdSchemaContext> {
  const { config, plugins } = await loadConfig(options.configPath);

  await generateUserTypes({ config, configPath: config.path });

  const pluginManager = plugins.length > 0 ? new PluginManager(plugins) : undefined;
  const application = defineApplication({
    config,
    pluginManager,
  });
  const namespaceNames = resolveLocalErdSchemaNamespaces(config, {
    namespaces: options.namespaces,
    requireErdSite: options.requireErdSite,
  });
  const namespaceFilter = namespaceNames ? new Set(namespaceNames) : undefined;
  const services = namespaceFilter
    ? application.tailorDBServices.filter((db) => namespaceFilter.has(db.namespace))
    : application.tailorDBServices;

  if (namespaceFilter && services.length !== namespaceFilter.size) {
    const available = application.tailorDBServices.map((db) => db.namespace).join(", ");
    const requested = [...namespaceFilter].join(", ");
    throw new Error(
      `TailorDB namespace "${requested}" not found in local config.db.` +
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

  return { config, namespaces };
}
