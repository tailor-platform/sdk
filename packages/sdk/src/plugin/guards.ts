// Runtime guards and helpers for plugin authoring types.
//
// These live outside plugin/types.ts (a pure type module) because they are
// runtime functions. The types they operate on are imported type-only.
import type {
  DependencyKind,
  PluginGeneratedExecutor,
  PluginGeneratedExecutorWithFile,
} from "./types";

/**
 * Reads a table name without assuming plugin output is a valid table object.
 * @param table - Raw table value returned by a plugin hook.
 * @returns The table name when it is a string; otherwise, undefined.
 */
export function getRawPluginTableName(table: unknown): string | undefined {
  const name =
    typeof table === "object" && table !== null && "name" in table ? table.name : undefined;
  return typeof name === "string" ? name : undefined;
}

/**
 * Collects the generation-time dependency kinds a plugin requires.
 * @param plugin - The plugin object to inspect.
 * @param plugin.onTailorDBReady - Hook for TailorDB readiness.
 * @param plugin.onResolverReady - Hook for resolver readiness.
 * @param plugin.onExecutorReady - Hook for executor readiness.
 * @returns Set of dependency kinds required by the plugin.
 */
export function getPluginGenerationDependencies(plugin: {
  onTailorDBReady?: unknown;
  onResolverReady?: unknown;
  onExecutorReady?: unknown;
}): Set<DependencyKind> {
  const deps = new Set<DependencyKind>();
  if (plugin.onTailorDBReady) {
    deps.add("tailordb");
  }
  if (plugin.onResolverReady) {
    deps.add("resolver");
  }
  if (plugin.onExecutorReady) {
    deps.add("executor");
  }
  return deps;
}

/**
 * Checks if a plugin has any generation-time hooks.
 * @param plugin - The plugin object to inspect.
 * @param plugin.onTailorDBReady - Hook for TailorDB readiness.
 * @param plugin.onResolverReady - Hook for resolver readiness.
 * @param plugin.onExecutorReady - Hook for executor readiness.
 * @returns True if the plugin has at least one generation hook.
 */
export function hasGenerationHooks(plugin: {
  onTailorDBReady?: unknown;
  onResolverReady?: unknown;
  onExecutorReady?: unknown;
}): boolean {
  return !!(plugin.onTailorDBReady || plugin.onResolverReady || plugin.onExecutorReady);
}

/**
 * Checks if a plugin executor uses file-based resolution.
 * @param executor - The plugin executor to check.
 * @returns True if the executor uses file-based resolution.
 */
export function isPluginExecutorWithFile(
  executor: PluginGeneratedExecutor,
): executor is PluginGeneratedExecutorWithFile {
  return "resolve" in executor && "context" in executor;
}

/**
 * The shape every plugin instance has, whatever else it carries.
 */
export interface PluginShaped {
  id: string;
  description: string;
}

function isPluginShaped(value: unknown): value is PluginShaped {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).id === "string" &&
    typeof (value as Record<string, unknown>).description === "string"
  );
}

/**
 * Picks the plugin arrays (`definePlugins()` results) out of a config module's
 * exports. An array counts only when every item is plugin-shaped, so an array
 * that mixes in anything else is left alone as a whole; every loader that reads
 * plugins from a config module goes through this so they agree on which ones exist.
 * @param configModule - The imported `tailor.config.ts` module namespace
 * @returns The exported arrays whose items are all plugin-shaped, in export order
 */
export function pickPluginArrays(configModule: object): PluginShaped[][] {
  const arrays: PluginShaped[][] = [];
  for (const value of Object.values(configModule)) {
    if (Array.isArray(value) && value.length > 0 && value.every(isPluginShaped)) {
      arrays.push(value);
    }
  }
  return arrays;
}
