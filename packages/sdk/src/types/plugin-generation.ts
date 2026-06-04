import type { IdProvider as IdProviderConfig, OAuth2Client } from "./auth.generated";
import type { Executor } from "./executor.generated";
import type { DependencyKind } from "./generator-config";
import type { PluginAttachment } from "./plugin";
import type { Resolver } from "./resolver.generated";
import type { TailorDBType, TypeSourceInfoEntry } from "./tailordb";

/**
 * A single generated file to write to disk.
 */
export interface GeneratedFile {
  path: string;
  content: string;
  skipIfExists?: boolean;
  executable?: boolean;
}

/**
 * Result returned by generation-time hooks.
 */
export interface GeneratorResult {
  files: GeneratedFile[];
  errors?: string[];
}

/**
 * Auth configuration available to generation-time hooks.
 */
export interface GeneratorAuthInput {
  name: string;
  userProfile?: {
    typeName: string;
    namespace: string;
    usernameField: string;
  };
  machineUsers?: Record<string, { attributes?: Record<string, unknown> }>;
  oauth2Clients?: Record<string, OAuth2Client>;
  idProvider?: IdProviderConfig;
}

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
