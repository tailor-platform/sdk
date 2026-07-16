import { loadTailorDBNamespaces } from "@tailor-platform/sdk/cli";
import type { LoadedConfig, TailorDBNamespaceData } from "@tailor-platform/sdk/cli";

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
  return await loadTailorDBNamespaces({
    configPath: options.configPath,
    namespaces: (config) =>
      resolveLocalErdSchemaNamespaces(config, {
        namespaces: options.namespaces,
        requireErdSite: options.requireErdSite,
      }),
  });
}
