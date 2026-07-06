import * as fs from "node:fs";
import { findUpSync } from "find-up-simple";
import * as path from "pathe";
import { hashFile } from "#/cli/cache/hasher";
import { createCacheManager } from "#/cli/cache/manager";
import { loadApplication, type Application } from "#/cli/services/application";
import { assertUniqueTailorDBTypeNamesWithExternal } from "#/cli/services/tailordb/type-name-validation";
import { getOrNull, initOperatorClient, type OperatorClient } from "#/cli/shared/client";
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
import {
  buildPlannedExecutorsByName,
  collectApplicationIdpNames,
  findResolverNamespace,
  findTailorDBNamespace,
  formatExecutorChangeEntries,
  planExecutor,
  resolveSameRunNamespace,
} from "./executor";
import {
  collectFunctionEntries,
  filterBundledWorkflowJobs,
  planFunctionRegistry,
  resolverFunctionName,
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
  const idps = collectApplicationIdpNames(application);
  for (const executor of Object.values(application.executorService?.executors ?? {})) {
    if (executor.trigger.kind !== "idpUser") {
      continue;
    }
    if (executor.trigger.idp != null) {
      targets.add(executor.trigger.idp);
    } else if (idps.size === 1) {
      const [idp] = idps;
      if (idp) targets.add(idp);
    }
  }
  return targets;
}

function collectDeployIdpUserTriggerTargets(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
): ReadonlySet<string> {
  const triggerTargets = new Set<string>();
  for (const target of targets) {
    for (const idpName of collectIdpUserTriggerTargets(target.application)) {
      triggerTargets.add(idpName);
    }
  }
  return triggerTargets;
}

function collectExecutorUsedTailorDBTypes(
  owner: BuiltDeploymentTarget,
  targets: ReadonlyArray<BuiltDeploymentTarget>,
): ReadonlySet<string> {
  const usedTypes = new Set<string>();
  const ownerNamespaces = new Set(
    owner.application.tailorDBServices.map((service) => service.namespace),
  );
  const applications = targets.map((target) => target.application);
  for (const target of targets) {
    const visibleNamespaces = collectVisibleTailorDBTypeNamespaces(
      target.application,
      applications,
    );
    for (const executor of Object.values(target.application.executorService?.executors ?? {})) {
      if (executor.trigger.kind === "tailordb") {
        const namespace =
          findTailorDBNamespace(target.application, executor.trigger.typeName) ??
          resolveSameRunNamespace(visibleNamespaces, executor.trigger.typeName, "TailorDB type");
        if (namespace && ownerNamespaces.has(namespace)) {
          usedTypes.add(executor.trigger.typeName);
        }
      }
    }
  }
  return usedTypes;
}

function collectExecutorUsedResolvers(
  owner: BuiltDeploymentTarget,
  targets: ReadonlyArray<BuiltDeploymentTarget>,
): ReadonlySet<string> {
  const usedResolvers = new Set<string>();
  const ownerNamespaces = new Set(
    owner.application.resolverServices.map((service) => service.namespace),
  );
  const applications = targets.map((target) => target.application);
  for (const target of targets) {
    const visibleNamespaces = collectVisibleResolverNamespaces(target.application, applications);
    for (const executor of Object.values(target.application.executorService?.executors ?? {})) {
      if (executor.trigger.kind === "resolverExecuted") {
        const namespace =
          findResolverNamespace(target.application, executor.trigger.resolverName) ??
          resolveSameRunNamespace(visibleNamespaces, executor.trigger.resolverName, "Resolver");
        if (namespace && ownerNamespaces.has(namespace)) {
          usedResolvers.add(executor.trigger.resolverName);
        }
      }
    }
  }
  return usedResolvers;
}

function collectExpectedLocalStaticWebsiteNames(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
): ReadonlySet<string> {
  const websiteNames = new Set<string>();
  for (const target of targets) {
    for (const website of target.application.staticWebsiteServices) {
      websiteNames.add(website.name);
    }
  }
  return websiteNames;
}

function addPossiblyAmbiguousNamespace(
  namespaces: Map<string, string | undefined>,
  key: string,
  namespace: string,
): void {
  if (namespaces.has(key)) {
    if (namespaces.get(key) !== namespace) {
      namespaces.set(key, undefined);
    }
    return;
  }
  namespaces.set(key, namespace);
}

type VisibleResource = {
  visibilityKey: string;
  resourceKey: string;
};

type CollectVisibleResourcesParams<TResult> = {
  application: Readonly<Application>;
  applications: ReadonlyArray<Readonly<Application>>;
  visibleKeysOf: (application: Readonly<Application>) => ReadonlySet<string>;
  resourcesOf: (application: Readonly<Application>) => Iterable<VisibleResource>;
  createResult: () => TResult;
  addResource: (result: TResult, resourceKey: string, visibilityKey: string) => void;
};

function collectVisibleResources<TResult>(params: CollectVisibleResourcesParams<TResult>): TResult {
  const { application, applications, visibleKeysOf, resourcesOf, createResult, addResource } =
    params;
  const visibleKeys = visibleKeysOf(application);
  const result = createResult();
  for (const candidate of applications) {
    for (const resource of resourcesOf(candidate)) {
      if (!visibleKeys.has(resource.visibilityKey)) {
        continue;
      }
      addResource(result, resource.resourceKey, resource.visibilityKey);
    }
  }
  return result;
}

function collectApplicationTailorDBNamespaces(
  application: Readonly<Application>,
): ReadonlySet<string> {
  return new Set([
    ...application.tailorDBServices.map((service) => service.namespace),
    ...application.externalTailorDBNamespaces,
  ]);
}

function* tailorDBTypeResources(application: Readonly<Application>): Iterable<VisibleResource> {
  for (const service of application.tailorDBServices) {
    for (const typeName of Object.keys(service.types)) {
      yield { visibilityKey: service.namespace, resourceKey: typeName };
    }
  }
}

export function collectVisibleTailorDBTypeNamespaces(
  application: Readonly<Application>,
  applications: ReadonlyArray<Readonly<Application>>,
): ReadonlyMap<string, string | undefined> {
  return collectVisibleResources({
    application,
    applications,
    visibleKeysOf: collectApplicationTailorDBNamespaces,
    resourcesOf: tailorDBTypeResources,
    createResult: () => new Map<string, string | undefined>(),
    addResource: addPossiblyAmbiguousNamespace,
  });
}

function collectApplicationResolverNamespaces(
  application: Readonly<Application>,
): ReadonlySet<string> {
  return new Set(
    application.subgraphs
      .filter((subgraph) => subgraph.Type === "pipeline")
      .map((subgraph) => subgraph.Name),
  );
}

function* idpNameResources(application: Readonly<Application>): Iterable<VisibleResource> {
  for (const name of collectApplicationIdpNames(application)) {
    yield { visibilityKey: name, resourceKey: name };
  }
}

export function collectVisibleIdpNames(
  application: Readonly<Application>,
  applications: ReadonlyArray<Readonly<Application>>,
): ReadonlySet<string> {
  return collectVisibleResources({
    application,
    applications,
    visibleKeysOf: collectApplicationIdpNames,
    resourcesOf: idpNameResources,
    createResult: () => new Set<string>(),
    addResource: (names, name) => {
      names.add(name);
    },
  });
}

function* resolverResources(application: Readonly<Application>): Iterable<VisibleResource> {
  for (const service of application.resolverServices) {
    for (const resolver of Object.values(service.resolvers)) {
      yield { visibilityKey: service.namespace, resourceKey: resolver.name };
    }
  }
}

export function collectVisibleResolverNamespaces(
  application: Readonly<Application>,
  applications: ReadonlyArray<Readonly<Application>>,
): ReadonlyMap<string, string | undefined> {
  return collectVisibleResources({
    application,
    applications,
    visibleKeysOf: collectApplicationResolverNamespaces,
    resourcesOf: resolverResources,
    createResult: () => new Map<string, string | undefined>(),
    addResource: addPossiblyAmbiguousNamespace,
  });
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
    const metadata = await getOrNull(async () => {
      const { metadata } = await client.getMetadata({ trn });
      return metadata;
    });
    if (metadata?.labels[sdkNameLabelKey] !== application.name) {
      continue;
    }
    if (!hasMatchingSdkVersion(metadata.labels, desiredLabels)) {
      return true;
    }
  }

  return false;
}

/**
 * Decide which renamed-away applications should be deleted. Excludes the
 * deploy targets themselves: id regeneration alone keeps the name unchanged,
 * so deleting by name would destroy a live app.
 * @param params - Inputs for the computation
 * @param params.conflicts - Detected owner conflicts across all services
 * @param params.resourceOwners - App names that still own resources we don't manage
 * @param params.protectedAppNames - App names that must not be deleted
 * @returns Names of empty old applications that should be deleted
 */
export function computeRenamedAppDeletions(params: {
  conflicts: ReadonlyArray<Pick<OwnerConflict, "currentOwner">>;
  resourceOwners: ReadonlySet<string>;
  protectedAppNames: ReadonlySet<string>;
}): string[] {
  const { conflicts, resourceOwners, protectedAppNames } = params;
  const conflictOwners = new Set(conflicts.map((c) => c.currentOwner));
  return [...conflictOwners].filter(
    (owner) => !resourceOwners.has(owner) && !protectedAppNames.has(owner),
  );
}

type PlanResults = Omit<PlannedDeployment, "application">;

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

type BuildDeploymentTargetsParams = Omit<BuildDeploymentTargetParams, "configPath"> & {
  configPaths: ReadonlyArray<string | undefined>;
  buildTarget?: (params: BuildDeploymentTargetParams) => Promise<BuiltDeploymentTarget>;
};

type DeployRunPlanInputs = Pick<
  PlanContext,
  "idpUserTriggerTargets" | "expectedLocalStaticWebsiteNames" | "externalAuthIdpConfigNames"
>;

type PlanDeploymentTargetParams = {
  target: BuiltDeploymentTarget;
  targets: ReadonlyArray<BuiltDeploymentTarget>;
  runInputs: DeployRunPlanInputs;
  client: OperatorClient;
  workspaceId: string;
  noSchemaCheck: boolean | undefined;
};

type ConfirmDeploymentPlansParams = {
  deployments: PlannedDeployment[];
  yes: boolean;
};

type PlanDeploymentTargetsParams = {
  targets: ReadonlyArray<BuiltDeploymentTarget>;
  runInputs: DeployRunPlanInputs;
  client: OperatorClient;
  workspaceId: string;
  noSchemaCheck: boolean | undefined;
  planTarget?: (params: PlanDeploymentTargetParams) => Promise<PlannedDeployment>;
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

export async function buildDeploymentTargets(
  params: BuildDeploymentTargetsParams,
): Promise<BuiltDeploymentTarget[]> {
  const { configPaths, buildTarget = buildDeploymentTarget, ...targetParams } = params;
  return Promise.all(
    configPaths.map((configPath) =>
      buildTarget({
        ...targetParams,
        configPath,
      }),
    ),
  );
}

function setBundledScript(
  target: Map<string, string>,
  name: string,
  code: string,
  kind: string,
): void {
  if (target.has(name)) {
    throw new Error(`Duplicate ${kind} bundle name "${name}" across config files.`);
  }
  target.set(name, code);
}

function addBundledScripts(
  target: Map<string, string>,
  source: ReadonlyMap<string, string>,
  kind: string,
): void {
  for (const [name, code] of source) {
    setBundledScript(target, name, code, kind);
  }
}

function collectDuplicateBundleNames(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
  select: (target: BuiltDeploymentTarget) => ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const target of targets) {
    for (const name of select(target).keys()) {
      if (seen.has(name)) {
        duplicates.add(name);
      }
      seen.add(name);
    }
  }
  return duplicates;
}

function addResolverBundledScripts(
  target: Map<string, string>,
  source: BuiltDeploymentTarget,
  duplicateNames: ReadonlySet<string>,
): void {
  const consumedNames = new Set<string>();
  for (const service of source.application.resolverServices) {
    for (const resolver of Object.values(service.resolvers)) {
      const code = source.bundledScripts.resolvers.get(resolver.name);
      if (code === undefined) {
        continue;
      }
      const name = duplicateNames.has(resolver.name)
        ? resolverFunctionName(service.namespace, resolver.name)
        : resolver.name;
      setBundledScript(target, name, code, "resolver");
      consumedNames.add(resolver.name);
    }
  }
  for (const [name, code] of source.bundledScripts.resolvers) {
    if (!consumedNames.has(name)) {
      setBundledScript(target, name, code, "resolver");
    }
  }
}

/**
 * Merge per-config bundled scripts into one build-only result.
 * @param targets - Built deployment targets to merge
 * @returns Combined bundled scripts across all targets
 */
export function mergeBundledScripts(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
): BuiltDeploymentTarget["bundledScripts"] {
  const bundledScripts: BuiltDeploymentTarget["bundledScripts"] = {
    resolvers: new Map(),
    executors: new Map(),
    workflowJobs: new Map(),
    authHooks: new Map(),
  };
  const duplicateResolverNames = collectDuplicateBundleNames(
    targets,
    (target) => target.bundledScripts.resolvers,
  );

  for (const target of targets) {
    addResolverBundledScripts(bundledScripts.resolvers, target, duplicateResolverNames);
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

/**
 * Reject resource names that collide across configs. Each checked resource
 * type is workspace-global (its TRN is not qualified by namespace or app), so
 * a duplicate name would make two configs target the same platform resource:
 * one config's apply could overwrite the other's, or a fresh create could be
 * attempted twice. Resolver and auth-hook function names are namespace- or
 * app-qualified and are intentionally excluded.
 * @param targets - Built deployment targets to check
 */
export function assertUniqueGlobalResourceNames(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
): void {
  for (const check of DEPLOY_MANAGED_RESOURCE_DEFINITIONS) {
    const seen = new Set<string>();
    for (const target of targets) {
      for (const name of check.namesOf(target)) {
        if (seen.has(name)) {
          throw new Error(
            `Duplicate ${check.resourceLabel} name "${name}" across config files. ${check.resourceLabel} names must be unique across all configs in a single deploy.`,
          );
        }
        seen.add(name);
      }
    }
  }
}

function collectPlannedExternalTailorDBServices(
  target: BuiltDeploymentTarget,
  targets: ReadonlyArray<BuiltDeploymentTarget>,
): Application["tailorDBServices"] {
  const externalNamespaces = new Set(target.application.externalTailorDBNamespaces);
  if (externalNamespaces.size === 0) {
    return [];
  }

  return targets.flatMap((candidate) =>
    candidate.application.tailorDBServices.filter((service) =>
      externalNamespaces.has(service.namespace),
    ),
  );
}

export function collectExternalAuthIdpConfigNames(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
): ReadonlyMap<string, string | undefined> {
  const idpConfigNames = new Map<string, string | undefined>();
  for (const target of targets) {
    const authService = target.application.authService;
    if (!authService) {
      continue;
    }
    const { name } = authService.config;
    const idpConfigName = authService.config.idProvider?.name;
    if (idpConfigNames.has(name) && idpConfigNames.get(name) !== idpConfigName) {
      throw new Error(
        `Auth namespace "${name}" is defined by multiple config files with different IdP configs. ` +
          `Auth namespace names must be unique across all configs in a single deploy.`,
      );
    }
    idpConfigNames.set(name, idpConfigName);
  }
  return idpConfigNames;
}

function collectDeployRunPlanInputs(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
): DeployRunPlanInputs {
  return {
    idpUserTriggerTargets: collectDeployIdpUserTriggerTargets(targets),
    expectedLocalStaticWebsiteNames: collectExpectedLocalStaticWebsiteNames(targets),
    externalAuthIdpConfigNames: collectExternalAuthIdpConfigNames(targets),
  };
}

async function planDeploymentTarget(
  params: PlanDeploymentTargetParams,
): Promise<PlannedDeployment> {
  const { target, targets, runInputs, client, workspaceId, noSchemaCheck } = params;
  const { config, application, workflowBuildResult, httpAdapterBuildResult, bundledScripts } =
    target;

  await withSpan("plan.validateTailorDBTypeNames", () =>
    assertUniqueTailorDBTypeNamesWithExternal({
      client,
      workspaceId,
      tailorDBServices: application.tailorDBServices,
      externalTailorDBNamespaces: application.externalTailorDBNamespaces,
      plannedExternalTailorDBServices: collectPlannedExternalTailorDBServices(target, targets),
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
    const applications = targets.map((target) => target.application);
    const tailorDBTypeNamespaces = collectVisibleTailorDBTypeNamespaces(application, applications);
    const resolverNamespaces = collectVisibleResolverNamespaces(application, applications);
    const idpNames = collectVisibleIdpNames(application, applications);
    const ctx: PlanContext = {
      client,
      workspaceId,
      application,
      forRemoval: false,
      config,
      noSchemaCheck,
      forceApplyAll,
      ...runInputs,
      executorUsedTailorDBTypes: collectExecutorUsedTailorDBTypes(target, targets),
      executorUsedResolvers: collectExecutorUsedResolvers(target, targets),
      tailorDBTypeNamespaces,
      resolverNamespaces,
      idpNames,
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

export async function planDeploymentTargets(
  params: PlanDeploymentTargetsParams,
): Promise<PlannedDeployment[]> {
  const { targets, planTarget = planDeploymentTarget, ...planParams } = params;
  return Promise.all(
    targets.map((target) =>
      planTarget({
        ...planParams,
        target,
        targets,
      }),
    ),
  );
}

function deploymentPlanResults(deployment: PlannedDeployment): PlanResults {
  const { application: _application, ...results } = deployment;
  return results;
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

type WorkflowJobFunctionItem = { jobFunctionName: string };
type ManagedResourceItem = HasName | WorkflowJobFunctionItem;

type ManagedResourceChangeSet = {
  creates: ManagedResourceItem[];
  updates: ManagedResourceItem[];
  deletes: ManagedResourceItem[];
  replaces: ManagedResourceItem[];
  unchanged: ManagedResourceItem[];
};

type ManagedResourceGroup = {
  changeSet: ManagedResourceChangeSet;
  resourceType: string;
  namespaceFields?: readonly string[];
  namespaceOwnerResourceType?: string;
  getName?: (item: ManagedResourceItem) => string;
};

function readResourceField(item: ManagedResourceItem, field: string): string | undefined {
  const itemRecord = item as unknown as Record<string, unknown>;
  for (const requestField of ["request", "deleteRequest", "createRequest"]) {
    const request = itemRecord[requestField];
    if (request && typeof request === "object" && field in request) {
      const value = (request as Record<string, unknown>)[field];
      return value == null ? undefined : String(value);
    }
  }

  const value = itemRecord[field];
  return value == null ? undefined : String(value);
}

function managedResourceName(group: ManagedResourceGroup, item: ManagedResourceItem): string {
  if (group.getName) {
    return group.getName(item);
  }
  return (item as HasName).name;
}

function managedResourceKey(group: ManagedResourceGroup, item: ManagedResourceItem): string {
  const namespace = group.namespaceFields
    ?.map((field) => readResourceField(item, field))
    .find((value) => value !== undefined);
  const name = managedResourceName(group, item);
  return namespace !== undefined
    ? `${group.resourceType}:${namespace}:${name}`
    : `${group.resourceType}:${name}`;
}

function managedNamespaceOwnerKey(
  group: ManagedResourceGroup,
  item: ManagedResourceItem,
): string | undefined {
  if (!group.namespaceOwnerResourceType) {
    return undefined;
  }
  const namespace = group.namespaceFields
    ?.map((field) => readResourceField(item, field))
    .find((value) => value !== undefined);
  return namespace !== undefined ? `${group.namespaceOwnerResourceType}:${namespace}` : undefined;
}

function addManagedResourceClaims(
  claims: Set<string>,
  group: ManagedResourceGroup,
  item: ManagedResourceItem,
): void {
  claims.add(managedResourceKey(group, item));
  const namespaceOwnerKey = managedNamespaceOwnerKey(group, item);
  if (namespaceOwnerKey) {
    claims.add(namespaceOwnerKey);
  }
}

function isManagedResourceClaimed(
  claims: ReadonlySet<string>,
  group: ManagedResourceGroup,
  item: ManagedResourceItem,
): boolean {
  if (claims.has(managedResourceKey(group, item))) {
    return true;
  }
  const namespaceOwnerKey = managedNamespaceOwnerKey(group, item);
  return namespaceOwnerKey ? claims.has(namespaceOwnerKey) : false;
}

function retainDeletesNotClaimed(
  group: ManagedResourceGroup,
  otherClaims: ReadonlySet<string>,
): void {
  let writeIndex = 0;
  for (const item of group.changeSet.deletes) {
    if (isManagedResourceClaimed(otherClaims, group, item)) {
      logger.debug(
        `Skipping delete of ${managedResourceKey(group, item)}: still managed by another config in this deploy.`,
      );
      continue;
    }
    group.changeSet.deletes[writeIndex] = item;
    writeIndex += 1;
  }
  group.changeSet.deletes.length = writeIndex;
}

function workflowJobFunctionItems(items: ReadonlyArray<ManagedResourceItem>): HasName[] {
  const jobNames = new Set<string>();
  for (const item of items) {
    const usedJobNames = (item as unknown as { usedJobNames?: unknown }).usedJobNames;
    if (!Array.isArray(usedJobNames)) {
      continue;
    }
    for (const jobName of usedJobNames) {
      if (typeof jobName === "string") {
        jobNames.add(jobName);
      }
    }
  }
  return [...jobNames].map((name) => ({ name }));
}

function workflowJobFunctionResourceGroup(results: PlanResults): ManagedResourceGroup {
  return {
    changeSet: {
      creates: workflowJobFunctionItems(results.workflow.changeSet.creates),
      updates: workflowJobFunctionItems(results.workflow.changeSet.updates),
      replaces: workflowJobFunctionItems(results.workflow.changeSet.replaces),
      unchanged: [...results.workflow.unchangedWorkflowJobNames].map((name) => ({ name })),
      deletes: results.workflow.jobFunctionDeletes,
    },
    resourceType: "workflow_job_function",
    getName: (item) => ("jobFunctionName" in item ? item.jobFunctionName : item.name),
  };
}

const MANAGED_RESOURCE_NAMESPACE_FIELDS = [
  "namespaceName",
  "authNamespace",
  "vaultName",
  "staticWebsiteName",
] as const;

type DeployManagedResourceDefinition = Omit<ManagedResourceGroup, "changeSet"> & {
  resourceLabel: string;
  namesOf: (target: BuiltDeploymentTarget) => Iterable<string>;
  changeSetOf: (results: PlanResults) => ManagedResourceChangeSet;
};

const DEPLOY_MANAGED_RESOURCE_DEFINITIONS: ReadonlyArray<DeployManagedResourceDefinition> = [
  {
    resourceLabel: "Application",
    resourceType: "application",
    namesOf: (target) => [target.application.name],
    changeSetOf: (results) => results.app,
  },
  {
    resourceLabel: "Executor",
    resourceType: "executor",
    namesOf: (target) =>
      Object.values(target.application.executorService?.executors ?? {}).map(
        (executor) => executor.name,
      ),
    changeSetOf: (results) => results.executor.changeSet,
  },
  {
    resourceLabel: "Workflow job",
    resourceType: "workflow_job_function",
    namesOf: (target) => target.bundledScripts.workflowJobs.keys(),
    changeSetOf: (results) => workflowJobFunctionResourceGroup(results).changeSet,
    getName: (item) => ("jobFunctionName" in item ? item.jobFunctionName : item.name),
  },
  {
    resourceLabel: "Workflow",
    resourceType: "workflow",
    namesOf: (target) =>
      Object.values(target.application.workflowService?.workflows ?? {}).map(
        (workflow) => workflow.name,
      ),
    changeSetOf: (results) => results.workflow.changeSet,
  },
  {
    resourceLabel: "Auth connection",
    resourceType: "auth.connection",
    namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
    namespaceOwnerResourceType: "auth.service",
    namesOf: (target) => Object.keys(target.application.authService?.connections ?? {}),
    changeSetOf: (results) => results.auth.changeSet.connection,
  },
  {
    resourceLabel: "StaticWebsite",
    resourceType: "staticwebsite",
    namesOf: (target) => target.application.staticWebsiteServices.map((service) => service.name),
    changeSetOf: (results) => results.staticWebsite.changeSet,
  },
  {
    resourceLabel: "TailorDB namespace",
    resourceType: "tailordb.service",
    namesOf: (target) => target.application.tailorDBServices.map((service) => service.namespace),
    changeSetOf: (results) => results.tailorDB.changeSet.service,
  },
  {
    resourceLabel: "Auth namespace",
    resourceType: "auth.service",
    namesOf: (target) => {
      const name = target.application.authService?.config.name;
      return name === undefined ? [] : [name];
    },
    changeSetOf: (results) => results.auth.changeSet.service,
  },
  {
    resourceLabel: "IdP namespace",
    resourceType: "idp.service",
    namesOf: (target) => target.application.idpServices.map((idp) => idp.name),
    changeSetOf: (results) => results.idp.changeSet.service,
  },
  {
    resourceLabel: "Resolver namespace",
    resourceType: "pipeline.service",
    namesOf: (target) => target.application.resolverServices.map((service) => service.namespace),
    changeSetOf: (results) => results.pipeline.changeSet.service,
  },
  {
    resourceLabel: "AIGateway",
    resourceType: "aigateway",
    namesOf: (target) => target.application.aiGatewayServices.map((service) => service.name),
    changeSetOf: (results) => results.aiGateway.changeSet,
  },
  {
    resourceLabel: "Secret Manager vault",
    resourceType: "secret.vault",
    namesOf: (target) => target.application.secrets.map((vault) => vault.vaultName),
    changeSetOf: (results) => results.secretManager.vaultChangeSet,
  },
];

function managedResourceGroupFromDefinition(
  definition: DeployManagedResourceDefinition,
  results: PlanResults,
): ManagedResourceGroup {
  const { changeSetOf, namesOf: _namesOf, resourceLabel: _resourceLabel, ...group } = definition;
  return {
    ...group,
    changeSet: changeSetOf(results),
  };
}

function managedResourceGroups(results: PlanResults): ManagedResourceGroup[] {
  return [
    { changeSet: results.functionRegistry.changeSet, resourceType: "function_registry" },
    ...DEPLOY_MANAGED_RESOURCE_DEFINITIONS.map((definition) =>
      managedResourceGroupFromDefinition(definition, results),
    ),
    {
      changeSet: results.tailorDB.changeSet.type,
      resourceType: "tailordb.type",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "tailordb.service",
    },
    {
      changeSet: results.tailorDB.changeSet.gqlPermission,
      resourceType: "tailordb.gql_permission",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "tailordb.service",
    },
    {
      changeSet: results.staticWebsite.customDomainChangeSet,
      resourceType: "staticwebsite.custom_domain",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "staticwebsite",
    },
    {
      changeSet: results.idp.changeSet.client,
      resourceType: "idp.client",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "idp.service",
    },
    {
      changeSet: results.auth.changeSet.idpConfig,
      resourceType: "auth.idp_config",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.auth.changeSet.userProfileConfig,
      resourceType: "auth.user_profile_config",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.auth.changeSet.tenantConfig,
      resourceType: "auth.tenant_config",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.auth.changeSet.machineUser,
      resourceType: "auth.machine_user",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.auth.changeSet.oauth2Client,
      resourceType: "auth.oauth2_client",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.auth.changeSet.authHook,
      resourceType: "auth.hook",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.auth.changeSet.scim,
      resourceType: "auth.scim",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.auth.changeSet.scimResource,
      resourceType: "auth.scim_resource",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "auth.service",
    },
    {
      changeSet: results.pipeline.changeSet.resolver,
      resourceType: "pipeline.resolver",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "pipeline.service",
    },
    {
      changeSet: results.secretManager.secretChangeSet,
      resourceType: "secret.secret",
      namespaceFields: MANAGED_RESOURCE_NAMESPACE_FIELDS,
      namespaceOwnerResourceType: "secret.vault",
    },
  ];
}

export function dropCrossDeploymentManagedDeletes(
  deployments: ReadonlyArray<PlannedDeployment>,
): void {
  const groupsByDeployment = deployments.map((deployment) =>
    managedResourceGroups(deploymentPlanResults(deployment)),
  );
  const claimsByDeployment = groupsByDeployment.map((groups) =>
    groups.reduce((claims, group) => {
      for (const item of [
        ...group.changeSet.creates,
        ...group.changeSet.updates,
        ...group.changeSet.replaces,
        ...group.changeSet.unchanged,
      ]) {
        addManagedResourceClaims(claims, group, item);
      }
      return claims;
    }, new Set<string>()),
  );

  groupsByDeployment.forEach((groups, deploymentIndex) => {
    const otherClaims = new Set<string>();
    claimsByDeployment.forEach((claims, claimIndex) => {
      if (claimIndex === deploymentIndex) {
        return;
      }
      for (const claim of claims) {
        otherClaims.add(claim);
      }
    });

    for (const group of groups) {
      retainDeletesNotClaimed(group, otherClaims);
    }
  });
}

function collectDeploymentResourceOwners(
  deployments: ReadonlyArray<PlannedDeployment>,
): Set<string> {
  const owners = new Set<string>();
  for (const deployment of deployments) {
    for (const owner of collectResourceOwners(deploymentPlanResults(deployment))) {
      owners.add(owner);
    }
  }
  return owners;
}

export async function confirmDeploymentPlans(params: ConfirmDeploymentPlansParams): Promise<void> {
  const { deployments, yes } = params;
  const targetAppNames = new Set(deployments.map((deployment) => deployment.application.name));
  const resourceOwners = collectDeploymentResourceOwners(deployments);
  const scheduledRenamedAppDeletes = new Set<string>();
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
      resourceOwners,
      protectedAppNames: targetAppNames,
    });
    for (const emptyApp of emptyApps) {
      if (scheduledRenamedAppDeletes.has(emptyApp)) {
        continue;
      }
      scheduledRenamedAppDeletes.add(emptyApp);
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

      const targets = await buildDeploymentTargets({
        configPaths,
        dryRun,
        buildOnly,
        noCache,
        packageVersion: packageJson.version ?? "unknown",
        cacheDir,
      });

      return {
        targets,
        buildOnly,
      };
    });
    if (buildOnly) {
      return { bundledScripts: mergeBundledScripts(targets) };
    }

    assertUniqueGlobalResourceNames(targets);

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

    const runInputs = collectDeployRunPlanInputs(targets);
    const deployments = await planDeploymentTargets({
      targets,
      runInputs,
      client,
      workspaceId,
      noSchemaCheck: options?.noSchemaCheck,
    });

    const dryRun = options?.dryRun ?? false;
    const yes = options?.yes ?? false;

    dropCrossDeploymentManagedDeletes(deployments);

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
