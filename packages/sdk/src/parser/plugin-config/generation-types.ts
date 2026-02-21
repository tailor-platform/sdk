import type { PluginAttachment } from "./types";
import type { DependencyKind, GeneratorAuthInput, GeneratorResult } from "@/cli/generator/types";
import type { Executor } from "@/parser/service/executor";
import type { Resolver } from "@/parser/service/resolver";
import type { TailorDBType, TypeSourceInfoEntry } from "@/parser/service/tailordb/types";

/**
 * Namespace-level TailorDB data available to generation-time hooks.
 */
export interface TailorDBNamespaceData {
  /** Namespace name */
  namespace: string;
  /** All TailorDB types in this namespace, keyed by type name */
  types: Record<string, TailorDBType>;
  /** Source info for each type (file path, export name, plugin info) */
  sourceInfo: ReadonlyMap<string, TypeSourceInfoEntry>;
  /** Plugin attachments configured on each type via .plugin() method */
  pluginAttachments: ReadonlyMap<string, readonly PluginAttachment[]>;
}

/**
 * Namespace-level resolver data available to generation-time hooks.
 */
export interface ResolverNamespaceData {
  /** Namespace name */
  namespace: string;
  /** All resolvers in this namespace, keyed by resolver name */
  resolvers: Record<string, Resolver>;
}

/**
 * Context passed to plugin's onTailorDBReady hook.
 * Called after all TailorDB types are loaded and finalized.
 * @template PluginConfig - Plugin-level configuration type
 */
export interface TailorDBReadyContext<PluginConfig = unknown> {
  /** All TailorDB namespaces with their types and metadata */
  tailordb: TailorDBNamespaceData[];
  /** Auth configuration */
  auth?: GeneratorAuthInput;
  /** Base directory for generated files */
  baseDir: string;
  /** Path to tailor.config.ts */
  configPath: string;
  /** Plugin-level configuration passed via definePlugins() */
  pluginConfig: PluginConfig;
}

/**
 * Context passed to plugin's onResolverReady hook.
 * Called after all resolvers are loaded and finalized.
 * @template PluginConfig - Plugin-level configuration type
 */
export interface ResolverReadyContext<PluginConfig = unknown> {
  /** All TailorDB namespaces with their types and metadata */
  tailordb: TailorDBNamespaceData[];
  /** All resolver namespaces with their resolvers */
  resolvers: ResolverNamespaceData[];
  /** Auth configuration */
  auth?: GeneratorAuthInput;
  /** Base directory for generated files */
  baseDir: string;
  /** Path to tailor.config.ts */
  configPath: string;
  /** Plugin-level configuration passed via definePlugins() */
  pluginConfig: PluginConfig;
}

/**
 * Context passed to plugin's onExecutorReady hook.
 * Called after all executors are loaded and finalized.
 * @template PluginConfig - Plugin-level configuration type
 */
export interface ExecutorReadyContext<PluginConfig = unknown> {
  /** All TailorDB namespaces with their types and metadata */
  tailordb: TailorDBNamespaceData[];
  /** All resolver namespaces with their resolvers */
  resolvers: ResolverNamespaceData[];
  /** All executors, keyed by executor name */
  executors: Record<string, Executor>;
  /** Auth configuration */
  auth?: GeneratorAuthInput;
  /** Base directory for generated files */
  baseDir: string;
  /** Path to tailor.config.ts */
  configPath: string;
  /** Plugin-level configuration passed via definePlugins() */
  pluginConfig: PluginConfig;
}

/**
 * Derives generation-time dependency set from hook presence on a plugin.
 * @param plugin - Plugin to check for generation hooks
 * @param plugin.onTailorDBReady - TailorDB phase-complete hook
 * @param plugin.onResolverReady - Resolver phase-complete hook
 * @param plugin.onExecutorReady - Executor phase-complete hook
 * @returns Set of dependency kinds based on which hooks are implemented
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
 * @param plugin - Plugin to check
 * @param plugin.onTailorDBReady - TailorDB phase-complete hook
 * @param plugin.onResolverReady - Resolver phase-complete hook
 * @param plugin.onExecutorReady - Executor phase-complete hook
 * @returns True if the plugin has at least one generation hook
 */
export function hasGenerationHooks(plugin: {
  onTailorDBReady?: unknown;
  onResolverReady?: unknown;
  onExecutorReady?: unknown;
}): boolean {
  return !!(plugin.onTailorDBReady || plugin.onResolverReady || plugin.onExecutorReady);
}

// Re-export GeneratorResult for plugin authors
export type { GeneratorResult } from "@/cli/generator/types";
