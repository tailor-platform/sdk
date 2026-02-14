import type { NamespacePluginOutput, PluginBase, PluginOutput } from "@/parser/plugin-config/types";
import type { TailorAnyDBType } from "@/parser/service/tailordb/types";

// Cache: plugin -> sourceTypeName -> pluginConfigHash -> PluginOutput
const processCache = new WeakMap<PluginBase, Map<string, PluginOutput>>();

// Cache for namespace plugins: plugin -> pluginConfigHash -> NamespacePluginOutput
const namespaceProcessCache = new WeakMap<PluginBase, Map<string, NamespacePluginOutput>>();

/**
 * Options for getGeneratedType
 */
export interface GetGeneratedTypeOptions {
  /**
   * Plugin-level configuration passed via definePlugins().
   * If not provided, falls back to plugin.pluginConfig.
   */
  pluginConfig?: unknown;
  /**
   * Namespace where the type is being generated.
   * Required for plugins that use namespace in their processing logic.
   */
  namespace?: string;
}

/**
 * Get a generated type from a plugin.
 * For type-attached plugins, calls processType() with the sourceType.
 * For namespace plugins, calls processNamespace() with minimal context.
 * Results are cached per plugin and sourceType to avoid redundant processing.
 * @param plugin - The plugin instance
 * @param sourceType - The source TailorDB type (null for namespace plugins)
 * @param kind - The generated type kind (e.g., "request", "step")
 * @param options - Optional configuration including pluginConfig
 * @returns The generated TailorDB type
 */
export function getGeneratedType(
  plugin: PluginBase,
  sourceType: TailorAnyDBType | null,
  kind: string,
  options?: GetGeneratedTypeOptions,
): TailorAnyDBType {
  // Namespace plugin (sourceType is null)
  if (sourceType === null) {
    return getGeneratedTypeForNamespacePlugin(plugin, kind, options);
  }

  // Type-attached plugin
  return getGeneratedTypeForTypeAttachedPlugin(plugin, sourceType, kind, options);
}

/**
 * Generate a cache key that includes pluginConfig
 * @param baseKey - Base key for the cache
 * @param pluginConfig - Plugin configuration to include in the key
 * @returns Cache key string
 */
function getCacheKey(baseKey: string, pluginConfig: unknown): string {
  if (pluginConfig === undefined) {
    return baseKey;
  }
  try {
    return `${baseKey}:${JSON.stringify(pluginConfig)}`;
  } catch {
    // If pluginConfig is not serializable, use base key only
    return baseKey;
  }
}

/**
 * Get a generated type from a type-attached plugin.
 * @param plugin - The plugin instance (must have processType() method)
 * @param sourceType - The source TailorDB type
 * @param kind - The generated type kind
 * @param options - Optional configuration including pluginConfig
 * @returns The generated TailorDB type
 */
function getGeneratedTypeForTypeAttachedPlugin(
  plugin: PluginBase,
  sourceType: TailorAnyDBType,
  kind: string,
  options?: GetGeneratedTypeOptions,
): TailorAnyDBType {
  if (!plugin.processType) {
    throw new Error(`Plugin "${plugin.id}" does not have a processType() method`);
  }

  // Resolve options
  const resolvedPluginConfig = options?.pluginConfig ?? plugin.pluginConfig;
  const resolvedNamespace = options?.namespace ?? "";

  // Check cache first
  let pluginCache = processCache.get(plugin);
  if (!pluginCache) {
    pluginCache = new Map();
    processCache.set(plugin, pluginCache);
  }

  const cacheKey = getCacheKey(sourceType.name, resolvedPluginConfig);
  let output = pluginCache.get(cacheKey);

  if (!output) {
    // Call processType() and cache the result
    const typeConfig = sourceType.plugins?.find((p) => p.pluginId === plugin.id)?.config;
    const result = plugin.processType({
      type: sourceType,
      typeConfig: typeConfig ?? {},
      pluginConfig: resolvedPluginConfig,
      namespace: resolvedNamespace,
    });

    // Handle async case
    if (result instanceof Promise) {
      throw new Error(
        `Plugin "${plugin.id}" processType() returned a Promise. ` +
          `getGeneratedType requires synchronous processType().`,
      );
    }

    output = result;
    pluginCache.set(cacheKey, output);
  }

  const generatedType = output.types?.[kind];
  if (!generatedType) {
    throw new Error(
      `Generated type not found: plugin=${plugin.id}, sourceType=${sourceType.name}, kind=${kind}`,
    );
  }

  return generatedType as TailorAnyDBType;
}

/**
 * Get a generated type from a namespace plugin.
 * Calls processNamespace() to retrieve the generated type.
 * @param plugin - The plugin instance (must have processNamespace() method)
 * @param kind - The generated type kind
 * @param options - Optional configuration including pluginConfig
 * @returns The generated TailorDB type
 */
function getGeneratedTypeForNamespacePlugin(
  plugin: PluginBase,
  kind: string,
  options?: GetGeneratedTypeOptions,
): TailorAnyDBType {
  if (!plugin.processNamespace) {
    throw new Error(`Plugin "${plugin.id}" does not have a processNamespace() method`);
  }

  // Resolve options
  const resolvedPluginConfig = options?.pluginConfig ?? plugin.pluginConfig;
  const resolvedNamespace = options?.namespace ?? "";

  // Check cache first
  let pluginCache = namespaceProcessCache.get(plugin);
  if (!pluginCache) {
    pluginCache = new Map();
    namespaceProcessCache.set(plugin, pluginCache);
  }

  const cacheKey = getCacheKey("namespace", resolvedPluginConfig);
  let output = pluginCache.get(cacheKey);

  if (!output) {
    const result = plugin.processNamespace({
      pluginConfig: resolvedPluginConfig,
      namespace: resolvedNamespace,
    });

    // Handle async case (seed schema should use sync plugins)
    if (result instanceof Promise) {
      throw new Error(
        `Plugin "${plugin.id}" processNamespace() returned a Promise. ` +
          `getGeneratedType requires synchronous processNamespace().`,
      );
    }

    output = result;
    pluginCache.set(cacheKey, output);
  }

  const generatedType = output.types?.[kind];
  if (!generatedType) {
    throw new Error(`Generated type not found: plugin=${plugin.id}, kind=${kind}`);
  }

  return generatedType as TailorAnyDBType;
}
