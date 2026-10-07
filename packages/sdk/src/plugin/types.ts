// Plugin authoring types: plugin interface, generation-time hook contexts,
// generator config, and plugin attachments.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.

export type DependencyKind = "tailordb" | "resolver" | "executor";

import type {
  PluginAttachment,
  TailorAnyDBField,
  TailorAnyDBType,
} from "#/configure/services/tailordb/types";
export type { PluginAttachment };

import type { TailorDBType, TypeSourceInfoEntry } from "#/parser/service/tailordb/types";
import type { IdProvider as IdProviderConfig, OAuth2Client } from "#/types/auth.generated";
import type { Executor } from "#/types/executor.generated";
import type { Resolver } from "#/types/resolver.generated";

/**
 * A single generated file to write to disk.
 */
interface GeneratedFile {
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
    tableName: string;
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
  /** All TailorDB tables in this namespace, keyed by table name */
  tables: Record<string, TailorDBType>;
  /** Source info for each table (file path, export name, plugin info) */
  sourceInfo: ReadonlyMap<string, TypeSourceInfoEntry>;
  /** Plugin attachments configured on each table via .plugin() method */
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
  /** TailorDB namespaces owned by this application, with their tables and metadata */
  tailordb: TailorDBNamespaceData[];
  /** Definitions referenced from other applications through config.db */
  referencedTailordb?: TailorDBNamespaceData[];
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
  /** TailorDB namespaces owned by this application, with their tables and metadata */
  tailordb: TailorDBNamespaceData[];
  /** Definitions referenced from other applications through config.db */
  referencedTailordb?: TailorDBNamespaceData[];
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
  /** TailorDB namespaces owned by this application, with their tables and metadata */
  tailordb: TailorDBNamespaceData[];
  /** Definitions referenced from other applications through config.db */
  referencedTailordb?: TailorDBNamespaceData[];
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

/** @lintignore kept exported for the zinfer-generated reference in src/types/plugin-config.generated.ts */
export type TableConfigRequired<PluginConfig = unknown> =
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
 * Registry mapping a plugin's `id` literal to the fields it injects into the
 * attached table's static type, computed from the literal per-call config
 * passed to `.plugin()`. Extend this interface via declaration merging, keyed
 * by the same `id` used in {@link PluginConfigs}. The value must be a
 * `Record<string, TailorAnyDBField>` of the fields to add — it is merged
 * into the table's existing fields, not a replacement for them.
 */
// oxlint-disable-next-line no-unused-vars, no-empty-object-type
export interface PluginFieldExtensions<Fields extends string = string, Config = unknown> {
  // Extend this interface via declaration merging to add typed field injections
}

/**
 * Registry mapping a plugin's `id` literal to its plugin-level config type.
 * Extend via declaration merging, keyed by the `id` string, from the
 * owning plugin's own module.
 */
// oxlint-disable-next-line no-empty-object-type
export interface PluginConfigRegistry {}

/**
 * Context passed to plugin's process method
 */
export interface PluginTableProcessContext<TableConfig = unknown, PluginConfig = unknown> {
  table: TailorAnyDBType;
  tableConfig: TableConfig;
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
 * Interface representing a TailorDB table for plugin output.
 */
export interface TailorDBTableForPlugin {
  readonly name: string;
  readonly fields: Record<string, unknown>;
}

export type PluginGeneratedTable = TailorDBTableForPlugin;

type PluginGeneratedTables = Record<string, PluginGeneratedTable>;

export interface PluginGeneratedResolver {
  name: string;
  operation: "query" | "mutation";
  inputFields?: Record<string, unknown>;
  outputFields: Record<string, unknown>;
  body: string;
}

interface PluginRecordTriggerConfig {
  kind: "tailordb";
  events: (
    | "tailordb.type_record.created"
    | "tailordb.type_record.updated"
    | "tailordb.type_record.deleted"
  )[];
  tableName: string;
}

interface PluginScheduleTriggerConfig {
  kind: "schedule";
  cron: string;
  timezone?: string;
}

interface PluginIncomingWebhookTriggerConfig {
  kind: "incomingWebhook";
}

export type PluginTriggerConfig =
  | PluginRecordTriggerConfig
  | PluginScheduleTriggerConfig
  | PluginIncomingWebhookTriggerConfig;

type PluginInjectValue = string | number | boolean | null;
export type PluginInjectMap = Record<string, PluginInjectValue>;

interface PluginFunctionOperationConfig {
  kind: "function";
  body: string;
  inject?: PluginInjectMap;
}

interface PluginGraphQLOperationConfig {
  kind: "graphql";
  query: string;
  appName?: string;
  variables?: string;
}

interface PluginWebhookOperationConfig {
  kind: "webhook";
  url: string;
}

interface PluginWorkflowOperationConfig {
  kind: "workflow";
  workflowName: string;
}

export type PluginOperationConfig =
  | PluginFunctionOperationConfig
  | PluginGraphQLOperationConfig
  | PluginWebhookOperationConfig
  | PluginWorkflowOperationConfig;

type PluginExecutorContextValue = TailorAnyDBType | string | number | boolean | null | undefined;

export interface PluginExecutorContextBase {
  sourceTable: TailorAnyDBType | null;
  namespace: string;
}

export type PluginExecutorContext = PluginExecutorContextBase & {
  [key: string]: PluginExecutorContextValue;
};

interface PluginExecutorModule {
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

interface PluginExtends<FieldExtension extends Record<string, TailorAnyDBField>> {
  fields?: FieldExtension;
}

export interface PluginOutput {
  tables?: PluginGeneratedTables;
  resolvers?: PluginGeneratedResolver[];
  executors?: PluginGeneratedExecutor[];
}

export interface TablePluginOutput<
  FieldExtension extends Record<string, TailorAnyDBField> = Record<string, TailorAnyDBField>,
> extends PluginOutput {
  extends?: PluginExtends<FieldExtension>;
}

export type NamespacePluginOutput = PluginOutput;

/**
 * Plugin interface that all plugins must implement.
 * @template TableConfig - Type for per-table configuration passed via .plugin() method
 * @template PluginConfig - Type for plugin-level configuration passed via definePlugins()
 * @template FieldExtension - Type of the fields injected into the attached table via `extends.fields`. Should match the corresponding {@link PluginFieldExtensions} entry.
 */
export interface Plugin<
  TableConfig = unknown,
  PluginConfig = unknown,
  FieldExtension extends Record<string, TailorAnyDBField> = Record<string, TailorAnyDBField>,
> {
  readonly id: string;
  readonly description: string;
  readonly importPath?: string;
  readonly tableConfigRequired?: TableConfigRequired<PluginConfig>;
  readonly pluginConfig?: PluginConfig;

  onTableLoaded?(
    context: PluginTableProcessContext<TableConfig, PluginConfig>,
  ): TablePluginOutput<FieldExtension> | Promise<TablePluginOutput<FieldExtension>>;

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

  /** Runs after a successful deploy, including deploys with no resource changes. */
  onDeployed?(
    context: DeployedContext<PluginConfig>,
  ): void | DeployedHookResult | Promise<void | DeployedHookResult>;
}

export interface PublishStaticWebsiteResult {
  url: string;
  skippedFiles: string[];
}

export interface DeployedStaticWebsite {
  name: string;
  url: string;
}

/** A static website declared in the config that registers the plugin, which the plugin can publish to. */
export interface PublishableStaticWebsite extends DeployedStaticWebsite {
  /** Uploads the directory at the absolute path `dir` and publishes it to this website. */
  publish(dir: string): Promise<PublishStaticWebsiteResult>;
}

export interface DeployedOAuth2Client {
  name: string;
  clientId: string;
}

export interface DeployedApplication<
  StaticWebsite extends DeployedStaticWebsite = DeployedStaticWebsite,
> {
  /** SDK-managed application ID from defineConfig(); undefined when the config has none. */
  id?: string;
  name: string;
  configPath: string;
  /** Application endpoint URL, present when a matching Platform Application exists. */
  url?: string;
  domain?: string;
  aiGateways: { name: string; url: string }[];
  /** Static websites declared in this application's config, keyed by name. */
  staticWebsites: Readonly<Partial<Record<string, StaticWebsite>>>;
  auth?: { namespace: string; oauth2Clients: DeployedOAuth2Client[] };
}

export interface PluginLogger {
  info(message: string): void;
  warn(message: string): void;
  success(message: string): void;
}

export interface PluginExecOptions {
  /** Directory to run the command in. */
  workingDir: string;
  /** Environment variables added to the environment `tailor` runs with. */
  env?: Record<string, string>;
  /**
   * Where the command's output goes. `"stream"` (default) writes both stdout and stderr to stderr
   * so `--json` results on stdout stay parseable, `"capture"` returns them, and `"ignore"` discards them.
   */
  output?: "stream" | "capture" | "ignore";
}

export interface PluginExecResult {
  /** Captured stdout. Empty unless `output` is `"capture"`. */
  stdout: string;
  /** Captured stderr. Empty unless `output` is `"capture"`. */
  stderr: string;
}

/** Values available after all applications in this deploy run have been applied. */
export interface DeployedContext<PluginConfig = unknown> {
  workspaceId: string;
  /** Application whose config registers this plugin. Only its static websites can be published. */
  application: DeployedApplication<PublishableStaticWebsite>;
  /** Every application in this deploy run, including the registering one. */
  applications: readonly DeployedApplication[];
  /** Absolute path of the config registering this plugin. */
  configPath: string;
  pluginConfig: PluginConfig;
  logger: PluginLogger;
  /**
   * Run a shell command on the machine running `tailor deploy`. Rejects when the command exits with a non-zero code.
   * @param command - Shell command, such as `pnpm build`
   * @param options - Working directory, added environment variables, and output handling
   * @returns Captured output when `options.output` is `"capture"`
   */
  exec(command: string, options: PluginExecOptions): Promise<PluginExecResult>;
}

// Symbol keys only: string keys such as `toJSON?: never` would also reject interfaces with a data field of that name.
type OutputObject = object & {
  [Symbol.iterator]?: never;
  [Symbol.toStringTag]?: never;
  [Symbol.hasInstance]?: never;
  [Symbol.toPrimitive]?: never;
  [Symbol.match]?: never;
};

/**
 * A value a plugin hook can return in `outputs`. Interface-typed objects are accepted;
 * a `Date` or class instance nested inside one is rejected when the deploy runs.
 */
export type PluginOutputValue =
  | string
  | number
  | boolean
  | null
  | readonly PluginOutputValue[]
  | { [key: string]: PluginOutputValue }
  | OutputObject;

export interface DeployedHookResult {
  /** Values included in deploy's JSON result. Interface-typed values are accepted, but a `Date` or class instance nested inside one fails the deploy instead of the type check. */
  outputs?: Record<string, PluginOutputValue>;
}
