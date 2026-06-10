import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import type { TailorAnyDBType } from "@/configure/services/tailordb/types";
import type { Plugin, PluginOutput, TypePluginOutput } from "@/plugin/types";

// ========================================
// Config loading and caching
// ========================================

interface PluginEntry {
  plugin: Plugin;
  pluginConfig: unknown;
}

interface ConfigCache {
  config: { db?: Record<string, unknown> };
  plugins: Map<string, PluginEntry>;
  configDir: string;
}

/** Cache: resolved config path -> loaded config data */
const configCacheMap = new Map<string, ConfigCache>();

/**
 * Check if a value is a Plugin instance.
 * @param value - Value to check
 * @returns True if value has the shape of Plugin
 */
function isPlugin(value: unknown): value is Plugin {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).id === "string" &&
    typeof (value as Record<string, unknown>).description === "string"
  );
}

/**
 * Load and cache config module from the given path.
 * Extracts plugins from all array exports using definePlugins() format.
 * Returns null if the config file does not exist (e.g., in bundled executor on platform server).
 * @param configPath - Absolute or relative path to tailor.config.ts
 * @returns Cached config data with plugins map, or null if config file is not available
 */
async function loadAndCacheConfig(configPath: string): Promise<ConfigCache | null> {
  const resolvedPath = path.resolve(configPath);

  const cached = configCacheMap.get(resolvedPath);
  if (cached) return cached;

  // Config file may not exist in bundled environments (e.g., platform server)
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  const configModule = await import(pathToFileURL(resolvedPath).href);
  if (!configModule?.default) {
    throw new Error(`Invalid config module at "${resolvedPath}": default export not found`);
  }

  const config = configModule.default as { db?: Record<string, unknown> };
  const configDir = path.dirname(resolvedPath);
  const plugins = new Map<string, PluginEntry>();

  // Find plugin arrays from exports (definePlugins returns PluginConfig[])
  for (const value of Object.values(configModule)) {
    if (!Array.isArray(value)) continue;

    for (const item of value) {
      if (isPlugin(item)) {
        plugins.set(item.id, { plugin: item, pluginConfig: item.pluginConfig });
      }
    }
  }

  const result: ConfigCache = { config, plugins, configDir };
  configCacheMap.set(resolvedPath, result);
  return result;
}

// ========================================
// Namespace resolution
// ========================================

interface DbNamespaceConfig {
  files?: string[];
  external?: boolean;
}

/**
 * Resolve the namespace for a type-attached sourceType by checking config.db file patterns.
 * Uses ESM module cache identity: same file path yields same object references.
 * @param config - App config with db namespace definitions
 * @param config.db - DB namespace definitions
 * @param configDir - Directory containing the config file
 * @param sourceType - The TailorDB type to look up
 * @returns The namespace name
 */
async function resolveNamespaceForType(
  config: { db?: Record<string, unknown> },
  configDir: string,
  sourceType: TailorAnyDBType,
): Promise<string> {
  if (!config.db) {
    throw new Error(`No db configuration found in config`);
  }

  for (const [namespace, nsConfig] of Object.entries(config.db)) {
    const dbConfig = nsConfig as DbNamespaceConfig;
    // Skip external namespaces (no files to resolve)
    if (dbConfig.external || !dbConfig.files) continue;

    for (const pattern of dbConfig.files) {
      const absolutePattern = path.resolve(configDir, pattern);
      let matchedFiles: string[];
      try {
        matchedFiles = fs.globSync(absolutePattern);
      } catch {
        continue;
      }

      for (const file of matchedFiles) {
        const mod = await import(pathToFileURL(file).href);
        for (const exported of Object.values(mod)) {
          if (exported === sourceType) {
            return namespace;
          }
        }
      }
    }
  }

  throw new Error(
    `Could not resolve namespace for type "${sourceType.name}". ` +
      `Ensure the type file is included in a db namespace's files pattern.`,
  );
}

/**
 * Resolve the namespace for a namespace plugin by trying each namespace.
 * Calls onNamespaceLoaded() for each and returns the first whose output contains the requested kind.
 * @param config - App config with db namespace definitions
 * @param config.db - DB namespace definitions
 * @param plugin - Plugin instance
 * @param kind - The generated type kind to look for
 * @param pluginConfig - Plugin-level configuration
 * @returns The namespace name
 */
async function resolveNamespaceForNamespacePlugin(
  config: { db?: Record<string, unknown> },
  plugin: Plugin,
  kind: string,
  pluginConfig: unknown,
): Promise<{ namespace: string; output: PluginOutput }> {
  if (!config.db) {
    throw new Error(`No db configuration found in config`);
  }

  if (!plugin.onNamespaceLoaded) {
    throw new Error(`Plugin "${plugin.id}" does not have a onNamespaceLoaded() method`);
  }

  for (const namespace of Object.keys(config.db)) {
    const dbConfig = config.db[namespace] as DbNamespaceConfig;
    if (dbConfig.external) continue;

    const output = await plugin.onNamespaceLoaded({
      pluginConfig,
      namespace,
    });

    if (output.types?.[kind]) {
      return { namespace, output };
    }
  }

  throw new Error(
    `Could not resolve namespace for plugin "${plugin.id}" with kind "${kind}". ` +
      `No namespace produced a type with that kind.`,
  );
}

// ========================================
// Process caching
// ========================================

// Cache: plugin -> cacheKey -> TypePluginOutput
const processCache = new WeakMap<Plugin, Map<string, TypePluginOutput>>();

// Cache for namespace plugins: plugin -> cacheKey -> PluginOutput
const namespaceProcessCache = new WeakMap<Plugin, Map<string, PluginOutput>>();

/**
 * Generate a cache key that includes pluginConfig.
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
    throw new Error(
      `pluginConfig must be JSON-serializable for caching. Received non-serializable value.`,
    );
  }
}

// ========================================
// Main API
// ========================================

/**
 * Get a generated type from a plugin by loading the config and resolving everything automatically.
 * For type-attached plugins, calls onTypeLoaded() with the sourceType.
 * For namespace plugins, calls onNamespaceLoaded() with auto-resolved namespace.
 * Results are cached per config path, plugin, namespace, and pluginConfig to avoid redundant processing.
 * @param configPath - Path to tailor.config.ts (absolute or relative to cwd)
 * @param pluginId - The plugin's unique identifier
 * @param sourceType - The source TailorDB type (null for namespace plugins)
 * @param kind - The generated type kind (e.g., "request", "step")
 * @returns The generated TailorDB type
 */
export async function getGeneratedType(
  configPath: string,
  pluginId: string,
  sourceType: TailorAnyDBType | null,
  kind: string,
): Promise<TailorAnyDBType> {
  const cache = await loadAndCacheConfig(configPath);

  if (!cache) {
    // Config not available (e.g., running in bundled executor on platform server).
    // Return a placeholder. The actual type is resolved at generate/apply time.
    return { name: `__placeholder_${kind}__`, fields: {} } as TailorAnyDBType;
  }

  const { config, configDir, plugins } = cache;

  const pluginEntry = plugins.get(pluginId);
  if (!pluginEntry) {
    throw new Error(
      `Plugin "${pluginId}" not found in config at "${configPath}". ` +
        `Ensure the plugin is registered via definePlugins().`,
    );
  }

  const { plugin, pluginConfig } = pluginEntry;

  if (sourceType === null) {
    return getGeneratedTypeForNamespacePlugin(config, plugin, kind, pluginConfig);
  }

  const namespace = await resolveNamespaceForType(config, configDir, sourceType);
  return getGeneratedTypeForTypeAttachedPlugin(plugin, sourceType, kind, pluginConfig, namespace);
}

/**
 * Get a generated type from a type-attached plugin.
 * @param plugin - The plugin instance (must have onTypeLoaded() method)
 * @param sourceType - The source TailorDB type
 * @param kind - The generated type kind
 * @param pluginConfig - Plugin-level configuration
 * @param namespace - Resolved namespace
 * @returns The generated TailorDB type
 */
async function getGeneratedTypeForTypeAttachedPlugin(
  plugin: Plugin,
  sourceType: TailorAnyDBType,
  kind: string,
  pluginConfig: unknown,
  namespace: string,
): Promise<TailorAnyDBType> {
  if (!plugin.onTypeLoaded) {
    throw new Error(`Plugin "${plugin.id}" does not have a onTypeLoaded() method`);
  }

  // Check cache first
  let pluginCache = processCache.get(plugin);
  if (!pluginCache) {
    pluginCache = new Map();
    processCache.set(plugin, pluginCache);
  }

  const cacheKey = getCacheKey(`${sourceType.name}:ns=${namespace}`, pluginConfig);
  let output = pluginCache.get(cacheKey);

  if (!output) {
    const typeConfig = sourceType.plugins?.find((p) => p.pluginId === plugin.id)?.config;
    output = await plugin.onTypeLoaded({
      type: sourceType,
      typeConfig: typeConfig ?? {},
      pluginConfig,
      namespace,
    });
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
 * Auto-resolves the namespace by trying each one.
 * @param config - App config with db namespace definitions
 * @param config.db - DB namespace definitions
 * @param plugin - The plugin instance (must have onNamespaceLoaded() method)
 * @param kind - The generated type kind
 * @param pluginConfig - Plugin-level configuration
 * @returns The generated TailorDB type
 */
async function getGeneratedTypeForNamespacePlugin(
  config: { db?: Record<string, unknown> },
  plugin: Plugin,
  kind: string,
  pluginConfig: unknown,
): Promise<TailorAnyDBType> {
  if (!plugin.onNamespaceLoaded) {
    throw new Error(`Plugin "${plugin.id}" does not have a onNamespaceLoaded() method`);
  }

  // Check cache first - try all namespaces
  let pluginCache = namespaceProcessCache.get(plugin);
  if (!pluginCache) {
    pluginCache = new Map();
    namespaceProcessCache.set(plugin, pluginCache);
  }

  // Try cached results first
  if (config.db) {
    for (const namespace of Object.keys(config.db)) {
      const dbConfig = config.db[namespace] as DbNamespaceConfig;
      if (dbConfig.external) continue;

      const cacheKey = getCacheKey(`namespace:ns=${namespace}`, pluginConfig);
      const cached = pluginCache.get(cacheKey);
      if (cached?.types?.[kind]) {
        return cached.types[kind] as TailorAnyDBType;
      }
    }
  }

  // Not in cache - resolve namespace and process
  const { namespace, output } = await resolveNamespaceForNamespacePlugin(
    config,
    plugin,
    kind,
    pluginConfig,
  );

  const cacheKey = getCacheKey(`namespace:ns=${namespace}`, pluginConfig);
  pluginCache.set(cacheKey, output);

  const generatedType = output.types?.[kind];
  if (!generatedType) {
    throw new Error(`Generated type not found: plugin=${plugin.id}, kind=${kind}`);
  }

  return generatedType as TailorAnyDBType;
}

/**
 * Clear all internal caches. For testing only.
 */
export function _clearCacheForTesting(): void {
  configCacheMap.clear();
}
