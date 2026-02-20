import type { PluginAttachment } from "./types";
import type {
  DependencyKind,
  GeneratorAuthInput,
  GeneratorResult,
  ResolverNamespaceResult,
  TailorDBNamespaceResult,
} from "@/cli/generator/types";
import type { Executor } from "@/parser/service/executor";
import type { Resolver } from "@/parser/service/resolver";
import type { TailorDBType, TypeSourceInfoEntry } from "@/parser/service/tailordb/types";

/**
 * Context passed to plugin's onTypeLoaded hook.
 * Called for each TailorDB type after all types are loaded and parsed.
 * @template PluginConfig - Plugin-level configuration type
 */
export interface TypeLoadedContext<PluginConfig = unknown> {
  /** The parsed TailorDB type */
  type: TailorDBType;
  /** Namespace of the TailorDB type */
  namespace: string;
  /** Source info for the type (file path, export name, plugin info) */
  source: TypeSourceInfoEntry;
  /** Plugin attachments configured on this type via .plugin() method */
  plugins: readonly PluginAttachment[];
  /** Plugin-level configuration passed via definePlugins() */
  pluginConfig: PluginConfig;
}

/**
 * Context passed to plugin's onTailorDBNamespaceLoaded hook.
 * Called once per namespace after all types are processed by onTypeLoaded.
 * @template PluginConfig - Plugin-level configuration type
 */
export interface TailorDBNamespaceLoadedContext<PluginConfig = unknown> {
  /** Namespace name */
  namespace: string;
  /** Accumulated per-type results from onTypeLoaded, keyed by type name */
  types: Record<string, unknown>;
  /** Plugin-level configuration passed via definePlugins() */
  pluginConfig: PluginConfig;
}

/**
 * Context passed to plugin's onResolverLoaded hook.
 * Called for each resolver after all resolvers are loaded.
 * @template PluginConfig - Plugin-level configuration type
 */
export interface ResolverLoadedContext<PluginConfig = unknown> {
  /** The loaded resolver */
  resolver: Resolver;
  /** Namespace of the resolver */
  namespace: string;
  /** Plugin-level configuration passed via definePlugins() */
  pluginConfig: PluginConfig;
}

/**
 * Context passed to plugin's onResolverNamespaceLoaded hook.
 * Called once per namespace after all resolvers are processed.
 * @template PluginConfig - Plugin-level configuration type
 */
export interface ResolverNamespaceLoadedContext<PluginConfig = unknown> {
  /** Namespace name */
  namespace: string;
  /** Accumulated per-resolver results from onResolverLoaded, keyed by resolver name */
  resolvers: Record<string, unknown>;
  /** Plugin-level configuration passed via definePlugins() */
  pluginConfig: PluginConfig;
}

/**
 * Context passed to plugin's onExecutorLoaded hook.
 * Called for each executor after all executors are loaded.
 * @template PluginConfig - Plugin-level configuration type
 */
export interface ExecutorLoadedContext<PluginConfig = unknown> {
  /** The loaded executor */
  executor: Executor;
  /** Plugin-level configuration passed via definePlugins() */
  pluginConfig: PluginConfig;
}

/**
 * Context passed to plugin's generate hook.
 * Called after all post-definition hooks complete.
 * @template PluginConfig - Plugin-level configuration type
 */
export interface PluginGenerateContext<PluginConfig = unknown> {
  /** Results from TailorDB processing, grouped by namespace */
  tailordb?: TailorDBNamespaceResult<unknown>[];
  /** Results from resolver processing, grouped by namespace */
  resolver?: ResolverNamespaceResult<unknown>[];
  /** Results from executor processing */
  executor?: unknown[];
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
 * @param plugin.onTypeLoaded
 * @param plugin.onTailorDBNamespaceLoaded
 * @param plugin.onResolverLoaded
 * @param plugin.onResolverNamespaceLoaded
 * @param plugin.onExecutorLoaded
 * @returns Set of dependency kinds based on which hooks are implemented
 */
export function getPluginGenerationDependencies(plugin: {
  onTypeLoaded?: unknown;
  onTailorDBNamespaceLoaded?: unknown;
  onResolverLoaded?: unknown;
  onResolverNamespaceLoaded?: unknown;
  onExecutorLoaded?: unknown;
}): Set<DependencyKind> {
  const deps = new Set<DependencyKind>();
  if (plugin.onTypeLoaded || plugin.onTailorDBNamespaceLoaded) {
    deps.add("tailordb");
  }
  if (plugin.onResolverLoaded || plugin.onResolverNamespaceLoaded) {
    deps.add("resolver");
  }
  if (plugin.onExecutorLoaded) {
    deps.add("executor");
  }
  return deps;
}

/**
 * Checks if a plugin has any generation-time hooks.
 * @param plugin - Plugin to check
 * @param plugin.onTypeLoaded
 * @param plugin.onTailorDBNamespaceLoaded
 * @param plugin.onResolverLoaded
 * @param plugin.onResolverNamespaceLoaded
 * @param plugin.onExecutorLoaded
 * @param plugin.generate
 * @returns True if the plugin has at least one generation hook
 */
export function hasGenerationHooks(plugin: {
  onTypeLoaded?: unknown;
  onTailorDBNamespaceLoaded?: unknown;
  onResolverLoaded?: unknown;
  onResolverNamespaceLoaded?: unknown;
  onExecutorLoaded?: unknown;
  generate?: unknown;
}): boolean {
  return !!(
    plugin.onTypeLoaded ||
    plugin.onTailorDBNamespaceLoaded ||
    plugin.onResolverLoaded ||
    plugin.onResolverNamespaceLoaded ||
    plugin.onExecutorLoaded ||
    plugin.generate
  );
}

// Re-export GeneratorResult for plugin authors
export type { GeneratorResult } from "@/cli/generator/types";
