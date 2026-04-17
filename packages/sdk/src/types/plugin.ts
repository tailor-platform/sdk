import type {
  TailorDBReadyContext,
  ResolverReadyContext,
  ExecutorReadyContext,
  GeneratorResult,
} from "./plugin-generation";
import type { TailorAnyDBField, TailorAnyDBType } from "./tailor-db-field";

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
 * Plugin attachment stored on TailorAnyDBType instances.
 */
export interface PluginAttachment {
  pluginId: string;
  config: unknown;
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
