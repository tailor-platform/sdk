import * as path from "pathe";
import { generatePluginExecutorFiles } from "#/cli/commands/generate/plugin-executor-generator";
import { generatePluginTableFiles } from "#/cli/commands/generate/plugin-table-generator";
import { bundleAuthHooks } from "#/cli/services/auth/bundler";
import { createAuthService, type AuthService } from "#/cli/services/auth/service";
import { bundleExecutors } from "#/cli/services/executor/bundler";
import { createExecutorService, type ExecutorService } from "#/cli/services/executor/service";
import {
  bundleHttpAdapters,
  type HttpAdapterBundleResult,
} from "#/cli/services/http-adapter/bundler";
import {
  createHttpAdapterService,
  type HttpAdapterService,
} from "#/cli/services/http-adapter/service";
import { bundleResolvers } from "#/cli/services/resolver/bundler";
import {
  createResolverService,
  type PluginResolverSource,
  type ResolverService,
} from "#/cli/services/resolver/service";
import { createTailorDBService, type TailorDBService } from "#/cli/services/tailordb/service";
import { assertUniqueLocalTailorDBTypeNames } from "#/cli/services/tailordb/type-name-validation";
import {
  bundleWorkflowJobs,
  type BundleWorkflowJobsOptions,
  type BundleWorkflowJobsResult,
} from "#/cli/services/workflow/bundler";
import { createWorkflowService, type WorkflowService } from "#/cli/services/workflow/service";
import { buildOptionsOf, projectSourcesOf } from "#/cli/shared/build-options";
import { resolveBundleLogLevel } from "#/cli/shared/bundle-log-level";
import {
  type ApplicationEnv,
  resolveStaticWebsiteUrlsInEnv,
  type OperatorClient,
} from "#/cli/shared/client";
import {
  isLoadedWorkspaceConfig,
  tailorDBTypeNameScopeOf,
  type LoadedConfig,
  type LoadedWorkspaceConfig,
} from "#/cli/shared/config-loader";
import { effectiveDateDefault, effectiveDecimalDefault } from "#/cli/shared/date-default";
import { getDistDir } from "#/cli/shared/dist-dir";
import { CLIError } from "#/cli/shared/errors";
import { idpConfigList, isIdpConfigList } from "#/cli/shared/idp-config";
import { resolveInlineSourcemap } from "#/cli/shared/inline-sourcemap";
import { logger } from "#/cli/shared/logger";
import { resolverBundleKey } from "#/cli/shared/resolver-bundle-key";
import { buildStartContext, type StartContext } from "#/cli/shared/start-context";
import {
  createTsconfigLookupCache,
  type TsconfigLookupCache,
} from "#/cli/shared/tsconfig-paths-plugin";
import {
  assertUniqueDefinitionNames,
  configInvalidError,
  configIssuesError,
} from "#/cli/shared/validation-errors";
import { type FlatIssue } from "#/cli/shared/zod-issues";
import {
  type AppConfig,
  type ExecutorServiceInput,
  type HttpAdapterServiceInput,
  type LogLevel,
  type ResolverServiceInput,
  type WorkflowServiceConfig,
  type WorkspaceSettings,
} from "#/configure/config/types";
import { type AuthConfig } from "#/configure/services/auth/types";
import { type IdPConfig, type IdPOwnConfig } from "#/configure/services/idp/types";
import { type TailorDBReplicationDestinationConfig } from "#/configure/services/tailordb-replication/types";
import {
  type EnvOverrideService,
  mapEnvOverridesAsync,
  singleServiceKey,
} from "#/parser/app-config/config-export";
import { AIGatewaySchema } from "#/parser/service/aigateway/index";
import { AuthConfigSchema } from "#/parser/service/auth/index";
import { IdPSchema } from "#/parser/service/idp/index";
import { SecretsSchema } from "#/parser/service/secrets/index";
import { StaticWebsiteSchema } from "#/parser/service/staticwebsite/index";
import {
  bigQueryDatasetKey,
  replicationTableKey,
  TailorDBReplicationDestinationSchema,
} from "#/parser/service/tailordb-replication/index";
import { TailorDBServiceConfigSchema } from "#/parser/service/tailordb/index";
import { collectWaitPointKeyFailures } from "#/parser/service/workflow/wait-point-key";
import { KyselyGeneratorID } from "#/plugin/builtin/kysely-type/index";
import { readSecretEntry } from "#/utils/secret-entry";
import { getScopedWaitPoints } from "#/utils/wait-point-registry";
import type { BundleCache } from "#/cli/cache/bundle-cache";
import type { BundledScripts } from "#/cli/commands/deploy/function-registry-types";
import type { FunctionBundleSettings } from "#/cli/services/function-bundle";
import type { SdkBuilderAnnotationCache } from "#/cli/shared/sdk-builder-pure-plugin";
import type { ProjectSourcesFilter } from "#/cli/shared/sourcemap-sources";
import type { TailorDBServiceInput } from "#/configure/services/tailordb/types";
import type {
  TailorDBReplication,
  TailorDBReplicationType,
} from "#/parser/service/tailordb-replication/types";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { PluginManager } from "#/plugin/manager";
import type { EffectiveDateDefault } from "#/runtime/types";
import type { AIGateway, AIGatewayInput } from "#/types/aigateway.generated";
import type { IdP } from "#/types/idp.generated";
import type { StaticWebsite, StaticWebsiteInput } from "#/types/staticwebsite.generated";
import type {
  TailorDBReplicationDestination,
  TailorDBTypeReplication,
} from "#/types/tailordb-replication.generated";
import type { z } from "zod";

type SecretVault = {
  readonly vaultName: string;
  readonly secrets: ReadonlyArray<{
    name: string;
    value: string | null | undefined;
    createOnly: boolean;
  }>;
};

/** Settings of a `defineConfig()` or workspace config that its services share. */
export type ServiceSettings = Pick<
  LoadedConfig,
  "path" | keyof WorkspaceSettings | "db" | "resolver" | "workflow"
>;

/** `env` values each service uses in place of the root values with the same keys. */
export type EnvOverrides = LoadedWorkspaceConfig["envOverrides"];

/** The services a config defines, with the `env` they share. */
export type ConfigServices = {
  readonly tailorDBServices: ReadonlyArray<TailorDBService>;
  readonly externalTailorDBNamespaces: ReadonlyArray<string>;
  readonly resolverServices: ReadonlyArray<ResolverService>;
  readonly idpServices: ReadonlyArray<IdP>;
  /** Auth services the config defines, in config order. A `defineConfig()` config has at most one. */
  readonly authServices: ReadonlyArray<Readonly<AuthService>>;
  readonly executorService: Readonly<ExecutorService> | undefined;
  readonly workflowService: Readonly<WorkflowService> | undefined;
  readonly httpAdapterService: Readonly<HttpAdapterService> | undefined;
  readonly staticWebsiteServices: ReadonlyArray<StaticWebsite>;
  readonly aiGatewayServices: ReadonlyArray<AIGateway>;
  readonly dbReplicationDestinations: ReadonlyArray<TailorDBReplicationDestination>;
  readonly dbReplications: ReadonlyArray<TailorDBReplication>;
  readonly secrets: ReadonlyArray<SecretVault>;
  readonly ignoreNullishValues: boolean;
  readonly env: Readonly<Record<string, string | number | boolean>>;
};

/** The services a workspace config defines, with the settings they share and their `env` overrides. */
export type WorkspaceServices = ConfigServices & {
  readonly settings: ServiceSettings;
  readonly envOverrides: EnvOverrides;
};

export type Application = ConfigServices & {
  readonly name: string;
  readonly id: string | undefined;
  readonly config: AppConfig;
  readonly subgraphs: ReadonlyArray<{ Type: string; Name: string }>;
};

/**
 * Intermediate state from loading a config's services that carries no `env`
 * dependency, kept so a later call passing `previous` can rebundle only
 * workflow jobs and auth hooks without redoing this work.
 */
interface ReusableBuildState {
  readonly startContext: StartContext;
  readonly tsconfigCache: TsconfigLookupCache;
  readonly sdkBuilderAnnotationCache: SdkBuilderAnnotationCache;
  readonly inlineSourcemap: boolean;
  readonly inlineSourcemapDependencySources: boolean | string[];
  readonly inlineSourcemapProjectSources: ProjectSourcesFilter;
  readonly bundleLogLevel: LogLevel;
  readonly kyselyTemporal: boolean;
  readonly kyselyDecimal: boolean;
}

/**
 * Result of loading the application
 */
export interface LoadApplicationResult {
  /** Fully initialized application */
  application: Application;
  /** Workflow bundling result (if workflows were bundled) */
  workflowBuildResult?: BundleWorkflowJobsResult | undefined;
  /** HTTP adapter bundling result (if adapters were bundled) */
  httpAdapterBuildResult?: HttpAdapterBundleResult | undefined;
  /** In-memory bundled scripts organized by kind */
  bundledScripts: BundledScripts;
  /** State a later `previous`-driven reload reuses instead of recomputing. */
  reusableBuildState: ReusableBuildState;
}

const SERVICE_LABELS = {
  db: "TailorDB service",
  idp: "IdP",
  auth: "Auth service",
  staticWebsites: "static website",
  aiGateways: "AI Gateway",
  dbReplicationDestinations: "TailorDB replication destination",
  secrets: "secret manager",
} as const;

interface ServiceConfigTarget {
  /** Config file the service is defined in. */
  file: string;
  /** `defineConfig` property the service is configured under. */
  configKey: keyof typeof SERVICE_LABELS;
  /** The service's namespace or list index under `configKey`, when it has one. */
  key?: string | number | undefined;
  /** Service name, or the namespace for TailorDB. */
  name?: string | undefined;
}

function parseServiceConfig<Schema extends z.ZodType>(
  schema: Schema,
  config: unknown,
  target: ServiceConfigTarget,
): z.output<Schema> {
  const result = schema.safeParse(config);
  if (result.success) {
    return result.data;
  }
  const { file, configKey, key, name } = target;
  throw configInvalidError({
    file,
    exportName: "default",
    subject: `config for ${SERVICE_LABELS[configKey]}${name === undefined ? "" : ` "${name}"`}`,
    error: result.error,
    pathPrefix: key === undefined ? [configKey] : [configKey, key],
    service: { configKey, name },
  });
}

type DefineTailorDBResult = {
  tailorDBServices: TailorDBService[];
  externalTailorDBNamespaces: string[];
  subgraphs: Array<{ Type: string; Name: string }>;
};

function defineTailorDB(
  config: TailorDBServiceInput | undefined,
  configPath: string,
  baseDir: string,
  dateDefault: EffectiveDateDefault,
  pluginManager?: PluginManager,
  precompileScripts?: boolean,
): DefineTailorDBResult {
  const tailorDBServices: TailorDBService[] = [];
  const externalTailorDBNamespaces: string[] = [];
  const subgraphs: Array<{ Type: string; Name: string }> = [];

  if (!config) {
    return { tailorDBServices, externalTailorDBNamespaces, subgraphs };
  }

  for (const [namespace, serviceConfig] of Object.entries(config)) {
    if ("external" in serviceConfig) {
      externalTailorDBNamespaces.push(namespace);
    } else {
      // Parse config through schema to normalize gqlOperations
      const parsedConfig = parseServiceConfig(TailorDBServiceConfigSchema, serviceConfig, {
        file: configPath,
        configKey: "db",
        key: namespace,
        name: namespace,
      });
      const tailorDB = createTailorDBService({
        namespace,
        config: parsedConfig,
        pluginManager,
        baseDir,
        dateDefault,
        precompileScripts,
      });
      tailorDBServices.push(tailorDB);
    }
    subgraphs.push({ Type: "tailordb", Name: namespace });
  }

  return { tailorDBServices, externalTailorDBNamespaces, subgraphs };
}

type DefineResolverResult = {
  resolverServices: ResolverService[];
  subgraphs: Array<{ Type: string; Name: string }>;
};

function pluginResolverSource(
  outputKey: string,
  pluginManager: PluginManager | undefined,
): PluginResolverSource | undefined {
  return pluginManager && { pluginManager, outputKey };
}

function pluginResolverOutputKey(config: LoadedConfig | LoadedWorkspaceConfig): string {
  return isLoadedWorkspaceConfig(config) ? path.relative(getDistDir(), config.path) : config.name;
}

function defineResolver(
  config: ResolverServiceInput | undefined,
  configPath: string,
  baseDir: string,
  plugins: PluginResolverSource | undefined,
): DefineResolverResult {
  const resolverServices: ResolverService[] = [];
  const subgraphs: Array<{ Type: string; Name: string }> = [];

  if (!config) {
    return { resolverServices, subgraphs };
  }

  for (const [namespace, serviceConfig] of Object.entries(config)) {
    if (!("external" in serviceConfig)) {
      const resolverService = createResolverService({
        namespace,
        config: serviceConfig,
        configPath,
        baseDir,
        plugins,
      });
      resolverServices.push(resolverService);
    }
    subgraphs.push({ Type: "pipeline", Name: namespace });
  }

  return { resolverServices, subgraphs };
}

/**
 * Define resolver services for namespaces that plugins generate resolvers into without a `resolver` entry.
 * A workspace config must declare those namespaces, so for one this reports every undeclared namespace instead.
 * Call after table and namespace plugins have run.
 * @param config - Loaded `defineConfig()` or workspace config the plugins belong to
 * @param pluginManager - Plugin manager holding the generated resolvers
 * @returns Resolver services for those namespaces
 */
export function definePluginResolverServices(
  config: LoadedConfig | LoadedWorkspaceConfig,
  pluginManager: PluginManager | undefined,
): ResolverService[] {
  const baseDir = path.dirname(config.path);
  const resolverServices: ResolverService[] = [];
  const undeclared = new Map<string, string[]>();
  for (const { namespace, pluginId } of pluginManager?.getPluginGeneratedResolvers() ?? []) {
    const serviceConfig = config.resolver?.[namespace];
    if (serviceConfig && "external" in serviceConfig) {
      throw CLIError({
        code: "PLUGIN_RESOLVER_NAMESPACE_EXTERNAL",
        message: `Plugin "${pluginId}" cannot generate resolvers in external namespace "${namespace}".`,
        context: { pluginId, namespace, resourceType: "pipeline.service" },
      });
    }
    if (serviceConfig || resolverServices.some((service) => service.namespace === namespace)) {
      continue;
    }
    if (isLoadedWorkspaceConfig(config)) {
      const pluginIds = undeclared.get(namespace) ?? [];
      if (!pluginIds.includes(pluginId)) pluginIds.push(pluginId);
      undeclared.set(namespace, pluginIds);
      continue;
    }
    resolverServices.push(
      createResolverService({
        namespace,
        config: { files: [] },
        configPath: config.path,
        baseDir,
        plugins: pluginResolverSource(pluginResolverOutputKey(config), pluginManager),
      }),
    );
  }
  if (isLoadedWorkspaceConfig(config) && undeclared.size > 0) {
    throw undeclaredPluginResolverNamespacesError(config, undeclared);
  }
  return resolverServices;
}

function undeclaredPluginResolverNamespacesError(
  workspace: LoadedWorkspaceConfig,
  pluginIdsByNamespace: ReadonlyMap<string, readonly string[]>,
) {
  const namespaces = [...pluginIdsByNamespace].map(([namespace, pluginIds]) => ({
    namespace,
    pluginIds,
  }));
  const quoted = (names: readonly string[]) => names.map((name) => `"${name}"`).join(", ");
  const example = `resolver: { ${JSON.stringify(namespaces[0]?.namespace)}: { files: [] } }`;
  return CLIError({
    code: "PLUGIN_RESOLVER_NAMESPACE_UNDECLARED",
    message: `Plugins generate resolvers into resolver namespaces this config does not declare: ${namespaces
      .map(
        ({ namespace, pluginIds }) =>
          `"${namespace}" (${pluginIds.length === 1 ? "plugin" : "plugins"} ${quoted(pluginIds)})`,
      )
      .join(", ")}.`,
    suggestion:
      workspace.definedBy === "defineApp"
        ? `Declare each namespace under "resolver", e.g. ${example}.`
        : `Declare each namespace under "resolver", e.g. ${example}, and list it in the "resolver" of the apps that expose it.`,
    context: { resourceType: "pipeline.service", namespaces },
  });
}

type DefineIdpResult = {
  idpServices: IdP[];
  subgraphs: Array<{ Type: string; Name: string }>;
};

function stripIdpProviderHelper(idpConfig: IdPOwnConfig): IdPOwnConfig {
  const configWithProvider = idpConfig as IdPOwnConfig & { provider?: unknown };
  if (typeof configWithProvider.provider !== "function") return idpConfig;
  const { provider: _provider, ...config } = configWithProvider;
  return config;
}

/** A service configured in a config, with its key under the service's config property, when it has one. */
interface ServiceEntry<Config, Key extends string | number = string | number> {
  config: Config;
  key?: Key | undefined;
}

function defineIdp(
  entries: ReadonlyArray<ServiceEntry<IdPConfig>>,
  configPath: string,
): DefineIdpResult {
  const idpServices: IdP[] = [];
  const subgraphs: Array<{ Type: string; Name: string }> = [];

  assertUniqueDefinitionNames({
    kind: "idp",
    definitions: entries
      .map(({ config, key }) => ({
        name: config.name,
        file: configPath,
        exportName: "default",
        path: key === undefined ? ["idp"] : ["idp", key],
      }))
      .filter((definition) => typeof definition.name === "string"),
  });
  for (const { config, key } of entries) {
    const name = config.name;
    if (!("external" in config)) {
      const idp = parseServiceConfig(IdPSchema, stripIdpProviderHelper(config), {
        file: configPath,
        configKey: "idp",
        key,
        name,
      });
      idpServices.push(idp);
    }
    subgraphs.push({ Type: "idp", Name: name });
  }

  return { idpServices, subgraphs };
}

type DefineAuthResult = {
  authServices: AuthService[];
  subgraphs: Array<{ Type: string; Name: string }>;
};

function defineAuth(
  entries: ReadonlyArray<ServiceEntry<AuthConfig>>,
  configPath: string,
  tailorDBServices: ReadonlyArray<TailorDBService>,
  externalTailorDBNamespaces: ReadonlyArray<string>,
): DefineAuthResult {
  const authServices: AuthService[] = [];
  const subgraphs: Array<{ Type: string; Name: string }> = [];

  for (const { config, key } of entries) {
    if (!("external" in config)) {
      authServices.push(
        createAuthService(
          parseServiceConfig(AuthConfigSchema, config, {
            file: configPath,
            configKey: "auth",
            key,
            name: config.name,
          }),
          tailorDBServices,
          externalTailorDBNamespaces,
          configPath,
          key === undefined ? ["auth"] : ["auth", key],
        ),
      );
    }
    subgraphs.push({ Type: "auth", Name: config.name });
  }

  return { authServices, subgraphs };
}

function defineExecutor(
  config: ExecutorServiceInput | undefined,
  baseDir: string,
  hasPluginExecutors: boolean,
): ExecutorService | undefined {
  if (!config && !hasPluginExecutors) {
    return undefined;
  }
  return createExecutorService({ config: config ?? { files: [] }, baseDir });
}

function defineWorkflow(
  config: WorkflowServiceConfig | undefined,
  baseDir: string,
): WorkflowService | undefined {
  if (!config) {
    return undefined;
  }
  return createWorkflowService({ config, baseDir });
}

function defineHttpAdapterService(
  config: HttpAdapterServiceInput | undefined,
  baseDir: string,
): HttpAdapterService | undefined {
  if (!config) {
    return undefined;
  }
  return createHttpAdapterService({ config, baseDir });
}

function stripStaticWebsiteUrlHelper(config: StaticWebsiteInput): StaticWebsiteInput {
  const configWithUrl = config as StaticWebsiteInput & { url?: unknown };
  if (configWithUrl.url !== `${config.name}:url`) return config;
  const { url: _url, ...websiteConfig } = configWithUrl;
  return websiteConfig;
}

function defineStaticWebsites(
  websites: readonly StaticWebsiteInput[] | undefined,
  configPath: string,
): StaticWebsite[] {
  const staticWebsiteServices: StaticWebsite[] = [];
  assertUniqueDefinitionNames({
    kind: "staticwebsite",
    definitions: (websites ?? [])
      .map(({ name }, index) => ({
        name,
        file: configPath,
        exportName: "default",
        path: ["staticWebsites", index],
      }))
      .filter((definition) => typeof definition.name === "string"),
  });

  (websites ?? []).forEach((config, index) => {
    const website = parseServiceConfig(StaticWebsiteSchema, stripStaticWebsiteUrlHelper(config), {
      file: configPath,
      configKey: "staticWebsites",
      key: index,
      name: config.name,
    });
    staticWebsiteServices.push(website);
  });

  return staticWebsiteServices;
}

function defineAIGateways(
  gateways: readonly AIGatewayInput[] | undefined,
  configPath: string,
  authNamespaces: readonly string[],
): AIGateway[] {
  const aiGatewayServices: AIGateway[] = [];
  assertUniqueDefinitionNames({
    kind: "aigateway",
    definitions: (gateways ?? [])
      .map(({ name }, index) => ({
        name,
        file: configPath,
        exportName: "default",
        path: ["aiGateways", index],
      }))
      .filter((definition) => typeof definition.name === "string"),
  });

  (gateways ?? []).forEach((config, index) => {
    const gateway = parseServiceConfig(AIGatewaySchema, config, {
      file: configPath,
      configKey: "aiGateways",
      key: index,
      name: config.name,
    });
    if (gateway.authNamespace === undefined) {
      const [authNamespace, ...others] = authNamespaces;
      if (authNamespace === undefined || others.length > 0) {
        const issue =
          authNamespace === undefined
            ? {
                message: "No Auth service is configured to default to",
                suggestion: 'Define an Auth service, or set "authNamespace" explicitly.',
              }
            : {
                message: `Several Auth services are configured (${authNamespaces.join(", ")}), so there is none to default to`,
                suggestion: 'Set "authNamespace" to one of the Auth services.',
              };
        throw configIssuesError({
          file: configPath,
          exportName: "default",
          subject: "Tailor config",
          service: { configKey: "aiGateways", name: gateway.name },
          issues: [{ path: ["aiGateways", index, "authNamespace"], message: issue.message }],
          suggestion: issue.suggestion,
        });
      }
      gateway.authNamespace = authNamespace;
    }
    aiGatewayServices.push(gateway);
  });

  return aiGatewayServices;
}

type DefineTailorDBReplicationsResult = {
  dbReplicationDestinations: TailorDBReplicationDestination[];
  dbReplications: TailorDBReplication[];
};

function replicationsPath(namespace: string): FlatIssue["path"] {
  return ["db", namespace, "replications"];
}

function throwReplicationIssues(
  configPath: string,
  issues: FlatIssue[],
  suggestion?: string | undefined,
): void {
  if (issues.length === 0) return;
  throw configIssuesError({
    file: configPath,
    exportName: "default",
    subject: "Tailor config",
    issues,
    suggestion,
  });
}

/**
 * Collect the replications the TailorDB namespaces declare and the destinations they and
 * `dbReplicationDestinations` deploy. Each replication's tables are filled in once the tables
 * are loaded, by {@link resolveTailorDBReplicationTypes}.
 * @param source - The config's service declarations
 * @param tailorDBServices - TailorDB namespaces of the config, with their parsed settings
 * @returns Destinations and replications, each replication without tables
 */
function defineTailorDBReplications(
  source: ServiceSource,
  tailorDBServices: ReadonlyArray<TailorDBService>,
): DefineTailorDBReplicationsResult {
  const configPath = source.settings.path;
  const issues: FlatIssue[] = [];
  const declaredDestinations: Array<{ input: unknown; path: FlatIssue["path"] }> =
    source.dbReplicationDestinations.map((input, index) => ({
      input,
      path: ["dbReplicationDestinations", index],
    }));
  const dbReplications: TailorDBReplication[] = [];
  const namespaceOfReplication = new Map<string, string>();
  for (const service of tailorDBServices) {
    for (const [name, settings] of Object.entries(service.config.replications ?? {})) {
      if (!settings) continue;
      const path = [...replicationsPath(service.namespace), name];
      const other = namespaceOfReplication.get(name);
      if (other !== undefined) {
        issues.push({
          path,
          message: `Replication "${name}" is also declared by TailorDB namespace "${other}"; replication names are unique across the workspace`,
        });
        continue;
      }
      namespaceOfReplication.set(name, service.namespace);
      declaredDestinations.push({ input: settings.destination, path: [...path, "destination"] });
      dbReplications.push({
        name,
        source: { namespace: service.namespace },
        destination: settings.destination.name,
        ...(settings.tablePrefix !== undefined && { tablePrefix: settings.tablePrefix }),
        enabled: settings.enabled,
        types: [],
      });
    }
  }

  const destinationsByName = new Map<
    string,
    { destination: TailorDBReplicationDestination; path: FlatIssue["path"] }
  >();
  for (const { input, path } of declaredDestinations) {
    const result = TailorDBReplicationDestinationSchema.safeParse(input);
    if (!result.success) {
      throw configInvalidError({
        file: configPath,
        exportName: "default",
        subject: "config for TailorDB replication destination",
        error: result.error,
        pathPrefix: path,
      });
    }
    const destination = result.data;
    const known = destinationsByName.get(destination.name);
    if (!known) {
      destinationsByName.set(destination.name, { destination, path });
    } else if (
      bigQueryDatasetKey(known.destination.bigquery) !== bigQueryDatasetKey(destination.bigquery)
    ) {
      issues.push({ path, message: `Two different destinations are named "${destination.name}"` });
    }
  }
  const destinationByDataset = new Map<string, string>();
  destinationsByName.forEach(({ destination, path }) => {
    const other = destinationByDataset.get(bigQueryDatasetKey(destination.bigquery));
    if (other !== undefined) {
      issues.push({
        path: [...path, "bigquery"],
        message: `Destination "${destination.name}" writes to the same dataset as destination "${other}"`,
      });
    }
    destinationByDataset.set(bigQueryDatasetKey(destination.bigquery), destination.name);
  });
  throwReplicationIssues(configPath, issues);
  return {
    dbReplicationDestinations: [...destinationsByName.values()].map(
      ({ destination }) => destination,
    ),
    dbReplications,
  };
}

function checkReplicatedFields(
  type: TailorDBType,
  entry: TailorDBTypeReplication,
  path: FlatIssue["path"],
): FlatIssue[] {
  return (["excludeFields", "includeFields"] as const).flatMap((listKey) =>
    (entry[listKey] ?? []).flatMap((fieldName, index) => {
      const field = fieldName === "id" ? undefined : type.fields[fieldName];
      if (!field) {
        return [
          {
            path: [...path, listKey, index],
            message: `Table "${type.name}" has no field "${fieldName}" to replicate`,
          },
        ];
      }
      if (listKey === "includeFields" && field.config.vector) {
        return [
          {
            path: [...path, listKey, index],
            message: `Field "${type.name}.${fieldName}" is a vector field, which is not replicated`,
          },
        ];
      }
      return [];
    }),
  );
}

function replicationTypeOf(name: string, entry: TailorDBTypeReplication): TailorDBReplicationType {
  return {
    name,
    ...(entry.excludeFields && { excludeFields: entry.excludeFields }),
    ...(entry.includeFields && { includeFields: entry.includeFields }),
  };
}

const PLUGIN_TABLES_KEY_SUGGESTION =
  "Key pluginTables by the names of tables that plugins generate in the namespace, and replicate a table you define with .replication() on it.";

type PluginTableTypesParams = {
  service: TailorDBService;
  replicationName: string;
  pluginTables: Record<string, TailorDBTypeReplication>;
};

type PluginTableTypes = {
  types: TailorDBReplicationType[];
  keyIssues: FlatIssue[];
  fieldIssues: FlatIssue[];
};

/**
 * Collect the tables a replication's `pluginTables` lists, and check that each key names a table
 * a plugin generates in the namespace and that its fields exist.
 * @param params - The namespace, the replication's name, and its `pluginTables`
 * @returns The tables to copy, issues with the keys, and issues with the fields
 */
function pluginTableTypes(params: PluginTableTypesParams): PluginTableTypes {
  const { service, replicationName, pluginTables } = params;
  const { namespace, typeSourceInfo } = service;
  const generated = Object.entries(typeSourceInfo).flatMap(([name, source]) =>
    source.pluginId === undefined ? [] : [`"${name}"`],
  );
  const result: PluginTableTypes = { types: [], keyIssues: [], fieldIssues: [] };
  for (const [name, entry] of Object.entries(pluginTables)) {
    const path = [...replicationsPath(namespace), replicationName, "pluginTables", name];
    const source = typeSourceInfo[name];
    const type = service.types[name];
    if (source?.pluginId === undefined || !type) {
      result.keyIssues.push({
        path,
        message: `${source ? `Table "${name}" is not generated by a plugin` : `No plugin generates table "${name}" in TailorDB namespace "${namespace}"`} (plugin-generated tables: ${generated.join(", ") || "none"})`,
      });
      continue;
    }
    result.fieldIssues.push(...checkReplicatedFields(type, entry, path));
    result.types.push(replicationTypeOf(name, entry));
  }
  return result;
}

type ResolveTailorDBReplicationTypesParams = {
  configPath: string;
  replications: DefineTailorDBReplicationsResult;
  tailorDBServices: ReadonlyArray<TailorDBService>;
};

/**
 * Fill in the tables each replication copies, from the `.replication()` of the namespace's
 * loaded tables and the replication's `pluginTables`, and check what those declare.
 * @param params - Replications without tables, and the loaded TailorDB namespaces
 * @returns The replications with their tables
 */
function resolveTailorDBReplicationTypes(
  params: ResolveTailorDBReplicationTypesParams,
): DefineTailorDBReplicationsResult {
  const { configPath, replications, tailorDBServices } = params;
  const issues: FlatIssue[] = [];
  let suggestion: string | undefined;
  const typesByReplication = new Map<string, TailorDBReplicationType[]>(
    replications.dbReplications.map(({ name }) => [name, []]),
  );
  for (const service of tailorDBServices) {
    const declared = Object.keys(service.config.replications ?? {});
    const deployed = replications.dbReplications
      .filter(({ source }) => source.namespace === service.namespace)
      .map(({ name }) => name);
    for (const type of Object.values(service.types)) {
      const targeted = new Set<string>();
      (type.replication ?? []).forEach((entry, index) => {
        const path = ["db", service.namespace, "tables", type.name, "replication", index];
        const fieldIssues = checkReplicatedFields(type, entry, path);
        issues.push(...fieldIssues);
        const unknown = (entry.targets ?? []).filter((target) => !declared.includes(target));
        for (const target of unknown) {
          issues.push({
            path: [...path, "targets"],
            message: `Table "${type.name}" names replication "${target}", which TailorDB namespace "${service.namespace}" does not declare in replications`,
          });
        }
        for (const target of entry.targets ?? declared) {
          if (targeted.has(target)) {
            issues.push({
              path,
              message: `Table "${type.name}" sets replication "${target}" more than once`,
            });
          }
          targeted.add(target);
        }
        if (fieldIssues.length > 0 || unknown.length > 0) return;
        for (const target of entry.targets ?? deployed) {
          typesByReplication.get(target)?.push(replicationTypeOf(type.name, entry));
        }
      });
    }
    for (const [name, settings] of Object.entries(service.config.replications ?? {})) {
      if (!settings?.pluginTables) continue;
      const result = pluginTableTypes({
        service,
        replicationName: name,
        pluginTables: settings.pluginTables,
      });
      if (result.keyIssues.length > 0) suggestion = PLUGIN_TABLES_KEY_SUGGESTION;
      issues.push(...result.keyIssues, ...result.fieldIssues);
      typesByReplication.get(name)?.push(...result.types);
    }
  }
  throwReplicationIssues(configPath, issues, suggestion);
  const dbReplications = replications.dbReplications.map((replication) => ({
    ...replication,
    types: typesByReplication.get(replication.name) ?? [],
  }));
  throwReplicationIssues(configPath, sharedReplicationTableIssues(dbReplications));
  return {
    dbReplicationDestinations: replications.dbReplicationDestinations,
    dbReplications,
  };
}

function sharedReplicationTableIssues(
  dbReplications: ReadonlyArray<TailorDBReplication>,
): FlatIssue[] {
  const writers = new Map<string, string>();
  return dbReplications.flatMap((replication) =>
    replication.types.flatMap((type) => {
      const table = replicationTableKey(replication.tablePrefix, type.name);
      const key = `${replication.destination}/${table}`;
      const other = writers.get(key);
      writers.set(key, replication.name);
      if (other === undefined || other === replication.name) return [];
      return [
        {
          path: [...replicationsPath(replication.source.namespace), replication.name],
          message: `Replications "${other}" and "${replication.name}" both write table "${table}" of destination "${replication.destination}"; give one of them a different tablePrefix`,
        },
      ];
    }),
  );
}

function parseSecretManager(
  config: AppConfig["secrets"],
  configPath: string,
): {
  secrets: SecretVault[];
  ignoreNullishValues: boolean;
} {
  if (!config) {
    return { secrets: [], ignoreNullishValues: false };
  }

  const parsed = parseServiceConfig(SecretsSchema, config, {
    file: configPath,
    configKey: "secrets",
  });
  const { ignoreNullishValues } = parsed.options;

  const secrets = Object.entries(parsed.vaults).map(([vaultName, vaultSecrets]) => ({
    vaultName,
    secrets: Object.entries(vaultSecrets).map(([name, entry]) => ({
      name,
      ...readSecretEntry(entry),
    })),
  }));

  // Defensive check: error if nullish values exist without ignoreNullishValues
  if (!ignoreNullishValues) {
    const issues = secrets.flatMap((vault) =>
      vault.secrets
        .filter((secret) => secret.value == null)
        .map((secret) => ({
          path: ["secrets", "vaults", vault.vaultName, secret.name],
          message: "Has no value",
        })),
    );
    if (issues.length > 0) {
      throw configIssuesError({
        file: configPath,
        exportName: "default",
        subject: "Tailor config",
        service: { configKey: "secrets" },
        issues,
        suggestion:
          "Use the { ignoreNullishValues: true } option in defineSecretManager() to skip secrets without values.",
      });
    }
  }

  return { secrets, ignoreNullishValues };
}

type DefineServicesResult = {
  replicationResult: DefineTailorDBReplicationsResult;
  tailordbResult: DefineTailorDBResult;
  resolverResult: DefineResolverResult;
  idpResult: DefineIdpResult;
  authResult: DefineAuthResult;
  staticWebsiteServices: StaticWebsite[];
  aiGatewayServices: AIGateway[];
  secrets: SecretVault[];
  ignoreNullishValues: boolean;
};

/** The service declarations of a `defineConfig()` or workspace config, in one shape. */
interface ServiceSource {
  settings: ServiceSettings;
  pluginResolverOutputKey: string;
  idps: ReadonlyArray<ServiceEntry<IdPConfig>>;
  auths: ReadonlyArray<ServiceEntry<AuthConfig, string>>;
  dbReplicationDestinations: ReadonlyArray<TailorDBReplicationDestinationConfig>;
}

function configServiceSource(config: LoadedConfig): ServiceSource {
  return {
    settings: config,
    pluginResolverOutputKey: pluginResolverOutputKey(config),
    idps: idpConfigList(config.idp).map((idp, index) => ({
      config: idp,
      key: isIdpConfigList(config.idp) ? index : undefined,
    })),
    auths: config.auth ? [{ config: config.auth }] : [],
    dbReplicationDestinations: config.dbReplicationDestinations ?? [],
  };
}

function workspaceServiceSource(workspace: LoadedWorkspaceConfig): ServiceSource {
  return {
    settings: workspace,
    pluginResolverOutputKey: pluginResolverOutputKey(workspace),
    idps: Object.entries(workspace.idp).map(([name, idp]) => ({
      config: idp,
      key: singleServiceKey(workspace.definedBy, name),
    })),
    auths: Object.entries(workspace.auth).map(([name, auth]) => ({
      config: auth,
      key: singleServiceKey(workspace.definedBy, name),
    })),
    dbReplicationDestinations: [],
  };
}

function defineServices(
  source: ServiceSource,
  baseDir: string,
  pluginManager?: PluginManager,
  precompileTailorDBScripts?: boolean,
): DefineServicesResult {
  const { settings } = source;
  const tailordbResult = defineTailorDB(
    settings.db,
    settings.path,
    baseDir,
    effectiveDateDefault(settings),
    pluginManager,
    precompileTailorDBScripts,
  );
  const resolverResult = defineResolver(
    settings.resolver,
    settings.path,
    baseDir,
    pluginResolverSource(source.pluginResolverOutputKey, pluginManager),
  );
  const idpResult = defineIdp(source.idps, settings.path);
  const authResult = defineAuth(
    source.auths,
    settings.path,
    tailordbResult.tailorDBServices,
    tailordbResult.externalTailorDBNamespaces,
  );
  const staticWebsiteServices = defineStaticWebsites(settings.staticWebsites, settings.path);
  const aiGatewayServices = defineAIGateways(
    settings.aiGateways,
    settings.path,
    source.auths.map(({ config }) => config.name),
  );
  const { secrets, ignoreNullishValues } = parseSecretManager(settings.secrets, settings.path);
  return {
    replicationResult: defineTailorDBReplications(source, tailordbResult.tailorDBServices),
    tailordbResult,
    resolverResult,
    idpResult,
    authResult,
    staticWebsiteServices,
    aiGatewayServices,
    secrets,
    ignoreNullishValues: ignoreNullishValues,
  };
}

interface BuildConfigServicesParams extends DefineServicesResult {
  executorService: ExecutorService | undefined;
  workflowService: WorkflowService | undefined;
  httpAdapterService: HttpAdapterService | undefined;
  env: Record<string, string | number | boolean>;
}

function buildConfigServices(params: BuildConfigServicesParams): ConfigServices {
  return {
    tailorDBServices: params.tailordbResult.tailorDBServices,
    externalTailorDBNamespaces: params.tailordbResult.externalTailorDBNamespaces,
    resolverServices: params.resolverResult.resolverServices,
    idpServices: params.idpResult.idpServices,
    authServices: params.authResult.authServices,
    executorService: params.executorService,
    workflowService: params.workflowService,
    httpAdapterService: params.httpAdapterService,
    staticWebsiteServices: params.staticWebsiteServices,
    aiGatewayServices: params.aiGatewayServices,
    dbReplicationDestinations: params.replicationResult.dbReplicationDestinations,
    dbReplications: params.replicationResult.dbReplications,
    secrets: params.secrets,
    ignoreNullishValues: params.ignoreNullishValues,
    env: params.env,
  };
}

interface BuildApplicationParams extends BuildConfigServicesParams {
  config: LoadedConfig;
}

function buildApplication(params: BuildApplicationParams): Application {
  return {
    ...buildConfigServices(params),
    name: params.config.name,
    id: params.config.id,
    config: params.config,
    subgraphs: [
      ...params.tailordbResult.subgraphs,
      ...params.resolverResult.subgraphs,
      ...params.idpResult.subgraphs,
      ...params.authResult.subgraphs,
    ],
  };
}

/**
 * Parameters for defining an application
 */
export interface DefineApplicationParams {
  /** Application configuration object (must be loaded via loadConfig) */
  config: LoadedConfig;
  /** Plugin manager for processing plugins */
  pluginManager?: PluginManager | undefined;
  /** Optional bundle cache for skipping unchanged builds */
  bundleCache?: BundleCache | undefined;
  /** Bundle each TailorDB table's hook and validator scripts while loading. Defaults to `true`; turn it off when only the table definitions are read. */
  precompileTailorDBScripts?: boolean | undefined;
}

/**
 * Parameters for loading and bundling an application
 */
export interface LoadApplicationParams extends DefineApplicationParams {
  /**
   * Operator client used to resolve `name:url` static website placeholders in
   * `env` before it is bundled into resolver, executor, workflow, and auth
   * hook code. Omit to skip resolution (e.g. `--build-only`, which never
   * reaches the platform); `env` then keeps any unresolved placeholder.
   */
  client?: OperatorClient | undefined;
  /** Workspace ID paired with `client`. */
  workspaceId?: string | undefined;
  /**
   * Static website names planned by any config in the same deploy run. An
   * unresolved placeholder naming one of these is kept (with a warning
   * explaining that this run's rebuild will resolve it once the website
   * exists), instead of the warning used for a name outside this set.
   */
  expectedLocalStaticWebsiteNames?: ReadonlySet<string> | undefined;
  /**
   * A prior `loadApplication` result for this same config. When present,
   * everything independent of `env` (config parsing, TailorDB loading,
   * plugin execution, and the resolver/executor/HTTP-adapter bundles) is
   * reused as-is, and only `env` resolution plus the workflow-job and
   * auth-hook bundles that embed it are redone -- the two kinds of bundled
   * code that actually change when `env` newly resolves to a static
   * website's URL.
   */
  previous?: LoadApplicationResult | undefined;
}

/**
 * Define a Tailor application from the given configuration.
 * This is a lightweight, synchronous function that creates the application
 * structure without loading tables or bundling files.
 * @param params - Parameters for defining the application
 * @returns Configured application instance
 */
export function defineApplication(params: DefineApplicationParams): Application {
  const { config, pluginManager, precompileTailorDBScripts } = params;
  const baseDir = path.dirname(config.path);
  const services = defineServices(
    configServiceSource(config),
    baseDir,
    pluginManager,
    precompileTailorDBScripts,
  );
  // Plugin executors are not known at define-time; generate/apply flows handle them after table loading.
  const executorService = defineExecutor(config.executor, baseDir, false);
  const workflowService = defineWorkflow(config.workflow, baseDir);
  const httpAdapterService = defineHttpAdapterService(config.httpAdapter, baseDir);

  return buildApplication({
    config,
    ...services,
    executorService,
    workflowService,
    httpAdapterService,
    env: config.env ?? {},
  });
}

/**
 * Parameters for defining the services of a workspace
 */
export interface DefineWorkspaceServicesParams extends Pick<
  DefineApplicationParams,
  "pluginManager" | "precompileTailorDBScripts"
> {
  /** Workspace loaded from a `defineWorkspace()` or `defineApp()` config */
  workspace: LoadedWorkspaceConfig;
}

/**
 * Define every service a workspace declares, whether or not an application exposes it.
 * Like {@link defineApplication}, this loads no tables and bundles no files.
 * @param params - Parameters for defining the services
 * @returns The workspace's services
 */
export function defineWorkspaceServices(params: DefineWorkspaceServicesParams): WorkspaceServices {
  const { workspace, pluginManager, precompileTailorDBScripts } = params;
  const baseDir = path.dirname(workspace.path);
  const services = defineServices(
    workspaceServiceSource(workspace),
    baseDir,
    pluginManager,
    precompileTailorDBScripts,
  );
  return {
    ...buildConfigServices({
      ...services,
      executorService: defineExecutor(workspace.executor, baseDir, false),
      workflowService: defineWorkflow(workspace.workflow, baseDir),
      httpAdapterService: defineHttpAdapterService(workspace.httpAdapter, baseDir),
      env: workspace.env,
    }),
    settings: workspace,
    envOverrides: workspace.envOverrides,
  };
}

/**
 * Generate plugin table and executor files if a plugin manager is provided.
 * Collects source table info from TailorDB services and delegates to PluginManager.
 * @param pluginManager - Plugin manager instance (skips if undefined)
 * @param tailorDBServices - TailorDB services to collect table source info from
 * @param configPath - Path to tailor.config.ts for resolving plugin imports
 * @returns Generated executor file paths
 */
export function generatePluginFilesIfNeeded(
  pluginManager: PluginManager | undefined,
  tailorDBServices: ReadonlyArray<TailorDBService>,
  configPath: string,
): string[] {
  if (!pluginManager) return [];

  const sourceTableInfoMap = new Map<string, { filePath: string; exportName: string }>();
  for (const db of tailorDBServices) {
    const tableSourceInfo = db.typeSourceInfo;
    for (const [tableName, sourceInfo] of Object.entries(tableSourceInfo)) {
      if (sourceInfo.filePath) {
        sourceTableInfoMap.set(tableName, {
          filePath: sourceInfo.filePath,
          exportName: sourceInfo.exportName,
        });
      }
    }
  }

  return pluginManager.generatePluginFiles({
    outputDir: path.join(getDistDir(), "plugin"),
    sourceTableInfoMap,
    configPath,
    tableGenerator: generatePluginTableFiles,
    executorGenerator: generatePluginExecutorFiles,
  });
}

function assertWaitPointKeys(): void {
  const failures = collectWaitPointKeyFailures(getScopedWaitPoints());
  if (failures.length === 0) return;
  throw CLIError({
    code: "WORKFLOW_WAIT_POINT_KEY_INVALID",
    message: failures.join("\n"),
    context: { failures },
  });
}

/** What loading reads from a `defineConfig()` or workspace config besides its service declarations. */
interface LoadSource extends ServiceSource {
  config: LoadedConfig | LoadedWorkspaceConfig;
  executor: ExecutorServiceInput | undefined;
  env: ApplicationEnv;
  envOverrides: EnvOverrides;
}

/** The `env` overrides of a `defineConfig()` config, which has none. */
export const NO_ENV_OVERRIDES: EnvOverrides = { resolver: {}, auth: {} };

function loadSourceOf(config: LoadedConfig | LoadedWorkspaceConfig): LoadSource {
  if (isLoadedWorkspaceConfig(config)) {
    return {
      ...workspaceServiceSource(config),
      config,
      executor: config.executor,
      env: config.env,
      envOverrides: config.envOverrides,
    };
  }
  return {
    ...configServiceSource(config),
    config,
    executor: config.executor,
    env: config.env ?? {},
    envOverrides: NO_ENV_OVERRIDES,
  };
}

interface ResolveEnvParams {
  source: LoadSource;
  client: OperatorClient | undefined;
  workspaceId: string | undefined;
  expectedLocalNames: ReadonlySet<string>;
}

interface ResolvedEnv {
  env: ApplicationEnv;
  envOverrides: EnvOverrides;
}

function serviceEnv(resolved: ResolvedEnv, service: EnvOverrideService): ApplicationEnv {
  const { env, envOverrides } = resolved;
  const override =
    service.kind === "resolver" || service.kind === "auth"
      ? envOverrides[service.kind][service.name]
      : envOverrides[service.kind];
  return override ? { ...env, ...override } : env;
}

async function resolveEnv(params: ResolveEnvParams): Promise<ResolvedEnv> {
  const { source, client, workspaceId, expectedLocalNames } = params;
  if (!client || !workspaceId) {
    return { env: source.env, envOverrides: source.envOverrides };
  }
  const siteLookupCache = new Map<string, ReturnType<OperatorClient["getStaticWebsite"]>>();
  const resolve = (env: ApplicationEnv, service?: string) =>
    resolveStaticWebsiteUrlsInEnv(client, workspaceId, env, {
      expectedLocalNames,
      siteLookupCache,
      service,
    });
  const [env, envOverrides] = await Promise.all([
    resolve(source.env),
    mapEnvOverridesAsync(source.envOverrides, (env, service) =>
      resolve(env, envOverrideServiceLabel(service)),
    ),
  ]);
  return { env, envOverrides };
}

function envOverrideServiceLabel(service: EnvOverrideService): string {
  switch (service.kind) {
    case "resolver":
      return `resolver namespace "${service.name}"`;
    case "auth":
      return `Auth service "${service.name}"`;
    case "executor":
    case "workflow":
      return service.kind;
  }
}

/**
 * How a config's workflow `.start()` calls resolve a string invoker: the config's only Auth
 * service, or, with several, the Auth services that define each machine user.
 * @param config - Loaded config of either kind
 * @returns The start context's Auth namespace and machine user lookup
 */
export function startContextAuth(
  config: LoadedConfig | LoadedWorkspaceConfig,
): Pick<StartContext, "authNamespace" | "machineUserAuthNamespaces"> {
  const source = loadSourceOf(config);
  return {
    authNamespace: startContextAuthNamespace(source),
    ...startContextMachineUsers(source),
  };
}

function startContextAuthNamespace(source: LoadSource): string | undefined {
  const [auth, ...others] = source.auths;
  return auth && others.length === 0 ? auth.config.name : undefined;
}

function startContextMachineUsers(
  source: LoadSource,
): Pick<StartContext, "machineUserAuthNamespaces"> {
  if (source.auths.length < 2) return {};
  const machineUserAuthNamespaces = new Map<string, string[]>();
  for (const { config } of source.auths) {
    const machineUsers = "machineUsers" in config ? config.machineUsers : undefined;
    for (const machineUser of Object.keys(machineUsers ?? {})) {
      machineUserAuthNamespaces.set(machineUser, [
        ...(machineUserAuthNamespaces.get(machineUser) ?? []),
        config.name,
      ]);
    }
  }
  return { machineUserAuthNamespaces };
}

interface EnvDependentBundleSettings extends FunctionBundleSettings {
  startContext: StartContext;
  baseDir: string;
  allowedRuntimeGlobals: BundleWorkflowJobsOptions["allowedRuntimeGlobals"];
}

interface BundleEnvDependentScriptsParams {
  source: LoadSource;
  services: Pick<ConfigServices, "workflowService" | "authServices">;
  resolved: ResolvedEnv;
  bundleSettings: EnvDependentBundleSettings;
  previousUsedJobs?: BundleWorkflowJobsResult | undefined;
}

interface EnvDependentBundles {
  workflowBuildResult: BundleWorkflowJobsResult | undefined;
  authHooks: Map<string, string>;
}

/**
 * Bundle the functions that embed `env`: the workflow jobs and each Auth service's before-login hook.
 * @param params - The config's load source, its services, its resolved env, and bundle settings
 * @returns The workflow build result and the hook bundles
 */
async function bundleEnvDependentScripts(
  params: BundleEnvDependentScriptsParams,
): Promise<EnvDependentBundles> {
  const { source, services, resolved, bundleSettings, previousUsedJobs } = params;
  const { allowedRuntimeGlobals: _allowedRuntimeGlobals, ...hookSettings } = bundleSettings;
  const { workflowService } = services;

  const workflowBuildResult =
    workflowService && workflowService.jobs.length > 0
      ? await bundleWorkflowJobs({
          ...bundleSettings,
          allJobs: workflowService.jobs,
          mainJobNames: workflowService.workflowSources.map((ws) => ws.workflow.mainJob.name),
          env: serviceEnv(resolved, { kind: "workflow" }),
          previousUsedJobs,
        })
      : undefined;

  const authHooks = new Map<string, string>();
  for (const authService of services.authServices) {
    if (!authService.config.hooks?.beforeLogin) continue;
    const authName = authService.config.name;
    const hooks = await bundleAuthHooks({
      ...hookSettings,
      configPath: source.settings.path,
      authName,
      authKey: source.auths.find((auth) => auth.config.name === authName)?.key,
      env: serviceEnv(resolved, { kind: "auth", name: authName }),
    });
    for (const [name, code] of hooks) authHooks.set(name, code);
  }
  return { workflowBuildResult, authHooks };
}

interface LoadServicesParams extends Omit<LoadApplicationParams, "config" | "previous"> {
  source: LoadSource;
}

interface LoadedServices extends Omit<LoadApplicationResult, "application"> {
  defined: BuildConfigServicesParams;
  envOverrides: EnvOverrides;
}

/**
 * Load the services of a config and bundle their functions.
 * This performs all I/O-heavy operations: loading tables, processing plugins,
 * generating plugin files, bundling, and loading definitions for validation.
 * @param params - The config's load source and the loading options
 * @returns The loaded services and their bundles
 */
async function loadServices(params: LoadServicesParams): Promise<LoadedServices> {
  const {
    source,
    pluginManager,
    bundleCache,
    client,
    workspaceId,
    expectedLocalStaticWebsiteNames,
    precompileTailorDBScripts,
  } = params;
  const { config, settings } = source;
  const baseDir = path.dirname(settings.path);

  // 1. Define services (synchronous)
  const {
    replicationResult,
    tailordbResult,
    resolverResult: configuredResolverResult,
    idpResult,
    authResult,
    staticWebsiteServices,
    aiGatewayServices,
    secrets,
    ignoreNullishValues,
  } = defineServices(source, baseDir, pluginManager, precompileTailorDBScripts);

  // 2. Resolve `name:url` static website placeholders in `env` and its overrides
  // once, before any bundling or expression generation embeds them into
  // resolver, executor, workflow, or auth hook code. Skipped without a client
  // (e.g. `--build-only`, which never reaches the platform), leaving them as declared.
  const resolved = await resolveEnv({
    source,
    client,
    workspaceId,
    expectedLocalNames:
      expectedLocalStaticWebsiteNames ??
      new Set(staticWebsiteServices.map((website) => website.name)),
  });

  // 3. Load TailorDB tables, process namespace plugins, and define plugin resolver namespaces
  for (const tailordb of tailordbResult.tailorDBServices) {
    await tailordb.loadTypes();
    await tailordb.processNamespacePlugins();
  }
  assertUniqueLocalTailorDBTypeNames({
    tailorDBServices: tailordbResult.tailorDBServices,
    scope: tailorDBTypeNameScopeOf(config),
  });
  const resolvedReplications = resolveTailorDBReplicationTypes({
    configPath: settings.path,
    replications: replicationResult,
    tailorDBServices: tailordbResult.tailorDBServices,
  });
  const pluginResolverServices = definePluginResolverServices(config, pluginManager);
  const resolverResult: DefineResolverResult = {
    resolverServices: [...configuredResolverResult.resolverServices, ...pluginResolverServices],
    subgraphs: [
      ...configuredResolverResult.subgraphs,
      ...pluginResolverServices.map(({ namespace }) => ({ Type: "pipeline", Name: namespace })),
    ],
  };

  // 4. Generate plugin files and determine executor file paths
  const pluginExecutorFiles = generatePluginFilesIfNeeded(
    pluginManager,
    tailordbResult.tailorDBServices,
    settings.path,
  );

  // 5. Determine final executorService (const, no reassignment)
  const executorService = defineExecutor(source.executor, baseDir, pluginExecutorFiles.length > 0);

  // 6. Load and collect workflows
  const workflowService = defineWorkflow(settings.workflow, baseDir);
  if (workflowService) {
    await workflowService.loadWorkflows();
  }

  // 7. Load and collect HTTP adapters
  const httpAdapterService = defineHttpAdapterService(settings.httpAdapter, baseDir);
  if (httpAdapterService) {
    await httpAdapterService.loadAdapters();
  }

  // Shared across the start context and every bundle below so a project with many
  // resolvers/executors/etc. reads and parses each ancestor tsconfig once instead of once per item.
  const tsconfigCache = createTsconfigLookupCache();
  const sdkBuilderAnnotationCache: SdkBuilderAnnotationCache = new Map();

  // 8. Build start context for workflow/job start transformation
  const startContext: StartContext = {
    ...(await buildStartContext(
      settings.workflow,
      startContextAuthNamespace(source),
      baseDir,
      workflowService?.workflowSources,
      tsconfigCache,
    )),
    ...startContextMachineUsers(source),
  };

  // 9. Resolve bundle settings
  const buildOptions = buildOptionsOf(settings);
  const inlineSourcemap = resolveInlineSourcemap(buildOptions.inlineSourcemap);
  const inlineSourcemapDependencySources = buildOptions.inlineSourcemapDependencySources ?? false;
  const inlineSourcemapProjectSources = projectSourcesOf({ buildOptions, baseDir });
  const bundleLogLevel = resolveBundleLogLevel(buildOptions.logLevel);
  const dateDefault = effectiveDateDefault(settings);
  const decimalDefault = effectiveDecimalDefault(settings);
  const kyselyTemporal = pluginManager?.getPluginConfig(KyselyGeneratorID)?.temporal ?? false;
  const kyselyDecimal = pluginManager?.getPluginConfig(KyselyGeneratorID)?.decimal ?? false;

  // Collect in-memory bundled scripts
  const bundledScripts: BundledScripts = {
    resolvers: new Map(),
    executors: new Map(),
    workflowJobs: new Map(),
    authHooks: new Map(),
  };

  // 10. Bundle resolvers
  for (const pipeline of resolverResult.resolverServices) {
    await pipeline.loadResolvers();
    const resolverBundles = await bundleResolvers({
      namespace: pipeline.namespace,
      files: Object.keys(pipeline.resolvers),
      baseDir,
      defaultPermission: pipeline.defaultPermission,
      startContext,
      cache: bundleCache,
      inlineSourcemap,
      inlineSourcemapDependencySources,
      inlineSourcemapProjectSources,
      bundleLogLevel,
      bundleTreeshake: buildOptions.treeshake,
      tsconfigCache,
      sdkBuilderAnnotationCache,
      allowedRuntimeGlobals: buildOptions.allowedRuntimeGlobals,
      dateDefault,
      decimalDefault,
      kyselyTemporal,
      kyselyDecimal,
    });
    for (const [name, code] of resolverBundles) {
      bundledScripts.resolvers.set(resolverBundleKey(pipeline.namespace, name), code);
    }
  }

  // 11. Bundle executors
  if (executorService) {
    bundledScripts.executors = await bundleExecutors({
      config: executorService.config,
      startContext,
      additionalFiles: [...pluginExecutorFiles],
      cache: bundleCache,
      inlineSourcemap,
      inlineSourcemapDependencySources,
      inlineSourcemapProjectSources,
      bundleLogLevel,
      bundleTreeshake: buildOptions.treeshake,
      baseDir,
      tsconfigCache,
      sdkBuilderAnnotationCache,
      allowedRuntimeGlobals: buildOptions.allowedRuntimeGlobals,
      dateDefault,
      decimalDefault,
      kyselyTemporal,
      kyselyDecimal,
    });
  }

  // 12. Bundle workflow jobs and auth hooks, the functions that embed env
  const { workflowBuildResult, authHooks } = await bundleEnvDependentScripts({
    source,
    services: { workflowService, authServices: authResult.authServices },
    resolved,
    bundleSettings: {
      startContext,
      cache: bundleCache,
      inlineSourcemap,
      inlineSourcemapDependencySources,
      inlineSourcemapProjectSources,
      bundleLogLevel,
      bundleTreeshake: buildOptions.treeshake,
      baseDir,
      tsconfigCache,
      sdkBuilderAnnotationCache,
      allowedRuntimeGlobals: buildOptions.allowedRuntimeGlobals,
      dateDefault,
      decimalDefault,
      kyselyTemporal,
      kyselyDecimal,
    },
  });
  if (workflowBuildResult) {
    bundledScripts.workflowJobs = workflowBuildResult.bundledCode;
  }
  bundledScripts.authHooks = authHooks;

  // 13. Bundle HTTP adapters
  let httpAdapterBuildResult: HttpAdapterBundleResult | undefined;
  if (httpAdapterService && httpAdapterService.adapters.length > 0) {
    httpAdapterBuildResult = await bundleHttpAdapters(
      httpAdapterService.adapters.map((a) => ({
        name: a.adapter.name,
        sourceFile: a.sourceFile,
        methods: a.methods,
        hasOutput: a.hasOutput,
      })),
      baseDir,
      bundleCache,
      bundleLogLevel,
      tsconfigCache,
      buildOptions.treeshake,
    );
  }

  // 14. Load resolver and executor definitions (for validation/logging)
  for (const pipeline of resolverResult.resolverServices) {
    await pipeline.loadResolvers();
  }
  if (executorService) {
    await executorService.loadExecutors();
    if (pluginExecutorFiles.length > 0) {
      await executorService.loadPluginExecutorFiles([...pluginExecutorFiles]);
    }
  }
  // 15. Check the wait point keys every loaded module declared
  assertWaitPointKeys();

  if (workflowService) {
    workflowService.printLoadedWorkflows();
  }
  if (httpAdapterService) {
    httpAdapterService.printLoadedAdapters();
  }
  logger.newline();

  return {
    defined: {
      tailordbResult,
      resolverResult,
      idpResult,
      authResult,
      executorService,
      workflowService,
      httpAdapterService,
      staticWebsiteServices,
      aiGatewayServices,
      replicationResult: resolvedReplications,
      secrets,
      ignoreNullishValues,
      env: resolved.env,
    },
    envOverrides: resolved.envOverrides,
    workflowBuildResult,
    httpAdapterBuildResult,
    bundledScripts,
    reusableBuildState: {
      startContext,
      tsconfigCache,
      sdkBuilderAnnotationCache,
      inlineSourcemap,
      inlineSourcemapDependencySources,
      inlineSourcemapProjectSources,
      bundleLogLevel,
      kyselyTemporal,
      kyselyDecimal,
    },
  };
}

/** A load of a config's services that a reload reuses. */
interface PreviousLoad extends Omit<LoadApplicationResult, "application"> {
  services: ConfigServices;
}

interface ReloadEnvDependentBundlesParams extends Pick<
  LoadApplicationParams,
  "client" | "workspaceId" | "expectedLocalStaticWebsiteNames" | "bundleCache"
> {
  source: LoadSource;
  previous: PreviousLoad;
}

interface ReloadedBundles
  extends Pick<LoadApplicationResult, "workflowBuildResult" | "bundledScripts">, ResolvedEnv {}

/**
 * Re-resolve `env`'s static website placeholders and rebundle only the
 * workflow-job and auth-hook code that embeds it, reusing everything else
 * from `previous` -- config parsing, TailorDB loading, plugin execution, and
 * the resolver/executor/HTTP-adapter bundles, none of which depend on `env`.
 * @param params - The config's load source, client, and the prior load to reuse
 * @returns `env` and its overrides, and the two dependent bundle kinds, refreshed
 */
async function reloadEnvDependentBundles(
  params: ReloadEnvDependentBundlesParams,
): Promise<ReloadedBundles> {
  const { source, client, workspaceId, expectedLocalStaticWebsiteNames, bundleCache, previous } =
    params;
  const { services, reusableBuildState } = previous;
  const { settings } = source;
  const buildOptions = buildOptionsOf(settings);

  const resolved = await resolveEnv({
    source,
    client,
    workspaceId,
    expectedLocalNames:
      expectedLocalStaticWebsiteNames ??
      new Set(services.staticWebsiteServices.map((website) => website.name)),
  });

  const { workflowBuildResult, authHooks } = await bundleEnvDependentScripts({
    source,
    services,
    resolved,
    bundleSettings: {
      ...reusableBuildState,
      cache: bundleCache,
      bundleTreeshake: buildOptions.treeshake,
      baseDir: path.dirname(settings.path),
      allowedRuntimeGlobals: buildOptions.allowedRuntimeGlobals,
      dateDefault: effectiveDateDefault(settings),
      decimalDefault: effectiveDecimalDefault(settings),
    },
    previousUsedJobs: previous.workflowBuildResult,
  });
  const bundledScripts: BundledScripts = {
    ...previous.bundledScripts,
    ...(workflowBuildResult ? { workflowJobs: workflowBuildResult.bundledCode } : {}),
    authHooks,
  };

  return {
    ...resolved,
    workflowBuildResult: workflowBuildResult ?? previous.workflowBuildResult,
    bundledScripts,
  };
}

/**
 * Load and fully initialize a Tailor application.
 * This performs all I/O-heavy operations: loading tables, processing plugins,
 * generating plugin files, bundling, and loading definitions for validation.
 * @param params - Parameters for defining and loading the application
 * @returns Fully initialized application with workflow results
 */
export async function loadApplication(
  params: LoadApplicationParams,
): Promise<LoadApplicationResult> {
  const { config, previous } = params;
  const source = loadSourceOf(config);

  if (previous) {
    const reloaded = await reloadEnvDependentBundles({
      ...params,
      source,
      previous: { ...previous, services: previous.application },
    });
    const application: Application = { ...previous.application, env: reloaded.env };
    return {
      application,
      workflowBuildResult: reloaded.workflowBuildResult,
      httpAdapterBuildResult: previous.httpAdapterBuildResult,
      bundledScripts: reloaded.bundledScripts,
      reusableBuildState: previous.reusableBuildState,
    };
  }

  const {
    defined,
    envOverrides: _envOverrides,
    ...loaded
  } = await loadServices({
    ...params,
    source,
  });
  return { application: buildApplication({ config, ...defined }), ...loaded };
}

/**
 * Parameters for loading and bundling the services of a workspace config
 */
export interface LoadWorkspaceParams extends Omit<LoadApplicationParams, "config" | "previous"> {
  /** Workspace loaded from a `defineWorkspace()` or `defineApp()` config */
  workspace: LoadedWorkspaceConfig;
  /** A prior `loadWorkspace` result for this same config, reused as `loadApplication` reuses its `previous`. */
  previous?: LoadWorkspaceResult | undefined;
}

/**
 * Result of loading the services of a workspace config
 */
export interface LoadWorkspaceResult extends Omit<LoadApplicationResult, "application"> {
  /** The workspace's services, with the static website URLs in `env` and its overrides resolved when a client is given */
  services: WorkspaceServices;
}

/**
 * Load the services of a `defineWorkspace()` or `defineApp()` config and bundle their functions,
 * as {@link loadApplication} does for a `defineConfig()` config.
 * @param params - Parameters for loading the workspace
 * @returns The loaded services and their bundles
 */
export async function loadWorkspace(params: LoadWorkspaceParams): Promise<LoadWorkspaceResult> {
  const { workspace, previous } = params;
  const source = loadSourceOf(workspace);

  if (previous) {
    const reloaded = await reloadEnvDependentBundles({ ...params, source, previous });
    return {
      services: { ...previous.services, env: reloaded.env, envOverrides: reloaded.envOverrides },
      workflowBuildResult: reloaded.workflowBuildResult,
      httpAdapterBuildResult: previous.httpAdapterBuildResult,
      bundledScripts: reloaded.bundledScripts,
      reusableBuildState: previous.reusableBuildState,
    };
  }

  const { defined, envOverrides, ...loaded } = await loadServices({ ...params, source });
  return {
    services: { ...buildConfigServices(defined), settings: workspace, envOverrides },
    ...loaded,
  };
}
