import * as fs from "node:fs";
import { Code, ConnectError } from "@connectrpc/connect";
import { findUpSync } from "find-up-simple";
import * as path from "pathe";
import { hashFile } from "#/cli/cache/hasher";
import { createCacheManager } from "#/cli/cache/manager";
import { loadApplication, type Application } from "#/cli/services/application";
import { assertUniqueTailorDBTypeNamesWithExternal } from "#/cli/services/tailordb/type-name-validation";
import { initOperatorClient, type OperatorClient } from "#/cli/shared/client";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadConfigPath, loadWorkspaceId } from "#/cli/shared/context";
import { getDistDir } from "#/cli/shared/dist-dir";
import { logger, styles } from "#/cli/shared/logger";
import { readPackageJson } from "#/cli/shared/package-json";
import { parseBoolean } from "#/cli/shared/parse-boolean";
import { generateUserTypes } from "#/cli/shared/type-generator";
import { withSpan } from "#/cli/telemetry/index";
import { PluginManager } from "#/plugin/manager";
import { planAIGateway } from "./aigateway";
import { planApplication } from "./application";
import { applyDeploymentPlans, type PlannedDeployment } from "./apply-phases";
import { formatAuthHookChangeEntries, planAuth } from "./auth";
import {
  formatPlanSummary,
  summarizeChangeSets,
  type HasName,
  type PlanSummary,
} from "./change-set";
import { ensureConfigIdForDeploy } from "./config-id-injector";
import {
  confirmImportantResourceDeletion,
  confirmOwnerConflict,
  confirmUnmanagedResources,
  type ImportantResourceDeletion,
  type OwnerConflict,
  type UnmanagedResource,
} from "./confirm";
import { buildPlannedExecutorsByName, formatExecutorChangeEntries, planExecutor } from "./executor";
import {
  collectFunctionEntries,
  filterBundledWorkflowJobs,
  planFunctionRegistry,
  splitFunctionRegistryChanges,
  WORKFLOW_PREFIX,
} from "./function-registry";
import {
  buildGroupedDisplayLines,
  extractServiceActions,
  formatChangeSetEntries,
  type GroupedDisplayEntry,
  type NamespaceAction,
} from "./grouped-display";
import { planIdP } from "./idp";
import { buildMetaRequest, hasMatchingSdkVersion, resourceTrn, sdkNameLabelKey } from "./label";
import { formatResolverChangeEntries, planPipeline } from "./resolver";
import { planSecretManager } from "./secret-manager";
import { planStaticWebsite } from "./staticwebsite";
import { formatTailorDBResourceChangeEntries, planTailorDB } from "./tailordb";
import { validatePlan } from "./validate-plan";
import { formatWorkflowChangeEntries, planWorkflow } from "./workflow";
import type { PlanContext } from "./types";

export interface DeployOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  dryRun?: boolean;
  yes?: boolean;
  noSchemaCheck?: boolean;
  noValidate?: boolean;
  noCache?: boolean;
  cleanCache?: boolean;
  // NOTE(remiposo): Provide an option to run build-only for testing purposes.
  // This could potentially be exposed as a CLI option.
  buildOnly?: boolean;
}

/**
 * Resolve the set of IdP names that have at least one executor subscribed to
 * their user events. When an executor's idpUser trigger omits the `idp` option
 * and exactly one IdP is configured, that IdP is implicitly the target.
 * Executors that omit `idp` while multiple IdPs exist are skipped here; the
 * apply pipeline throws a clearer error for them later.
 * @param application - Loaded application
 * @returns Set of IdP names targeted by idpUser triggers
 */
function collectIdpUserTriggerTargets(application: Readonly<Application>): ReadonlySet<string> {
  const targets = new Set<string>();
  const idps = application.idpServices;
  for (const executor of Object.values(application.executorService?.executors ?? {})) {
    if (executor.trigger.kind !== "idpUser") {
      continue;
    }
    if (executor.trigger.idp != null) {
      targets.add(executor.trigger.idp);
    } else if (idps.length === 1) {
      const [idp] = idps;
      if (idp) targets.add(idp.name);
    }
  }
  return targets;
}

async function shouldForceApplyAll(
  client: OperatorClient,
  workspaceId: string,
  application: Readonly<Application>,
  functionEntries: ReadonlyArray<{ name: string }>,
) {
  const desiredLabels = (
    await buildMetaRequest({
      trn: resourceTrn(workspaceId, "application", application.name),
      appName: application.name,
      appId: application.id,
    })
  ).labels;
  const candidateTrns = new Set<string>();

  if (application.subgraphs.length > 0) {
    candidateTrns.add(resourceTrn(workspaceId, "application", application.name));
  }
  application.staticWebsiteServices.forEach((website) => {
    candidateTrns.add(resourceTrn(workspaceId, "staticwebsite", website.name));
  });
  application.aiGatewayServices.forEach((gateway) => {
    candidateTrns.add(resourceTrn(workspaceId, "aigateway", gateway.name));
  });
  application.resolverServices.forEach((pipeline) => {
    candidateTrns.add(resourceTrn(workspaceId, "pipeline", pipeline.namespace));
  });
  application.idpServices.forEach((idp) => {
    candidateTrns.add(resourceTrn(workspaceId, "idp", idp.name));
  });
  if (application.authService) {
    candidateTrns.add(resourceTrn(workspaceId, "auth", application.authService.config.name));
  }
  Object.values(application.executorService?.executors ?? {}).forEach((executor) => {
    candidateTrns.add(resourceTrn(workspaceId, "executor", executor.name));
  });
  Object.values(application.workflowService?.workflows ?? {}).forEach((workflow) => {
    candidateTrns.add(resourceTrn(workspaceId, "workflow", workflow.name));
  });
  application.tailorDBServices.forEach((service) => {
    candidateTrns.add(resourceTrn(workspaceId, "tailordb", service.namespace));
  });
  application.secrets.forEach((vault) => {
    candidateTrns.add(resourceTrn(workspaceId, "vault", vault.vaultName));
  });
  functionEntries.forEach((entry) => {
    candidateTrns.add(resourceTrn(workspaceId, "function_registry", entry.name));
  });

  for (const trn of candidateTrns) {
    try {
      const { metadata } = await client.getMetadata({ trn });
      if (metadata?.labels[sdkNameLabelKey] !== application.name) {
        continue;
      }
      if (!hasMatchingSdkVersion(metadata.labels, desiredLabels)) {
        return true;
      }
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        continue;
      }
      throw error;
    }
  }

  return false;
}

/**
 * Decide which renamed-away applications should be deleted. Excludes the
 * target itself: id regeneration alone keeps the name unchanged, so deleting
 * by name would destroy the live app.
 * @param params - Inputs for the computation
 * @param params.conflicts - Detected owner conflicts across all services
 * @param params.resourceOwners - App names that still own resources we don't manage
 * @param params.targetAppName - The application currently being deployed
 * @returns Names of empty old applications that should be deleted
 */
export function computeRenamedAppDeletions(params: {
  conflicts: ReadonlyArray<Pick<OwnerConflict, "currentOwner">>;
  resourceOwners: ReadonlySet<string>;
  targetAppName: string;
}): string[] {
  const { conflicts, resourceOwners, targetAppName } = params;
  const conflictOwners = new Set(conflicts.map((c) => c.currentOwner));
  return [...conflictOwners].filter(
    (owner) => !resourceOwners.has(owner) && owner !== targetAppName,
  );
}

type PlanResults = {
  functionRegistry: Awaited<ReturnType<typeof planFunctionRegistry>>;
  tailorDB: Awaited<ReturnType<typeof planTailorDB>>;
  staticWebsite: Awaited<ReturnType<typeof planStaticWebsite>>;
  aiGateway: Awaited<ReturnType<typeof planAIGateway>>;
  idp: Awaited<ReturnType<typeof planIdP>>;
  auth: Awaited<ReturnType<typeof planAuth>>;
  pipeline: Awaited<ReturnType<typeof planPipeline>>;
  app: Awaited<ReturnType<typeof planApplication>>;
  executor: Awaited<ReturnType<typeof planExecutor>>;
  workflow: Awaited<ReturnType<typeof planWorkflow>>;
  secretManager: Awaited<ReturnType<typeof planSecretManager>>;
};

type BuildDeploymentTargetParams = {
  configPath: string | undefined;
  dryRun: boolean;
  buildOnly: boolean;
  noCache: boolean;
  packageVersion: string;
  cacheDir: string;
};

type BuiltDeploymentTarget = {
  config: Awaited<ReturnType<typeof loadConfig>>["config"];
  application: Application;
  workflowBuildResult: Awaited<ReturnType<typeof loadApplication>>["workflowBuildResult"];
  httpAdapterBuildResult: Awaited<ReturnType<typeof loadApplication>>["httpAdapterBuildResult"];
  bundledScripts: Awaited<ReturnType<typeof loadApplication>>["bundledScripts"];
};

type PlanDeploymentTargetParams = {
  target: BuiltDeploymentTarget;
  client: OperatorClient;
  workspaceId: string;
  noSchemaCheck: boolean | undefined;
};

type ConfirmDeploymentPlansParams = {
  deployments: PlannedDeployment[];
  yes: boolean;
};

type PrintPlanOptions = {
  dryRun?: boolean;
};

type JsonPlanPayload = {
  summary: PlanSummary;
  changes: Array<Pick<GroupedDisplayEntry, "action" | "name" | "labels" | "namespace">>;
  warnings: Array<{
    type: "unmanaged" | "skippedSecret";
    resourceType: string;
    name: string;
  }>;
  conflicts: Array<{
    resourceType: string;
    name: string;
    currentOwner: string;
  }>;
};

type PlanReport = {
  summary: PlanSummary;
  json: JsonPlanPayload;
  lines: string[];
};

function buildPlanReport(results: PlanResults): PlanReport {
  const executorEntries = formatExecutorChangeEntries(
    results.executor.changeSet,
    buildPlannedExecutorsByName(results.executor.changeSet),
    results.functionRegistry.executorFunctionChanges,
  );
  const resolverEntries = formatResolverChangeEntries(
    results.pipeline.changeSet.resolver,
    results.functionRegistry.resolverFunctionChanges,
  );
  const workflowEntries = formatWorkflowChangeEntries(
    results.workflow.changeSet,
    results.functionRegistry.workflowJobChanges,
  );
  const authHookEntries = formatAuthHookChangeEntries(
    results.auth.changeSet.authHook,
    results.functionRegistry.authHookFunctionChanges,
  );
  const tailorDBResourceEntries = formatTailorDBResourceChangeEntries(
    results.tailorDB.changeSet.type,
    results.tailorDB.changeSet.gqlPermission,
  );
  const tailorDBEntries: GroupedDisplayEntry[] = [...tailorDBResourceEntries];
  const pipelineEntries: GroupedDisplayEntry[] = [...resolverEntries];
  const namespaceOf = (item: HasName) => {
    if (
      "request" in item &&
      item.request &&
      typeof item.request === "object" &&
      "namespaceName" in item.request
    ) {
      return item.request.namespaceName as string;
    }
    if ("namespaceName" in item) {
      return item.namespaceName as string;
    }
    return undefined;
  };
  const authNamespaceOf = (item: HasName) =>
    "request" in item &&
    item.request &&
    typeof item.request === "object" &&
    "authNamespace" in item.request
      ? (item.request.authNamespace as string)
      : undefined;
  const idpEntries: GroupedDisplayEntry[] = [
    ...formatChangeSetEntries(results.idp.changeSet.client, ["client"], namespaceOf),
  ];
  const authEntries: GroupedDisplayEntry[] = [
    ...formatChangeSetEntries(results.auth.changeSet.idpConfig, ["idpConfig"], namespaceOf),
    ...formatChangeSetEntries(
      results.auth.changeSet.userProfileConfig,
      ["userProfileConfig"],
      namespaceOf,
    ),
    ...formatChangeSetEntries(results.auth.changeSet.tenantConfig, ["tenantConfig"], namespaceOf),
    ...formatChangeSetEntries(results.auth.changeSet.machineUser, ["machineUser"], authNamespaceOf),
    ...authHookEntries,
    ...formatChangeSetEntries(results.auth.changeSet.oauth2Client, ["oauth2Client"], namespaceOf),
    ...formatChangeSetEntries(results.auth.changeSet.scim, ["scimConfig"], namespaceOf),
    ...formatChangeSetEntries(results.auth.changeSet.scimResource, ["scimResource"], namespaceOf),
    ...formatChangeSetEntries(results.auth.changeSet.connection, ["connection"], namespaceOf),
  ];

  const { otherChanges: otherFunctionRegistryChanges } = splitFunctionRegistryChanges(
    results.functionRegistry.changeSet,
  );
  const tailorDBServiceActions = extractServiceActions(results.tailorDB.changeSet.service);
  const pipelineServiceActions = extractServiceActions(results.pipeline.changeSet.service);
  const idpServiceActions = extractServiceActions(results.idp.changeSet.service);
  const authServiceActions = extractServiceActions(results.auth.changeSet.service);

  const allDisplayEntries = [
    ...tailorDBEntries,
    ...pipelineEntries,
    ...executorEntries,
    ...workflowEntries,
    ...idpEntries,
    ...authEntries,
  ];
  const allServiceActions = [
    ...tailorDBServiceActions,
    ...pipelineServiceActions,
    ...idpServiceActions,
    ...authServiceActions,
  ];
  const summary = summarizePlanResults(results, allDisplayEntries, allServiceActions);

  const allUnmanaged = [
    ...results.functionRegistry.unmanaged,
    ...results.tailorDB.unmanaged,
    ...results.staticWebsite.unmanaged,
    ...results.aiGateway.unmanaged,
    ...results.idp.unmanaged,
    ...results.auth.unmanaged,
    ...results.pipeline.unmanaged,
    ...results.executor.unmanaged,
    ...results.workflow.unmanaged,
    ...results.secretManager.unmanaged,
  ];
  const allConflicts = [
    ...results.functionRegistry.conflicts,
    ...results.tailorDB.conflicts,
    ...results.staticWebsite.conflicts,
    ...results.aiGateway.conflicts,
    ...results.idp.conflicts,
    ...results.auth.conflicts,
    ...results.pipeline.conflicts,
    ...results.executor.conflicts,
    ...results.workflow.conflicts,
    ...results.secretManager.conflicts,
  ];

  const allEntries = [
    ...allDisplayEntries,
    ...tailorDBServiceActions.map(({ action, name }) => ({
      action,
      name,
      labels: ["tailorDB"],
      namespace: undefined,
    })),
    ...pipelineServiceActions.map(({ action, name }) => ({
      action,
      name,
      labels: ["pipeline"],
      namespace: undefined,
    })),
    ...idpServiceActions.map(({ action, name }) => ({
      action,
      name,
      labels: ["idp"],
      namespace: undefined,
    })),
    ...authServiceActions.map(({ action, name }) => ({
      action,
      name,
      labels: ["auth"],
      namespace: undefined,
    })),
    ...formatChangeSetEntries(otherFunctionRegistryChanges),
    ...formatChangeSetEntries(results.staticWebsite.changeSet, ["staticWebsite"]),
    ...formatChangeSetEntries(results.staticWebsite.customDomainChangeSet, ["customDomain"]),
    ...formatChangeSetEntries(results.aiGateway.changeSet, ["aiGateway"]),
    ...formatChangeSetEntries(results.app, ["application"]),
    ...formatChangeSetEntries(results.secretManager.vaultChangeSet, ["vault"]),
    ...formatChangeSetEntries(results.secretManager.secretChangeSet, ["secret"]),
  ];
  const changes = allEntries.map(({ action, name, labels, namespace }) => ({
    action,
    name,
    labels,
    namespace,
  }));
  const warnings = [
    ...allUnmanaged.map(({ resourceType, resourceName }) => ({
      type: "unmanaged" as const,
      resourceType,
      name: resourceName,
    })),
    ...results.secretManager.skippedSecrets.map((name) => ({
      type: "skippedSecret" as const,
      resourceType: "secret",
      name,
    })),
  ];
  const conflicts = allConflicts.map(({ resourceType, resourceName, currentOwner }) => ({
    resourceType,
    name: resourceName,
    currentOwner,
  }));

  const allLines: string[] = [
    ...buildGroupedDisplayLines(
      results.functionRegistry.changeSet.title,
      formatChangeSetEntries(otherFunctionRegistryChanges),
    ),
    ...results.staticWebsite.changeSet.lines(),
    ...results.staticWebsite.customDomainChangeSet.lines(),
    ...results.aiGateway.changeSet.lines(),
    ...results.app.lines(),
    ...buildGroupedDisplayLines("TailorDB", tailorDBEntries, tailorDBServiceActions),
    ...buildGroupedDisplayLines("Resolver", pipelineEntries, pipelineServiceActions),
    ...buildGroupedDisplayLines("Executor", executorEntries),
    ...buildGroupedDisplayLines("Workflow", workflowEntries),
    ...buildGroupedDisplayLines("IdP", idpEntries, idpServiceActions),
    ...buildGroupedDisplayLines("Auth", authEntries, authServiceActions),
    ...results.secretManager.vaultChangeSet.lines(),
    ...results.secretManager.secretChangeSet.lines(),
  ];

  if (allUnmanaged.length > 0) {
    allLines.push(styles.bold("Unmanaged resources (not in config):"));
    for (const { resourceType, resourceName } of allUnmanaged) {
      allLines.push(`  ${styles.warning("⚠")} ${styles.bold(resourceType)} "${resourceName}"`);
    }
  }

  if (results.secretManager.skippedSecrets.length > 0) {
    allLines.push(styles.bold("Secret Manager secrets (skipped - no value provided):"));
    for (const name of results.secretManager.skippedSecrets) {
      allLines.push(`  ${styles.dim("○")} ${name}`);
    }
  }

  if (allConflicts.length > 0) {
    allLines.push(styles.bold("Owner conflicts (will require confirmation on apply):"));
    for (const { resourceType, resourceName, currentOwner } of allConflicts) {
      allLines.push(
        `  ${styles.warning("!")} ${styles.bold(resourceType)} "${resourceName}" — owned by "${currentOwner}"`,
      );
    }
  }

  allLines.push(formatPlanSummary(summary));

  return {
    summary,
    json: { summary, changes, warnings, conflicts },
    lines: allLines,
  };
}

/**
 * Format and output the plan results, then return a summary of change counts.
 * In JSON dry-run mode a JSON payload is written to stdout. In all other modes
 * the human-readable diff goes to stdout (dry-run) or stderr (apply).
 * @param results - Planned results across all services
 * @param opts - Output options (dry-run mode flag)
 * @returns Aggregated plan summary counts
 */
export function printPlanResults(results: PlanResults, opts?: PrintPlanOptions): PlanSummary {
  const report = buildPlanReport(results);

  if (logger.jsonMode && opts?.dryRun) {
    logger.out(report.json);
    return report.summary;
  }

  const output = report.lines.join("\n");
  if (opts?.dryRun) {
    logger.out(output);
  } else {
    logger.log(output);
  }

  return report.summary;
}

/**
 * Summarize plan counts from display entries, service actions, and non-grouped changesets.
 * @param results - Planned apply results
 * @param displayEntries - All grouped display entries across sections
 * @param serviceActions - All service-level namespace actions
 * @returns Aggregated plan summary
 */
export function summarizePlanResults(
  results: PlanResults,
  displayEntries: ReadonlyArray<GroupedDisplayEntry>,
  serviceActions: ReadonlyArray<NamespaceAction>,
): PlanSummary {
  const summary: PlanSummary = { create: 0, update: 0, delete: 0, replace: 0 };

  // Count grouped display entries
  for (const entry of displayEntries) {
    summary[entry.action] += 1;
  }

  // Count service-level actions (shown as namespace headers)
  for (const sa of serviceActions) {
    summary[sa.action] += 1;
  }

  // Count non-grouped changesets (staticWebsite, app, secretManager, functionRegistry other)
  const { otherChanges } = splitFunctionRegistryChanges(results.functionRegistry.changeSet);
  const nonGrouped = summarizeChangeSets([
    otherChanges,
    results.staticWebsite.changeSet,
    results.staticWebsite.customDomainChangeSet,
    results.aiGateway.changeSet,
    results.app,
    results.secretManager.vaultChangeSet,
    results.secretManager.secretChangeSet,
  ]);
  summary.create += nonGrouped.create;
  summary.update += nonGrouped.update;
  summary.delete += nonGrouped.delete;
  summary.replace += nonGrouped.replace;

  return summary;
}

/**
 * Parse the deploy config option into one or more config paths.
 * @param configPath - Raw `--config` option value
 * @returns Config paths, or one undefined entry to preserve default config lookup
 */
export function parseDeployConfigPaths(configPath?: string): Array<string | undefined> {
  const rawConfigPath = configPath ?? process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH;
  if (rawConfigPath === undefined) {
    return [undefined];
  }

  const configPaths = rawConfigPath.split(",").map((entry) => entry.trim());
  if (configPaths.some((entry) => entry.length === 0)) {
    throw new Error("--config must contain one or more non-empty config paths.");
  }
  return configPaths;
}

async function buildDeploymentTarget(
  params: BuildDeploymentTargetParams,
): Promise<BuiltDeploymentTarget> {
  const { configPath, dryRun, buildOnly, noCache, packageVersion, cacheDir } = params;
  const { config, plugins } = await withSpan("build.loadConfig", async () => {
    const foundPath = loadConfigPath(configPath);
    if (foundPath) {
      const resolvedPath = path.resolve(process.cwd(), foundPath);
      if (fs.existsSync(resolvedPath)) {
        await ensureConfigIdForDeploy({ configPath: resolvedPath, dryRun, buildOnly });
      }
    }
    return loadConfig(configPath);
  });

  const configDir = path.dirname(config.path);
  const lockfilePath =
    findUpSync("pnpm-lock.yaml", { cwd: configDir }) ??
    findUpSync("package-lock.json", { cwd: configDir }) ??
    findUpSync("yarn.lock", { cwd: configDir }) ??
    findUpSync("bun.lock", { cwd: configDir });
  const cacheManager = createCacheManager({
    enabled: !noCache,
    cacheDir,
    sdkVersion: packageVersion,
    lockfileHash: lockfilePath ? hashFile(lockfilePath) : undefined,
  });

  let pluginManager: PluginManager | undefined;
  if (plugins.length > 0) {
    pluginManager = new PluginManager(plugins);
  }

  await withSpan("build.generateUserTypes", () =>
    generateUserTypes({ config, configPath: config.path }),
  );

  let application: Application;
  let workflowBuildResult: Awaited<ReturnType<typeof loadApplication>>["workflowBuildResult"];
  let httpAdapterBuildResult: Awaited<ReturnType<typeof loadApplication>>["httpAdapterBuildResult"];
  let bundledScripts: Awaited<ReturnType<typeof loadApplication>>["bundledScripts"];
  try {
    const result = await withSpan("build.loadApplication", () =>
      loadApplication({
        config,
        pluginManager,
        bundleCache: cacheManager.bundleCache,
      }),
    );
    application = result.application;
    workflowBuildResult = result.workflowBuildResult;
    httpAdapterBuildResult = result.httpAdapterBuildResult;
    bundledScripts = result.bundledScripts;
  } finally {
    cacheManager.finalize();
  }

  return {
    config,
    application,
    workflowBuildResult,
    httpAdapterBuildResult,
    bundledScripts,
  };
}

function addBundledScripts(
  target: Map<string, string>,
  source: ReadonlyMap<string, string>,
  kind: string,
): void {
  for (const [name, code] of source) {
    if (target.has(name)) {
      throw new Error(`Duplicate ${kind} bundle name "${name}" across config files.`);
    }
    target.set(name, code);
  }
}

function mergeBundledScripts(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
): BuiltDeploymentTarget["bundledScripts"] {
  const bundledScripts: BuiltDeploymentTarget["bundledScripts"] = {
    resolvers: new Map(),
    executors: new Map(),
    workflowJobs: new Map(),
    authHooks: new Map(),
  };

  for (const target of targets) {
    addBundledScripts(bundledScripts.resolvers, target.bundledScripts.resolvers, "resolver");
    addBundledScripts(bundledScripts.executors, target.bundledScripts.executors, "executor");
    addBundledScripts(
      bundledScripts.workflowJobs,
      target.bundledScripts.workflowJobs,
      "workflow job",
    );
    addBundledScripts(bundledScripts.authHooks, target.bundledScripts.authHooks, "auth hook");
  }

  return bundledScripts;
}

async function planDeploymentTarget(
  params: PlanDeploymentTargetParams,
): Promise<PlannedDeployment> {
  const { target, client, workspaceId, noSchemaCheck } = params;
  const { config, application, workflowBuildResult, httpAdapterBuildResult, bundledScripts } =
    target;

  await withSpan("plan.validateTailorDBTypeNames", () =>
    assertUniqueTailorDBTypeNamesWithExternal({
      client,
      workspaceId,
      tailorDBServices: application.tailorDBServices,
      externalTailorDBNamespaces: application.externalTailorDBNamespaces,
    }),
  );

  const workflowService = application.workflowService;
  const bundledWorkflowJobs = filterBundledWorkflowJobs(
    workflowService?.jobs ?? [],
    workflowBuildResult?.usedJobNames ?? [],
  );
  const functionEntries = collectFunctionEntries(application, bundledWorkflowJobs, bundledScripts);
  const forceApplyAll = await withSpan("plan.detectSdkVersionChange", () =>
    shouldForceApplyAll(client, workspaceId, application, functionEntries),
  );

  return withSpan("plan", async () => {
    const idpUserTriggerTargets = collectIdpUserTriggerTargets(application);
    const ctx: PlanContext = {
      client,
      workspaceId,
      application,
      forRemoval: false,
      config,
      noSchemaCheck,
      forceApplyAll,
      idpUserTriggerTargets,
    };
    const functionRegistry = await withSpan("plan.functionRegistry", () =>
      planFunctionRegistry(client, workspaceId, application.name, application.id, functionEntries),
    );
    const unchangedWorkflowJobs = new Set(
      functionRegistry.changeSet.unchanged
        .filter((entry) => entry.name.startsWith(WORKFLOW_PREFIX))
        .map((entry) => entry.name.slice(WORKFLOW_PREFIX.length)),
    );
    const [
      tailorDB,
      staticWebsite,
      aiGateway,
      idp,
      auth,
      pipeline,
      app,
      executor,
      workflow,
      secretManager,
    ] = await Promise.all([
      withSpan("plan.tailorDB", () => planTailorDB(ctx)),
      withSpan("plan.staticWebsite", () => planStaticWebsite(ctx)),
      withSpan("plan.aiGateway", () => planAIGateway(ctx)),
      withSpan("plan.idp", () => planIdP(ctx)),
      withSpan("plan.auth", () => planAuth(ctx)),
      withSpan("plan.pipeline", () => planPipeline(ctx)),
      withSpan("plan.application", () => planApplication(ctx, httpAdapterBuildResult)),
      withSpan("plan.executor", () => planExecutor(ctx)),
      withSpan("plan.workflow", () =>
        planWorkflow(
          client,
          workspaceId,
          application.name,
          application.id,
          workflowService?.workflows ?? {},
          workflowBuildResult?.mainJobDeps ?? {},
          unchangedWorkflowJobs,
        ),
      ),
      withSpan("plan.secretManager", () => planSecretManager(ctx)),
    ]);

    return {
      application,
      functionRegistry,
      tailorDB,
      staticWebsite,
      aiGateway,
      idp,
      auth,
      pipeline,
      app,
      executor,
      workflow,
      secretManager,
    };
  });
}

function deploymentPlanResults(deployment: PlannedDeployment): PlanResults {
  return {
    functionRegistry: deployment.functionRegistry,
    tailorDB: deployment.tailorDB,
    staticWebsite: deployment.staticWebsite,
    aiGateway: deployment.aiGateway,
    idp: deployment.idp,
    auth: deployment.auth,
    pipeline: deployment.pipeline,
    app: deployment.app,
    executor: deployment.executor,
    workflow: deployment.workflow,
    secretManager: deployment.secretManager,
  };
}

function collectOwnerConflicts(results: PlanResults): OwnerConflict[] {
  return [
    ...results.functionRegistry.conflicts,
    ...results.tailorDB.conflicts,
    ...results.staticWebsite.conflicts,
    ...results.aiGateway.conflicts,
    ...results.idp.conflicts,
    ...results.auth.conflicts,
    ...results.pipeline.conflicts,
    ...results.executor.conflicts,
    ...results.workflow.conflicts,
    ...results.secretManager.conflicts,
  ];
}

function collectUnmanagedResources(results: PlanResults): UnmanagedResource[] {
  return [
    ...results.functionRegistry.unmanaged,
    ...results.tailorDB.unmanaged,
    ...results.staticWebsite.unmanaged,
    ...results.aiGateway.unmanaged,
    ...results.idp.unmanaged,
    ...results.auth.unmanaged,
    ...results.pipeline.unmanaged,
    ...results.executor.unmanaged,
    ...results.workflow.unmanaged,
    ...results.secretManager.unmanaged,
  ];
}

function collectResourceOwners(results: PlanResults): Set<string> {
  return new Set([
    ...results.functionRegistry.resourceOwners,
    ...results.tailorDB.resourceOwners,
    ...results.staticWebsite.resourceOwners,
    ...results.aiGateway.resourceOwners,
    ...results.idp.resourceOwners,
    ...results.auth.resourceOwners,
    ...results.pipeline.resourceOwners,
    ...results.executor.resourceOwners,
    ...results.workflow.resourceOwners,
    ...results.secretManager.resourceOwners,
  ]);
}

function collectImportantResourceDeletions(results: PlanResults): ImportantResourceDeletion[] {
  const importantDeletions: ImportantResourceDeletion[] = [];
  for (const del of results.tailorDB.changeSet.type.deletes) {
    importantDeletions.push({
      resourceType: "TailorDB type",
      resourceName: del.name,
    });
  }
  for (const del of results.staticWebsite.changeSet.deletes) {
    importantDeletions.push({
      resourceType: "StaticWebsite",
      resourceName: del.name,
    });
  }
  for (const del of results.aiGateway.changeSet.deletes) {
    importantDeletions.push({
      resourceType: "AIGateway",
      resourceName: del.name,
    });
  }
  for (const del of results.auth.changeSet.oauth2Client.deletes) {
    importantDeletions.push({
      resourceType: "OAuth2 client",
      resourceName: del.name,
    });
  }
  for (const replace of results.auth.changeSet.oauth2Client.replaces) {
    importantDeletions.push({
      resourceType: "OAuth2 client (client type change)",
      resourceName: replace.name,
    });
  }
  for (const del of results.auth.changeSet.connection.deletes) {
    importantDeletions.push({
      resourceType: "Auth connection",
      resourceName: del.name,
    });
  }
  for (const del of results.secretManager.vaultChangeSet.deletes) {
    importantDeletions.push({
      resourceType: "Secret Manager vault",
      resourceName: del.name,
    });
  }
  for (const del of results.secretManager.secretChangeSet.deletes) {
    importantDeletions.push({
      resourceType: "Secret Manager secret",
      resourceName: del.name,
    });
  }
  return importantDeletions;
}

async function confirmDeploymentPlans(params: ConfirmDeploymentPlansParams): Promise<void> {
  const { deployments, yes } = params;
  const importantDeletions: ImportantResourceDeletion[] = [];

  for (const deployment of deployments) {
    const results = deploymentPlanResults(deployment);
    const conflicts = collectOwnerConflicts(results);
    await confirmOwnerConflict(conflicts, deployment.application.name, yes);

    const unmanaged = collectUnmanagedResources(results);
    await confirmUnmanagedResources(unmanaged, deployment.application.name, yes);

    importantDeletions.push(...collectImportantResourceDeletions(results));

    const emptyApps = computeRenamedAppDeletions({
      conflicts,
      resourceOwners: collectResourceOwners(results),
      targetAppName: deployment.application.name,
    });
    for (const emptyApp of emptyApps) {
      deployment.app.deletes.push({
        name: emptyApp,
        request: {
          workspaceId: deployment.tailorDB.context.workspaceId,
          applicationName: emptyApp,
        },
      });
    }
  }

  await confirmImportantResourceDeletion(importantDeletions, yes);
}

function sumPlanSummaries(summaries: ReadonlyArray<PlanSummary>): PlanSummary {
  return summaries.reduce<PlanSummary>(
    (acc, summary) => ({
      create: acc.create + summary.create,
      update: acc.update + summary.update,
      delete: acc.delete + summary.delete,
      replace: acc.replace + summary.replace,
    }),
    { create: 0, update: 0, delete: 0, replace: 0 },
  );
}

export function printDeploymentPlans(
  deployments: ReadonlyArray<PlannedDeployment>,
  opts?: PrintPlanOptions,
): PlanSummary {
  if (logger.jsonMode && opts?.dryRun) {
    const reports = deployments.map((deployment) =>
      buildPlanReport(deploymentPlanResults(deployment)),
    );
    const summary = sumPlanSummaries(reports.map((report) => report.summary));
    logger.out({
      summary,
      changes: reports.flatMap((report) => report.json.changes),
      warnings: reports.flatMap((report) => report.json.warnings),
      conflicts: reports.flatMap((report) => report.json.conflicts),
    });
    return summary;
  }

  const summaries = deployments.map((deployment) =>
    printPlanResults(deploymentPlanResults(deployment), opts),
  );
  return sumPlanSummaries(summaries);
}

async function validateDeploymentPlans(
  deployments: ReadonlyArray<PlannedDeployment>,
): Promise<void> {
  for (const deployment of deployments) {
    await validatePlan(deploymentPlanResults(deployment));
  }
}

/**
 * Deploy the configured application to the Tailor platform.
 * @param options - Options for deploy execution
 * @returns Promise that resolves to `{ bundledScripts }` when `buildOnly` is true, otherwise void
 */
export async function deploy(options?: DeployOptions) {
  return withSpan("deploy", async (rootSpan) => {
    rootSpan.setAttribute("deploy.dry_run", options?.dryRun ?? false);

    const configPaths = parseDeployConfigPaths(options?.configPath);
    const { targets, buildOnly } = await withSpan("build", async () => {
      const dryRun = options?.dryRun ?? false;
      const buildOnly =
        options?.buildOnly ?? parseBoolean(process.env.TAILOR_PLATFORM_SDK_BUILD_ONLY) === true;
      const noCache = options?.noCache ?? false;
      const packageJson = await readPackageJson();
      const cacheDir = path.resolve(getDistDir(), "cache");
      if (options?.cleanCache) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
        logger.info("Bundle cache cleaned");
      }

      const targets: BuiltDeploymentTarget[] = [];
      for (const configPath of configPaths) {
        targets.push(
          await buildDeploymentTarget({
            configPath,
            dryRun,
            buildOnly,
            noCache,
            packageVersion: packageJson.version ?? "unknown",
            cacheDir,
          }),
        );
      }

      return {
        targets,
        buildOnly,
      };
    });
    if (buildOnly) {
      return { bundledScripts: mergeBundledScripts(targets) };
    }

    // Note: the normal apply path intentionally skips writing bundle files to
    // .tailor-sdk/. Bundles are kept in memory and uploaded directly to the
    // function registry. To test a function locally, use `function test-run`
    // with a .ts source file instead of a pre-bundled .js file.

    // Initialize client
    const accessToken = await loadAccessToken({
      profile: options?.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = await loadWorkspaceId({
      workspaceId: options?.workspaceId,
      profile: options?.profile,
    });

    rootSpan.setAttribute("app.name", targets.map((target) => target.application.name).join(","));
    rootSpan.setAttribute("workspace.id", workspaceId);

    const deployments: PlannedDeployment[] = [];
    for (const target of targets) {
      deployments.push(
        await planDeploymentTarget({
          target,
          client,
          workspaceId,
          noSchemaCheck: options?.noSchemaCheck,
        }),
      );
    }

    const dryRun = options?.dryRun ?? false;
    const yes = options?.yes ?? false;

    // Phase 1b: Confirm
    await withSpan("confirm", async () => {
      await confirmDeploymentPlans({ deployments, yes });
    });

    const planSummary = printDeploymentPlans(deployments, { dryRun: options?.dryRun });

    if (options?.noValidate) {
      logger.warn("Client-side validation skipped (--no-validate).");
    } else {
      await validateDeploymentPlans(deployments);
    }

    if (dryRun) {
      logger.info("Dry run enabled. No changes applied.");
      return undefined;
    }

    await applyDeploymentPlans(client, workspaceId, deployments);

    if (logger.jsonMode) {
      logger.out({ summary: planSummary, status: "applied" });
    } else {
      logger.success("Successfully applied changes.");
    }

    return undefined;
  });
}
