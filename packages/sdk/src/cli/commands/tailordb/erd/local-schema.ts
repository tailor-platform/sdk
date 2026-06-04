import { defineApplication } from "@/cli/services/application";
import { loadConfig } from "@/cli/shared/config-loader";
import { generateUserTypes } from "@/cli/shared/type-generator";
import { PluginManager } from "@/plugin/manager";
import type { LoadedConfig } from "@/cli/shared/config-loader";
import type { TailorDBNamespaceData } from "@/types/plugin-generation";

export interface LoadLocalErdSchemaOptions {
  configPath?: string;
  namespaces?: string[];
  importNonce?: string;
}

export interface LocalErdSchemaContext {
  config: LoadedConfig;
  namespaces: TailorDBNamespaceData[];
}

/**
 * Load local TailorDB namespaces exactly as SDK generation/deploy sees them.
 * @param options - Local schema loading options.
 * @returns Loaded TailorDB namespace data.
 */
export async function loadLocalErdSchema(
  options: LoadLocalErdSchemaOptions,
): Promise<LocalErdSchemaContext> {
  const { config, plugins } = await loadConfig(options.configPath, {
    importNonce: options.importNonce,
  });

  await generateUserTypes({ config, configPath: config.path });

  const pluginManager = plugins.length > 0 ? new PluginManager(plugins) : undefined;
  const application = defineApplication({
    config,
    pluginManager,
    importNonce: options.importNonce,
  });
  const namespaceFilter = options.namespaces ? new Set(options.namespaces) : undefined;
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
