import * as path from "pathe";
import { generatePluginExecutorFiles } from "@/cli/commands/generate/plugin-executor-generator";
import { generatePluginTypeFiles } from "@/cli/commands/generate/plugin-type-generator";
import { bundleAuthHooks } from "@/cli/services/auth/bundler";
import { createAuthService, type AuthService } from "@/cli/services/auth/service";
import { bundleExecutors } from "@/cli/services/executor/bundler";
import { createExecutorService, type ExecutorService } from "@/cli/services/executor/service";
import {
  bundleHttpAdapters,
  type HttpAdapterBundleResult,
} from "@/cli/services/http-adapter/bundler";
import {
  createHttpAdapterService,
  type HttpAdapterService,
} from "@/cli/services/http-adapter/service";
import { bundleResolvers } from "@/cli/services/resolver/bundler";
import { createResolverService, type ResolverService } from "@/cli/services/resolver/service";
import { createTailorDBService, type TailorDBService } from "@/cli/services/tailordb/service";
import { bundleWorkflowJobs, type BundleWorkflowJobsResult } from "@/cli/services/workflow/bundler";
import { createWorkflowService, type WorkflowService } from "@/cli/services/workflow/service";
import { type LoadedConfig } from "@/cli/shared/config-loader";
import { getDistDir } from "@/cli/shared/dist-dir";
import { resolveInlineSourcemap } from "@/cli/shared/inline-sourcemap";
import { logger } from "@/cli/shared/logger";
import { buildTriggerContext } from "@/cli/shared/trigger-context";
import { IdPSchema } from "@/parser/service/idp";
import { SecretsSchema } from "@/parser/service/secrets";
import { StaticWebsiteSchema } from "@/parser/service/staticwebsite";
import { TailorDBServiceConfigSchema } from "@/parser/service/tailordb";
import {
  type AppConfig,
  type ExecutorServiceInput,
  type ResolverServiceInput,
  type WorkflowServiceConfig,
} from "@/types/app-config";
import { type AuthConfig } from "@/types/auth";
import { type HttpAdapterServiceInput } from "@/types/http-adapter";
import { type IdPConfig } from "@/types/idp";
import { type TailorDBServiceInput } from "@/types/tailordb";
import type { BundleCache } from "@/cli/cache/bundle-cache";
import type { BundledScripts } from "@/cli/commands/deploy/function-registry";
import type { PluginManager } from "@/plugin/manager";
import type { IdP } from "@/types/idp.generated";
import type { StaticWebsite, StaticWebsiteInput } from "@/types/staticwebsite.generated";

export type SecretVault = {
  readonly vaultName: string;
  readonly secrets: ReadonlyArray<{ name: string; value: string | null | undefined }>;
};

export type Application = {
  readonly name: string;
  readonly id: string | undefined;
  readonly config: AppConfig;
  readonly subgraphs: ReadonlyArray<{ Type: string; Name: string }>;
  readonly tailorDBServices: ReadonlyArray<TailorDBService>;
  readonly externalTailorDBNamespaces: ReadonlyArray<string>;
  readonly resolverServices: ReadonlyArray<ResolverService>;
  readonly idpServices: ReadonlyArray<IdP>;
  readonly authService: Readonly<AuthService> | undefined;
  readonly executorService: Readonly<ExecutorService> | undefined;
  readonly workflowService: Readonly<WorkflowService> | undefined;
  readonly httpAdapterService: Readonly<HttpAdapterService> | undefined;
  readonly staticWebsiteServices: ReadonlyArray<StaticWebsite>;
  readonly secrets: ReadonlyArray<SecretVault>;
  readonly ignoreNullishValues: boolean;
  readonly env: Readonly<Record<string, string | number | boolean>>;
  readonly applications: ReadonlyArray<Application>;
};

/**
 * Result of loading the application
 */
export interface LoadApplicationResult {
  /** Fully initialized application */
  application: Application;
  /** Workflow bundling result (if workflows were bundled) */
  workflowBuildResult?: BundleWorkflowJobsResult;
  /** HTTP adapter bundling result (if adapters were bundled) */
  httpAdapterBuildResult?: HttpAdapterBundleResult;
  /** In-memory bundled scripts organized by kind */
  bundledScripts: BundledScripts;
}

type DefineTailorDBResult = {
  tailorDBServices: TailorDBService[];
  externalTailorDBNamespaces: string[];
  subgraphs: Array<{ Type: string; Name: string }>;
};

function defineTailorDB(
  config: TailorDBServiceInput | undefined,
  pluginManager?: PluginManager,
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
      const parsedConfig = TailorDBServiceConfigSchema.parse(serviceConfig);
      const tailorDB = createTailorDBService({ namespace, config: parsedConfig, pluginManager });
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

function defineResolver(config: ResolverServiceInput | undefined): DefineResolverResult {
  const resolverServices: ResolverService[] = [];
  const subgraphs: Array<{ Type: string; Name: string }> = [];

  if (!config) {
    return { resolverServices, subgraphs };
  }

  for (const [namespace, serviceConfig] of Object.entries(config)) {
    if (!("external" in serviceConfig)) {
      const resolverService = createResolverService(namespace, serviceConfig);
      resolverServices.push(resolverService);
    }
    subgraphs.push({ Type: "pipeline", Name: namespace });
  }

  return { resolverServices, subgraphs };
}

type DefineIdpResult = {
  idpServices: IdP[];
  subgraphs: Array<{ Type: string; Name: string }>;
};

function defineIdp(config: readonly IdPConfig[] | undefined): DefineIdpResult {
  const idpServices: IdP[] = [];
  const subgraphs: Array<{ Type: string; Name: string }> = [];

  if (!config) {
    return { idpServices, subgraphs };
  }

  const idpNames = new Set<string>();
  config.forEach((idpConfig) => {
    const name = idpConfig.name;
    if (idpNames.has(name)) {
      throw new Error(`IdP with name "${name}" already defined.`);
    }
    idpNames.add(name);
    if (!("external" in idpConfig)) {
      const idp = IdPSchema.parse(idpConfig);
      idpServices.push(idp);
    }
    subgraphs.push({ Type: "idp", Name: name });
  });

  return { idpServices, subgraphs };
}

type DefineAuthResult = {
  authService: AuthService | undefined;
  subgraphs: Array<{ Type: string; Name: string }>;
};

function defineAuth(
  config: AuthConfig | undefined,
  tailorDBServices: ReadonlyArray<TailorDBService>,
  externalTailorDBNamespaces: ReadonlyArray<string>,
): DefineAuthResult {
  const subgraphs: Array<{ Type: string; Name: string }> = [];

  if (!config) {
    return { authService: undefined, subgraphs };
  }

  let authService: AuthService | undefined;
  if (!("external" in config)) {
    authService = createAuthService(config, tailorDBServices, externalTailorDBNamespaces);
  }
  subgraphs.push({ Type: "auth", Name: config.name });

  return { authService, subgraphs };
}

function defineExecutor(
  config: ExecutorServiceInput | undefined,
  hasPluginExecutors: boolean,
): ExecutorService | undefined {
  if (!config && !hasPluginExecutors) {
    return undefined;
  }
  return createExecutorService({ config: config ?? { files: [] } });
}

function defineWorkflow(config: WorkflowServiceConfig | undefined): WorkflowService | undefined {
  if (!config) {
    return undefined;
  }
  return createWorkflowService({ config });
}

function defineHttpAdapterService(
  config: HttpAdapterServiceInput | undefined,
): HttpAdapterService | undefined {
  if (!config) {
    return undefined;
  }
  return createHttpAdapterService({ config });
}

function defineStaticWebsites(
  websites: readonly StaticWebsiteInput[] | undefined,
): StaticWebsite[] {
  const staticWebsiteServices: StaticWebsite[] = [];
  const websiteNames = new Set<string>();

  (websites ?? []).forEach((config) => {
    const website = StaticWebsiteSchema.parse(config);
    if (websiteNames.has(website.name)) {
      throw new Error(`Static website with name "${website.name}" already defined.`);
    }
    websiteNames.add(website.name);
    staticWebsiteServices.push(website);
  });

  return staticWebsiteServices;
}

function parseSecretManager(config: AppConfig["secrets"]): {
  secrets: SecretVault[];
  ignoreNullishValues: boolean;
} {
  if (!config) {
    return { secrets: [], ignoreNullishValues: false };
  }

  const parsed = SecretsSchema.parse(config);
  const { ignoreNullishValues } = parsed.options;

  const secrets = Object.entries(parsed.vaults).map(([vaultName, vaultSecrets]) => ({
    vaultName,
    secrets: Object.entries(vaultSecrets).map(([name, value]) => ({ name, value })),
  }));

  // Defensive check: error if nullish values exist without ignoreNullishValues
  if (!ignoreNullishValues) {
    for (const vault of secrets) {
      for (const secret of vault.secrets) {
        if (secret.value == null) {
          throw new Error(
            `Secret "${vault.vaultName}/${secret.name}" has no value. ` +
              `Use { ignoreNullishValues: true } option in defineSecretManager() to skip secrets without values.`,
          );
        }
      }
    }
  }

  return { secrets, ignoreNullishValues };
}

type DefineServicesResult = {
  tailordbResult: DefineTailorDBResult;
  resolverResult: DefineResolverResult;
  idpResult: DefineIdpResult;
  authResult: DefineAuthResult;
  staticWebsiteServices: StaticWebsite[];
  secrets: SecretVault[];
  ignoreNullishValues: boolean;
};

function defineServices(config: AppConfig, pluginManager?: PluginManager): DefineServicesResult {
  const tailordbResult = defineTailorDB(config.db, pluginManager);
  const resolverResult = defineResolver(config.resolver);
  const idpResult = defineIdp(config.idp);
  const authResult = defineAuth(
    config.auth,
    tailordbResult.tailorDBServices,
    tailordbResult.externalTailorDBNamespaces,
  );
  const staticWebsiteServices = defineStaticWebsites(config.staticWebsites);
  const { secrets, ignoreNullishValues } = parseSecretManager(config.secrets);
  return {
    tailordbResult,
    resolverResult,
    idpResult,
    authResult,
    staticWebsiteServices,
    secrets,
    ignoreNullishValues: ignoreNullishValues,
  };
}

function buildApplication(params: {
  config: AppConfig;
  tailordbResult: DefineTailorDBResult;
  resolverResult: DefineResolverResult;
  idpResult: DefineIdpResult;
  authResult: DefineAuthResult;
  executorService: ExecutorService | undefined;
  workflowService: WorkflowService | undefined;
  httpAdapterService: HttpAdapterService | undefined;
  staticWebsiteServices: StaticWebsite[];
  secrets: SecretVault[];
  ignoreNullishValues: boolean;
  env: Record<string, string | number | boolean>;
}): Application {
  const application: Application = {
    name: params.config.name,
    id: params.config.id,
    config: params.config,
    subgraphs: [
      ...params.tailordbResult.subgraphs,
      ...params.resolverResult.subgraphs,
      ...params.idpResult.subgraphs,
      ...params.authResult.subgraphs,
    ],
    tailorDBServices: params.tailordbResult.tailorDBServices,
    externalTailorDBNamespaces: params.tailordbResult.externalTailorDBNamespaces,
    resolverServices: params.resolverResult.resolverServices,
    idpServices: params.idpResult.idpServices,
    authService: params.authResult.authService,
    executorService: params.executorService,
    workflowService: params.workflowService,
    httpAdapterService: params.httpAdapterService,
    staticWebsiteServices: params.staticWebsiteServices,
    secrets: params.secrets,
    ignoreNullishValues: params.ignoreNullishValues,
    env: params.env,
    get applications() {
      return [application];
    },
  };
  return application;
}

/**
 * Parameters for defining an application
 */
export interface DefineApplicationParams {
  /** Application configuration object (must be loaded via loadConfig) */
  config: LoadedConfig;
  /** Plugin manager for processing plugins */
  pluginManager?: PluginManager;
  /** Optional bundle cache for skipping unchanged builds */
  bundleCache?: BundleCache;
}

/**
 * Define a Tailor application from the given configuration.
 * This is a lightweight, synchronous function that creates the application
 * structure without loading types or bundling files.
 * @param params - Parameters for defining the application
 * @returns Configured application instance
 */
export function defineApplication(params: DefineApplicationParams): Application {
  const { config, pluginManager } = params;
  const services = defineServices(config, pluginManager);
  // Plugin executors are not known at define-time; generate/apply flows handle them after type loading.
  const executorService = defineExecutor(config.executor, false);
  const workflowService = defineWorkflow(config.workflow);
  const httpAdapterService = defineHttpAdapterService(config.httpAdapter);

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
 * Generate plugin type and executor files if a plugin manager is provided.
 * Collects source type info from TailorDB services and delegates to PluginManager.
 * @param pluginManager - Plugin manager instance (skips if undefined)
 * @param tailorDBServices - TailorDB services to collect type source info from
 * @param configPath - Path to tailor.config.ts for resolving plugin imports
 * @returns Generated executor file paths
 */
export function generatePluginFilesIfNeeded(
  pluginManager: PluginManager | undefined,
  tailorDBServices: ReadonlyArray<TailorDBService>,
  configPath: string,
): string[] {
  if (!pluginManager) return [];

  const sourceTypeInfoMap = new Map<string, { filePath: string; exportName: string }>();
  for (const db of tailorDBServices) {
    const typeSourceInfo = db.typeSourceInfo;
    for (const [typeName, sourceInfo] of Object.entries(typeSourceInfo)) {
      if (sourceInfo.filePath) {
        sourceTypeInfoMap.set(typeName, {
          filePath: sourceInfo.filePath,
          exportName: sourceInfo.exportName,
        });
      }
    }
  }

  return pluginManager.generatePluginFiles({
    outputDir: path.join(getDistDir(), "plugin"),
    sourceTypeInfoMap,
    configPath,
    typeGenerator: generatePluginTypeFiles,
    executorGenerator: generatePluginExecutorFiles,
  });
}

/**
 * Load and fully initialize a Tailor application.
 * This performs all I/O-heavy operations: loading types, processing plugins,
 * generating plugin files, bundling, and loading definitions for validation.
 * @param params - Parameters for defining and loading the application
 * @returns Fully initialized application with workflow results
 */
export async function loadApplication(
  params: DefineApplicationParams,
): Promise<LoadApplicationResult> {
  const { config, pluginManager, bundleCache } = params;

  // 1. Define services (synchronous)
  const {
    tailordbResult,
    resolverResult,
    idpResult,
    authResult,
    staticWebsiteServices,
    secrets,
    ignoreNullishValues,
  } = defineServices(config, pluginManager);

  // 2. Load TailorDB types and process namespace plugins
  for (const tailordb of tailordbResult.tailorDBServices) {
    await tailordb.loadTypes();
    await tailordb.processNamespacePlugins();
  }

  // 3. Generate plugin files and determine executor file paths
  const pluginExecutorFiles = generatePluginFilesIfNeeded(
    pluginManager,
    tailordbResult.tailorDBServices,
    config.path,
  );

  // 4. Determine final executorService (const, no reassignment)
  const executorService = defineExecutor(config.executor, pluginExecutorFiles.length > 0);

  // 5. Load and collect workflows
  const workflowService = defineWorkflow(config.workflow);
  if (workflowService) {
    await workflowService.loadWorkflows();
  }

  // 6. Load and collect HTTP adapters
  const httpAdapterService = defineHttpAdapterService(config.httpAdapter);
  if (httpAdapterService) {
    await httpAdapterService.loadAdapters();
  }

  // 7. Build trigger context for workflow/job trigger transformation
  const triggerContext = await buildTriggerContext(
    config.workflow,
    authResult.authService?.config.name,
  );

  // 8. Resolve inline sourcemap setting
  const inlineSourcemap = resolveInlineSourcemap(config.inlineSourcemap);

  // Collect in-memory bundled scripts
  const bundledScripts: BundledScripts = {
    resolvers: new Map(),
    executors: new Map(),
    workflowJobs: new Map(),
    authHooks: new Map(),
  };

  // 9. Bundle resolvers
  for (const pipeline of resolverResult.resolverServices) {
    const resolverBundles = await bundleResolvers(
      pipeline.namespace,
      pipeline.config,
      triggerContext,
      bundleCache,
      inlineSourcemap,
    );
    for (const [name, code] of resolverBundles) {
      bundledScripts.resolvers.set(name, code);
    }
  }

  // 10. Bundle executors
  if (executorService) {
    bundledScripts.executors = await bundleExecutors({
      config: executorService.config,
      triggerContext,
      additionalFiles: [...pluginExecutorFiles],
      cache: bundleCache,
      inlineSourcemap,
    });
  }

  // 11. Bundle workflows
  let workflowBuildResult: BundleWorkflowJobsResult | undefined;
  if (workflowService && workflowService.jobs.length > 0) {
    const mainJobNames = workflowService.workflowSources.map((ws) => ws.workflow.mainJob.name);
    workflowBuildResult = await bundleWorkflowJobs(
      workflowService.jobs,
      mainJobNames,
      config.env ?? {},
      triggerContext,
      bundleCache,
      inlineSourcemap,
    );
    bundledScripts.workflowJobs = workflowBuildResult.bundledCode;
  }

  // 12. Bundle HTTP adapters
  let httpAdapterBuildResult: HttpAdapterBundleResult | undefined;
  if (httpAdapterService && httpAdapterService.adapters.length > 0) {
    httpAdapterBuildResult = await bundleHttpAdapters(
      httpAdapterService.adapters.map((a) => ({
        name: a.adapter.name,
        sourceFile: a.sourceFile,
        methods: a.methods,
        hasOutput: a.hasOutput,
      })),
      bundleCache,
    );
  }

  // 13. Bundle auth hooks
  if (authResult.authService?.config.hooks?.beforeLogin) {
    const authName = authResult.authService.config.name;
    bundledScripts.authHooks = await bundleAuthHooks({
      configPath: config.path,
      authName,
      handlerAccessPath: `auth.hooks.beforeLogin.handler`,
      env: config.env ?? {},
      triggerContext,
      cache: bundleCache,
      inlineSourcemap,
    });
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
  if (workflowService) {
    workflowService.printLoadedWorkflows();
  }
  if (httpAdapterService) {
    httpAdapterService.printLoadedAdapters();
  }
  logger.newline();

  // 15. Build immutable Application
  const application = buildApplication({
    config,
    tailordbResult,
    resolverResult,
    idpResult,
    authResult,
    executorService,
    workflowService,
    httpAdapterService,
    staticWebsiteServices,
    secrets,
    ignoreNullishValues,
    env: config.env ?? {},
  });

  return { application, workflowBuildResult, httpAdapterBuildResult, bundledScripts };
}
