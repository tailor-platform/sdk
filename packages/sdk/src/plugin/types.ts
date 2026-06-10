// Plugin authoring types: plugin interface, generation-time hook contexts,
// generator config, and plugin attachments.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.

import type {
  BaseGeneratorConfigInput,
  CodeGeneratorInput,
} from "@/types/generator-config.generated";

export type DependencyKind = "tailordb" | "resolver" | "executor";

export type GeneratorConfig = BaseGeneratorConfigInput;

export type CodeGeneratorBase = Omit<CodeGeneratorInput, "dependencies"> & {
  dependencies: readonly DependencyKind[];
};

import type {
  PluginAttachment,
  TailorAnyDBField,
  TailorAnyDBType,
} from "@/configure/services/tailordb/types";
export type { PluginAttachment };

import type { TailorDBType, TypeSourceInfoEntry } from "@/parser/service/tailordb/types";
import type { IdProvider as IdProviderConfig, OAuth2Client } from "@/types/auth.generated";
import type { Executor } from "@/types/executor.generated";
import type { Resolver } from "@/types/resolver.generated";

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

export type TypeConfigRequired<PluginConfig = unknown> =
  | boolean
  | ((pluginConfig: PluginConfig | undefined) => boolean);

/**
 * Interface for plugin configuration mapping.
 * Extend this interface via declaration merging to add typed plugin configs.
 */
// oxlint-disable-next-line no-unused-vars, no-empty-object-type
export interface PluginConfigs<Fields extends string = string> {
  // Extend this interface via declaration merging to add typed plugin configs
}

/**
 * Context passed to plugin's process method
 */
export interface PluginProcessContext<TypeConfig = unknown, PluginConfig = unknown> {
  type: TailorAnyDBType;
  typeConfig: TypeConfig;
  pluginConfig: PluginConfig;
  namespace: string;
}

/**
 * Context passed to plugin's onNamespaceLoaded hook.
 */
export interface PluginNamespaceProcessContext<PluginConfig = unknown> {
  pluginConfig: PluginConfig;
  namespace: string;
}

/**
 * Interface representing a TailorDB type for plugin output.
 */
export interface TailorDBTypeForPlugin {
  readonly name: string;
  readonly fields: Record<string, unknown>;
}

export type PluginGeneratedType = TailorDBTypeForPlugin;

export type PluginGeneratedTypes = Record<string, PluginGeneratedType>;

export interface PluginGeneratedResolver {
  name: string;
  operation: "query" | "mutation";
  inputFields?: Record<string, unknown>;
  outputFields: Record<string, unknown>;
  body: string;
}

export interface PluginRecordTriggerConfig {
  kind: "tailordb";
  events: (
    | "tailordb.type_record.created"
    | "tailordb.type_record.updated"
    | "tailordb.type_record.deleted"
  )[];
  typeName: string;
}

export interface PluginScheduleTriggerConfig {
  kind: "schedule";
  cron: string;
  timezone?: string;
}

export interface PluginIncomingWebhookTriggerConfig {
  kind: "incomingWebhook";
}

export type PluginTriggerConfig =
  | PluginRecordTriggerConfig
  | PluginScheduleTriggerConfig
  | PluginIncomingWebhookTriggerConfig;

export type PluginInjectValue = string | number | boolean | null;
export type PluginInjectMap = Record<string, PluginInjectValue>;

export interface PluginFunctionOperationConfig {
  kind: "function";
  body: string;
  inject?: PluginInjectMap;
}

export interface PluginGraphQLOperationConfig {
  kind: "graphql";
  query: string;
  appName?: string;
  variables?: string;
}

export interface PluginWebhookOperationConfig {
  kind: "webhook";
  url: string;
}

export interface PluginWorkflowOperationConfig {
  kind: "workflow";
  workflowName: string;
}

export type PluginOperationConfig =
  | PluginFunctionOperationConfig
  | PluginGraphQLOperationConfig
  | PluginWebhookOperationConfig
  | PluginWorkflowOperationConfig;

export type PluginExecutorContextValue =
  | TailorAnyDBType
  | string
  | number
  | boolean
  | null
  | undefined;

export interface PluginExecutorContextBase {
  sourceType: TailorAnyDBType | null;
  namespace: string;
}

export type PluginExecutorContext = PluginExecutorContextBase & {
  [key: string]: PluginExecutorContextValue;
};

export interface PluginExecutorModule {
  default: unknown;
}

export interface PluginGeneratedExecutorWithFile<Ctx = PluginExecutorContext> {
  name: string;
  resolve: () => Promise<PluginExecutorModule>;
  context: Ctx;
}

export interface PluginGeneratedExecutorLegacy {
  name: string;
  description?: string;
  trigger: PluginTriggerConfig;
  operation: PluginOperationConfig;
}

export type PluginGeneratedExecutor =
  | PluginGeneratedExecutorWithFile
  | PluginGeneratedExecutorLegacy;

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

export interface PluginExtends {
  fields?: Record<string, TailorAnyDBField>;
}

export interface PluginOutput {
  types?: PluginGeneratedTypes;
  resolvers?: PluginGeneratedResolver[];
  executors?: PluginGeneratedExecutor[];
}

export interface TypePluginOutput extends PluginOutput {
  extends?: PluginExtends;
}

export type NamespacePluginOutput = PluginOutput;

/**
 * Plugin interface that all plugins must implement.
 * @template TypeConfig - Type for per-type configuration passed via .plugin() method
 * @template PluginConfig - Type for plugin-level configuration passed via definePlugins()
 */
export interface Plugin<TypeConfig = unknown, PluginConfig = unknown> {
  readonly id: string;
  readonly description: string;
  readonly importPath?: string;
  readonly typeConfigRequired?: TypeConfigRequired<PluginConfig>;
  readonly pluginConfig?: PluginConfig;

  onTypeLoaded?(
    context: PluginProcessContext<TypeConfig, PluginConfig>,
  ): TypePluginOutput | Promise<TypePluginOutput>;

  onNamespaceLoaded?(
    context: PluginNamespaceProcessContext<PluginConfig>,
  ): NamespacePluginOutput | Promise<NamespacePluginOutput>;

  onTailorDBReady?(
    context: TailorDBReadyContext<PluginConfig>,
  ): GeneratorResult | Promise<GeneratorResult>;

  onResolverReady?(
    context: ResolverReadyContext<PluginConfig>,
  ): GeneratorResult | Promise<GeneratorResult>;

  onExecutorReady?(
    context: ExecutorReadyContext<PluginConfig>,
  ): GeneratorResult | Promise<GeneratorResult>;
}
