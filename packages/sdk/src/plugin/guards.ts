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
