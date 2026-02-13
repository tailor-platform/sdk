import type {
  NamespacePluginOutput,
  PluginBase,
  PluginOutput,
  TailorAnyDBType,
} from "@/parser/plugin-config/types";

// Cache: plugin -> sourceTypeName -> PluginOutput
const processCache = new WeakMap<PluginBase, Map<string, PluginOutput>>();

// Cache for namespace plugins: plugin -> NamespacePluginOutput
const namespaceProcessCache = new WeakMap<PluginBase, NamespacePluginOutput>();

/**
 * Get a generated type from a plugin.
 * For type-attached plugins, calls process() with the sourceType.
 * For namespace plugins, calls processNamespace() with minimal context.
 * Results are cached per plugin and sourceType to avoid redundant processing.
 * @param plugin - The plugin instance
 * @param sourceType - The source TailorDB type (null for namespace plugins)
 * @param kind - The generated type kind (e.g., "request", "step")
 * @returns The generated TailorDB type
 */
export function getGeneratedType(
  plugin: PluginBase,
  sourceType: TailorAnyDBType | null,
  kind: string,
): TailorAnyDBType {
  // Namespace plugin (sourceType is null)
  if (sourceType === null) {
    return getGeneratedTypeForNamespacePlugin(plugin, kind);
  }

  // Type-attached plugin
  return getGeneratedTypeForTypeAttachedPlugin(plugin, sourceType, kind);
}

/**
 * Get a generated type from a type-attached plugin.
 * @param plugin - The plugin instance (must have process() method)
 * @param sourceType - The source TailorDB type
 * @param kind - The generated type kind
 * @returns The generated TailorDB type
 */
function getGeneratedTypeForTypeAttachedPlugin(
  plugin: PluginBase,
  sourceType: TailorAnyDBType,
  kind: string,
): TailorAnyDBType {
  if (!plugin.process) {
    throw new Error(`Plugin "${plugin.id}" does not have a process() method`);
  }

  // Check cache first
  let pluginCache = processCache.get(plugin);
  if (!pluginCache) {
    pluginCache = new Map();
    processCache.set(plugin, pluginCache);
  }

  const cacheKey = sourceType.name;
  let output = pluginCache.get(cacheKey);

  if (!output) {
    // Call process() and cache the result
    const result = plugin.process({
      type: sourceType,
      config: true, // Default config for type-attached plugins
      pluginConfig: plugin.pluginConfig,
      namespace: "", // Namespace is not needed for type retrieval
    });

    // Handle async case (seed schema should use sync plugins)
    if (result instanceof Promise) {
      throw new Error(
        `Plugin "${plugin.id}" process() returned a Promise. ` +
          `getGeneratedType requires synchronous process().`,
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
 * @returns The generated TailorDB type
 */
function getGeneratedTypeForNamespacePlugin(plugin: PluginBase, kind: string): TailorAnyDBType {
  if (!plugin.processNamespace) {
    throw new Error(`Plugin "${plugin.id}" does not have a processNamespace() method`);
  }

  // Check cache first
  let output = namespaceProcessCache.get(plugin);

  if (!output) {
    const result = plugin.processNamespace({
      pluginConfig: plugin.pluginConfig,
      namespace: "",
    });

    // Handle async case (seed schema should use sync plugins)
    if (result instanceof Promise) {
      throw new Error(
        `Plugin "${plugin.id}" processNamespace() returned a Promise. ` +
          `getGeneratedType requires synchronous processNamespace().`,
      );
    }

    output = result;
    namespaceProcessCache.set(plugin, output);
  }

  const generatedType = output.types?.[kind];
  if (!generatedType) {
    throw new Error(`Generated type not found: plugin=${plugin.id}, kind=${kind}`);
  }

  return generatedType as TailorAnyDBType;
}
