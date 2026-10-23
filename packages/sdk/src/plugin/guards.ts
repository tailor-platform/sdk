// Runtime guards and helpers for plugin authoring types.
//
// These live outside plugin/types.ts (a pure type module) because they are
// runtime functions. The types they operate on are imported type-only.
import type { PluginGeneratedExecutor, PluginGeneratedExecutorWithFile } from "./types";

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
