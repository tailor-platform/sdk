import * as fs from "node:fs";
import * as path from "pathe";
import { type Application } from "#/cli/services/application";
import { assertUniqueTailorDBTypeNamesWithExternal } from "#/cli/services/tailordb/type-name-validation";
import { recoveryContextArgs } from "#/cli/shared/args";
import {
  getOrNull,
  hasStaticWebsiteUrlPlaceholder,
  staticWebsiteNameFromPlaceholder,
  type OperatorClient,
} from "#/cli/shared/client";
import { getDistDir } from "#/cli/shared/dist-dir";
import { CLIError, internalError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { readPackageJson } from "#/cli/shared/package-json";
import { parseBoolean } from "#/cli/shared/parse-boolean";
import { beginUserModuleRun } from "#/cli/shared/user-modules";
import { withSpan } from "#/cli/telemetry/index";
import { assertDefined } from "#/utils/assert";
import { beginWaitPointScope } from "#/utils/wait-point-registry";
import { planAIGateway } from "./aigateway";
import { planApplication } from "./application";
import {
  applyPrerequisiteResources,
  applyRemainingResources,
  deploymentPlanResults,
  preflightAllTailorDB,
  type PlannedDeployment,
  type ReusablePlanKind,
} from "./apply-phases";
import { planAuth } from "./auth";
import { mergeBundledScripts } from "./bundled-scripts";
import { type PlanSummary } from "./change-set";
import {
  confirmImportantResourceDeletion,
  confirmMigrationCheckpointRepairs,
  confirmMissingDependentApps,
  confirmOwnerConflict,
  confirmUnmanagedResources,
  type ImportantResourceDeletion,
  type MissingDependentApp,
} from "./confirm";
import { fetchMissingDependentApps } from "./dependency-records";
import {
  buildDeploymentTargets,
  loadDeployConfigs,
  parseDeployConfigPaths,
  type BuiltDeploymentTarget,
} from "./deployment-target";
import {
  assertRecordableDependencies,
  collectDependentApps,
  collectEventSubscriptions,
  collectWorkflowJobPublishEvents,
  ownedSubscriptions,
  subscribedIdps,
  subscribedResolvers,
  subscribedResourceKeys,
  subscribedTailorDBTables,
  subscribedWorkflows,
  type EventSubscription,
} from "./event-subscriptions";
import { planExecutor } from "./executor";
import {
  collectFunctionEntries,
  collectWorkflowJobStates,
  filterBundledWorkflowJobs,
  planFunctionRegistry,
} from "./function-registry";
import { planIdP } from "./idp";
import { buildMetaRequest, hasMatchingSdkVersion, resourceTrn, sdkNameLabelKey } from "./label";
import {
  assertUniqueGlobalResourceNames,
  collectDeploymentResourceOwners,
  collectImportantResourceDeletions,
  collectOwnerConflicts,
  collectUnmanagedResources,
  computeRenamedAppDeletions,
  dropCrossDeploymentManagedDeletes,
} from "./managed-resources";
import { createMetadataLookupClient } from "./metadata-lookup";
import { printDeploymentPlans } from "./plan-report";
import { planPipeline } from "./resolver";
import { planSecretManager } from "./secret-manager";
import { planStaticWebsite } from "./staticwebsite";
import { planTailorDB } from "./tailordb";
import { validatePlan } from "./validate-plan";
import {
  collectVisibleIdpNames,
  collectVisibleResolverNamespaces,
  collectVisibleTailorDBTypeNamespaces,
} from "./visible-resources";
import { planWorkflow } from "./workflow";
import { planWorkflowJobFunctionExecutionPolicy } from "./workflow-execution-policy";
import { resolveDeployWorkspace } from "./workspace";
import type {
  PlanContext,
  TailorDBMigrationTestBaseline,
  TailorDBMigrationTestSnapshots,
} from "./types";

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
  createWorkspace?: boolean;
  workspaceName?: string;
  workspaceRegion?: string;
  organizationId?: string;
  folderId?: string;
  // NOTE(remiposo): Provide an option to run build-only for testing purposes.
  // This could potentially be exposed as a CLI option.
  buildOnly?: boolean;
}

interface DeployCLIContext {
  envFile?: string;
  envFileIfExists?: string;
  verbose?: boolean;
  json?: boolean;
}

interface DeployInternalContext {
  migrationTestBaselines?: ReadonlyMap<string, TailorDBMigrationTestBaseline>;
  migrationTestSnapshots?: TailorDBMigrationTestSnapshots;
  suppressResultOutput?: boolean;
}

// None of these resource kinds can embed `env` or this run's rebuilt bundle
// content, so the conditional rebuild in `deployInternal` reuses each one's
// plan result from before the rebuild instead of re-planning it.
const REUSABLE_ON_REBUILD_KINDS: ReadonlySet<ReusablePlanKind> = new Set([
  "tailorDB",
  "secretManager",
  "aiGateway",
  "staticWebsite",
  "workflowExecutionPolicy",
  "idp",
  "auth",
]);

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

// Same set as collectExpectedLocalStaticWebsiteNames, read from the loaded
// configs so it is available before any of them is bundled.
export function collectExpectedLocalStaticWebsiteNamesFromConfigs(
  configs: ReadonlyArray<{ config: { staticWebsites?: ReadonlyArray<{ name: string }> } }>,
): ReadonlySet<string> {
  const websiteNames = new Set<string>();
  for (const { config } of configs) {
    for (const website of config.staticWebsites ?? []) {
      websiteNames.add(website.name);
    }
  }
  return websiteNames;
}

/**
 * Detect whether any resource owned by this application was last applied by a
 * different SDK version, in which case every resource is re-applied.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param application - Application being deployed
 * @param functionEntries - Function registry entries of the application
 * @returns True when an owned resource carries a different sdk-version label
 */
export async function shouldForceApplyAll(
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

  const results = await Promise.allSettled(
    [...candidateTrns].map((trn) =>
      getOrNull(async () => {
        const { metadata } = await client.getMetadata({ trn });
        return metadata;
      }),
    ),
  );

  const hasMismatch = results.some(
    (result) =>
      result.status === "fulfilled" &&
      result.value?.labels[sdkNameLabelKey] === application.name &&
      !hasMatchingSdkVersion(result.value.labels, desiredLabels),
  );
  if (hasMismatch) {
    return true;
  }
  const failure = results.find((result) => result.status === "rejected");
  if (failure) {
    throw failure.reason;
  }
  return false;
}

type DeployRunPlanInputs = Pick<
  PlanContext,
  "expectedLocalStaticWebsiteNames" | "externalAuthIdpConfigNames" | "runAppIds"
> & {
  /** Every event subscription in the run, resolved to its declaring config. */
  eventSubscriptions: ReadonlyArray<EventSubscription>;
};

type PlanDeploymentTargetParams = {
  target: BuiltDeploymentTarget;
  targets: ReadonlyArray<BuiltDeploymentTarget>;
  runInputs: DeployRunPlanInputs;
  client: OperatorClient;
  workspaceId: string;
  noSchemaCheck: boolean | undefined;
  migrationTestBaselines?: ReadonlyMap<string, TailorDBMigrationTestBaseline>;
  migrationTestSnapshots?: TailorDBMigrationTestSnapshots;
  /** Resource kinds to reuse from `previous` instead of re-planning. */
  skip?: ReadonlySet<ReusablePlanKind>;
  /** This target's own plan result from before the rebuild, source for `skip` reuse. */
  previous?: PlannedDeployment;
};

type ConfirmDeploymentPlansParams = {
  deployments: PlannedDeployment[];
  yes: boolean;
  dryRun?: boolean;
  /** Applications recorded as dependencies but absent from this deploy. */
  missingDependentApps?: MissingDependentApp[];
};

type PlanDeploymentTargetsParams = {
  targets: ReadonlyArray<BuiltDeploymentTarget>;
  runInputs: DeployRunPlanInputs;
  client: OperatorClient;
  workspaceId: string;
  noSchemaCheck: boolean | undefined;
  migrationTestBaselines?: ReadonlyMap<string, TailorDBMigrationTestBaseline>;
  migrationTestSnapshots?: TailorDBMigrationTestSnapshots;
  planTarget?: (params: PlanDeploymentTargetParams) => Promise<PlannedDeployment>;
  /** Resource kinds to reuse from `previousDeployments` instead of re-planning. */
  skip?: ReadonlySet<ReusablePlanKind>;
  /** Prior plan results, matched to targets by application name, source for `skip` reuse. */
  previousDeployments?: ReadonlyArray<PlannedDeployment>;
};

function recoveryEnvironmentArgs(
  options: DeployOptions | undefined,
  cliContext?: DeployCLIContext,
): readonly string[] {
  return [
    ...(cliContext?.envFile ? ["--env-file", path.resolve(process.cwd(), cliContext.envFile)] : []),
    ...(cliContext?.envFileIfExists
      ? ["--env-file-if-exists", path.resolve(process.cwd(), cliContext.envFileIfExists)]
      : []),
    ...recoveryContextArgs({ profile: options?.profile }),
  ];
}

function recoveryOutputArgs(cliContext?: DeployCLIContext): readonly string[] {
  return [
    ...(cliContext?.verbose ? ["--verbose"] : []),
    ...(cliContext?.json || logger.jsonMode ? ["--json"] : []),
  ];
}

function retryDeployArgs(
  options: DeployOptions | undefined,
  configPaths: readonly string[],
  cliContext?: DeployCLIContext,
): readonly string[] {
  return [
    "deploy",
    "--config",
    configPaths.join(","),
    ...recoveryEnvironmentArgs(options, cliContext),
    ...(options?.dryRun ? ["--dry-run"] : []),
    ...(options?.yes ? ["--yes"] : []),
    ...(options?.noSchemaCheck ? ["--no-schema-check"] : []),
    ...(options?.noValidate ? ["--no-validate"] : []),
    ...(options?.noCache ? ["--no-cache"] : []),
    ...(options?.cleanCache ? ["--clean-cache"] : []),
    ...recoveryOutputArgs(cliContext),
  ];
}

function workspaceRecoveryArgs(
  options: DeployOptions | undefined,
  cliContext?: DeployCLIContext,
): readonly string[] {
  return [
    ...recoveryEnvironmentArgs(options, cliContext),
    ...(cliContext?.verbose ? ["--verbose"] : []),
  ];
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
      throw CLIError({
        code: "AUTH_NAMESPACE_CONFLICT",
        message:
          `Auth namespace "${name}" is defined by multiple config files with different IdP configs. ` +
          `Auth namespace names must be unique across all configs in a single deploy.`,
      });
    }
    idpConfigNames.set(name, idpConfigName);
  }
  return idpConfigNames;
}

function collectDeployRunPlanInputs(
  targets: ReadonlyArray<BuiltDeploymentTarget>,
  writes: boolean,
): DeployRunPlanInputs {
  const eventSubscriptions = collectEventSubscriptions(targets);
  assertRecordableDependencies(eventSubscriptions, writes);
  return {
    eventSubscriptions,
    runAppIds: new Set(
      targets.map((target) => target.application.id).filter((id) => id !== undefined),
    ),
    expectedLocalStaticWebsiteNames: collectExpectedLocalStaticWebsiteNames(targets),
    externalAuthIdpConfigNames: collectExternalAuthIdpConfigNames(targets),
  };
}

async function planDeploymentTarget(
  params: PlanDeploymentTargetParams,
): Promise<PlannedDeployment> {
  const {
    target,
    targets,
    runInputs,
    client,
    workspaceId,
    noSchemaCheck,
    migrationTestBaselines,
    migrationTestSnapshots,
    skip,
    previous,
  } = params;
  const { config, application, workflowBuildResult, httpAdapterBuildResult, bundledScripts } =
    target;
  const owned = ownedSubscriptions(runInputs.eventSubscriptions, target);

  const migrationTestServices = application.tailorDBServices.map((service) => {
    const snapshot = migrationTestSnapshots?.get(service.namespace);
    return snapshot ? { ...service, types: snapshot.tables, typeSourceInfo: {} } : service;
  });
  if (!(skip?.has("tailorDB") && previous)) {
    await withSpan("plan.validateTailorDBTypeNames", () =>
      assertUniqueTailorDBTypeNamesWithExternal({
        client,
        workspaceId,
        tailorDBServices: migrationTestServices,
        externalTailorDBNamespaces: application.externalTailorDBNamespaces,
        plannedExternalTailorDBServices: collectPlannedExternalTailorDBServices(target, targets),
      }),
    );
  }

  const workflowService = application.workflowService;
  const bundledWorkflowJobs = filterBundledWorkflowJobs(
    workflowService?.jobs ?? [],
    workflowBuildResult?.usedJobNames ?? [],
  );
  const functionEntries = collectFunctionEntries(application, bundledWorkflowJobs, bundledScripts);
  // Reused as-is on a rebuild's replan -- see `PlannedDeployment.forceApplyAll`'s
  // doc comment for why recomputing it there is unsafe.
  const forceApplyAll = previous
    ? previous.forceApplyAll
    : await withSpan("plan.detectSdkVersionChange", () =>
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
      migrationTestBaselines,
      migrationTestSnapshots,
      forceApplyAll,
      ...runInputs,
      idpUserTriggerTargets: subscribedIdps(owned),
      executorUsedTailorDBTables: subscribedTailorDBTables(owned),
      executorUsedResolvers: subscribedResolvers(owned),
      dependentApps: collectDependentApps(owned),
      tailorDBTypeNamespaces,
      resolverNamespaces,
      idpNames,
    };
    const functionRegistry = await withSpan("plan.functionRegistry", () =>
      planFunctionRegistry(
        client,
        workspaceId,
        application.name,
        application.id,
        functionEntries,
        previous?.functionRegistry.existingMap,
      ),
    );
    const workflowJobStates = collectWorkflowJobStates(functionRegistry.changeSet);
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
      workflowExecutionPolicy,
      secretManager,
    ] = await Promise.all([
      skip?.has("tailorDB") && previous
        ? previous.tailorDB
        : withSpan("plan.tailorDB", () => planTailorDB(ctx)),
      skip?.has("staticWebsite") && previous
        ? previous.staticWebsite
        : withSpan("plan.staticWebsite", () => planStaticWebsite(ctx)),
      skip?.has("aiGateway") && previous
        ? previous.aiGateway
        : withSpan("plan.aiGateway", () => planAIGateway(ctx)),
      skip?.has("idp") && previous ? previous.idp : withSpan("plan.idp", () => planIdP(ctx)),
      skip?.has("auth") && previous ? previous.auth : withSpan("plan.auth", () => planAuth(ctx)),
      withSpan("plan.pipeline", () =>
        planPipeline(
          ctx,
          previous && {
            existingServices: previous.pipeline.existingServices,
            existingResolvers: previous.pipeline.existingResolvers,
          },
        ),
      ),
      withSpan("plan.application", () =>
        planApplication(
          ctx,
          httpAdapterBuildResult,
          previous && {
            existingApplications: previous.app.existingApplications,
            existingLabels: previous.app.existingLabels,
          },
        ),
      ),
      withSpan("plan.executor", () => planExecutor(ctx, previous?.executor.existingExecutors)),
      withSpan("plan.workflow", () =>
        planWorkflow(
          client,
          workspaceId,
          application.name,
          application.id,
          workflowService?.workflows ?? {},
          workflowBuildResult?.mainJobDeps ?? {},
          workflowJobStates.unchanged,
          {
            ...subscribedWorkflows(owned),
            jobPublishEvents: collectWorkflowJobPublishEvents(target),
            dependentApps: ctx.dependentApps,
            runAppIds: ctx.runAppIds,
          },
          previous && {
            existingJobFunctions: previous.workflow.existingJobFunctions,
            existingWorkflows: previous.workflow.existingWorkflows,
          },
          workflowJobStates.forcedBySdkVersion,
        ),
      ),
      skip?.has("workflowExecutionPolicy") && previous
        ? previous.workflowExecutionPolicy
        : withSpan("plan.workflowExecutionPolicy", () =>
            planWorkflowJobFunctionExecutionPolicy(
              client,
              workspaceId,
              application.name,
              application.id,
              config.workflow?.executionPolicies ?? {},
            ),
          ),
      skip?.has("secretManager") && previous
        ? previous.secretManager
        : withSpan("plan.secretManager", () => planSecretManager(ctx)),
    ]);

    return {
      application,
      forceApplyAll,
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
      workflowExecutionPolicy,
      secretManager,
    };
  });
}

export async function planDeploymentTargets(
  params: PlanDeploymentTargetsParams,
): Promise<PlannedDeployment[]> {
  const { targets, planTarget = planDeploymentTarget, previousDeployments, ...planParams } = params;
  const previousByAppName = new Map(
    previousDeployments?.map((deployment) => [deployment.application.name, deployment]),
  );
  return Promise.all(
    targets.map((target) =>
      planTarget({
        ...planParams,
        target,
        targets,
        previous: previousByAppName.get(target.application.name),
      }),
    ),
  );
}

export async function confirmDeploymentPlans(params: ConfirmDeploymentPlansParams): Promise<void> {
  const { deployments, yes, dryRun = false, missingDependentApps = [] } = params;
  if (!dryRun) {
    await confirmMigrationCheckpointRepairs(
      deployments.flatMap((deployment) => deployment.tailorDB.context.checkpointRepairs),
      yes,
    );
  }
  await confirmMissingDependentApps(missingDependentApps, yes);
  const targetAppNames = new Set(deployments.map((deployment) => deployment.application.name));
  const resourceOwners = collectDeploymentResourceOwners(deployments);
  const scheduledRenamedAppDeletes = new Set<string>();
  const importantDeletions: ImportantResourceDeletion[] = [];

  for (const deployment of deployments) {
    const results = deploymentPlanResults(deployment);
    const conflicts = collectOwnerConflicts(results);
    await confirmOwnerConflict(
      conflicts,
      deployment.application.name,
      yes,
      deployment.application.id,
    );

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

async function validateDeploymentPlans(
  deployments: ReadonlyArray<PlannedDeployment>,
): Promise<void> {
  for (const deployment of deployments) {
    await validatePlan(deploymentPlanResults(deployment));
  }
}

/**
 * Carry the renamed-app cleanup deletes `confirmDeploymentPlans` appended
 * onto `original`'s `app.deletes` over onto the matching `rebuilt` entry.
 * `app` is always re-planned on a rebuild (its `cors` is resolved live at
 * plan time, since the site it references may have just been created --
 * HTTP adapter bundles themselves are reused as-is and don't embed `env`),
 * so a fresh `planApplication` result never carries them.
 * @param original - Deployments as confirmed, before the rebuild
 * @param rebuilt - Freshly planned deployments the rebuild will apply instead
 * @param preConfirmAppDeleteCounts - Each application's `app.deletes.length` before confirm ran
 */
export function carryConfirmedAppDeletes(
  original: ReadonlyArray<PlannedDeployment>,
  rebuilt: ReadonlyArray<PlannedDeployment>,
  preConfirmAppDeleteCounts: ReadonlyMap<string, number>,
): void {
  const originalByAppName = new Map(
    original.map((deployment) => [deployment.application.name, deployment]),
  );
  for (const deployment of rebuilt) {
    const originalDeployment = originalByAppName.get(deployment.application.name);
    const startIndex = preConfirmAppDeleteCounts.get(deployment.application.name);
    if (!originalDeployment || startIndex === undefined) {
      continue;
    }
    const confirmedDeletes = originalDeployment.app.deletes.slice(startIndex);
    for (const confirmedDelete of confirmedDeletes) {
      if (!deployment.app.deletes.some((del) => del.name === confirmedDelete.name)) {
        deployment.app.deletes.push(confirmedDelete);
      }
    }
  }
}

/**
 * Check whether `env` still holds a static website URL placeholder this same
 * deploy is expected to resolve, once the site it names exists.
 *
 * A placeholder naming a site outside `expectedLocalStaticWebsiteNames` (a
 * typo, or a site no config in this run declares) can never resolve here --
 * rebuilding for it would just repeat the same lookup failure and warning a
 * second time, so only a placeholder this deploy's own static websites can
 * satisfy triggers the rebuild.
 * @param deployments - Planned deployments to inspect
 * @param expectedLocalStaticWebsiteNames - Static website names declared by any config in this deploy run
 * @returns True when rebuilding now would actually resolve something
 */
export function needsEnvRebuild(
  deployments: ReadonlyArray<PlannedDeployment>,
  expectedLocalStaticWebsiteNames: ReadonlySet<string>,
): boolean {
  return deployments.some((deployment) =>
    Object.values(deployment.application.env).some(
      (value) =>
        hasStaticWebsiteUrlPlaceholder(value) &&
        expectedLocalStaticWebsiteNames.has(staticWebsiteNameFromPlaceholder(value)),
    ),
  );
}

/**
 * Fail the deploy if `env` still holds an unresolved static website
 * placeholder after the rebuild meant to resolve it (e.g. the platform
 * hasn't assigned the site's URL yet) -- shipping the placeholder into
 * deployed code would silently defeat the whole point of rebuilding.
 * @param rebuiltDeployments - The rebuild's planned deployments
 * @param expectedLocalStaticWebsiteNames - Static website names declared by any config in this deploy run
 */
export function assertEnvResolvedAfterRebuild(
  rebuiltDeployments: ReadonlyArray<PlannedDeployment>,
  expectedLocalStaticWebsiteNames: ReadonlySet<string>,
): void {
  if (!needsEnvRebuild(rebuiltDeployments, expectedLocalStaticWebsiteNames)) return;
  throw CLIError({
    code: "STATIC_WEBSITE_URL_NOT_RESOLVED",
    message:
      "A static website referenced by env still has no URL after rebuilding to pick up " +
      "this deploy's own config changes.",
    suggestion: "Re-run the deploy; the static website's URL may not be assigned yet.",
  });
}

/**
 * Strip the services a migration test deploy must not manage, so plan modules
 * see an application that already reflects the deploy's scope. Baseline deploys
 * omit executors and Auth user profiles (data loading must not trigger current
 * event handlers or reference the final schema); every migration test deploy
 * omits workspace-bound static website custom domains.
 * @param application - Application built from the user's config
 * @param internalContext - Internal deployment behavior used by composed CLI workflows
 * @returns The application as the migration test deploy manages it
 */
export function adjustApplicationForMigrationTest(
  application: Application,
  internalContext: DeployInternalContext | undefined,
): Application {
  if (!internalContext?.migrationTestSnapshots) {
    return application;
  }
  const forBaseline = internalContext.migrationTestBaselines !== undefined;
  const authService =
    forBaseline && application.authService
      ? { ...application.authService, userProfile: undefined }
      : application.authService;
  const adjusted: Application = {
    ...application,
    executorService: forBaseline ? undefined : application.executorService,
    authService,
    staticWebsiteServices: application.staticWebsiteServices.map((website) => ({
      ...website,
      customDomains: undefined,
    })),
    get applications() {
      return [adjusted];
    },
  };
  return adjusted;
}

/**
 * Deploy the configured application to the Tailor platform.
 * @param options - Deploy execution options
 * @param cliContext - Global CLI arguments to preserve in recovery actions
 * @param internalContext - Internal deployment behavior used by composed CLI workflows
 * @returns Promise that resolves to `{ bundledScripts }` when `buildOnly` is true, otherwise void
 */
async function deployInternal(
  options?: DeployOptions,
  cliContext?: DeployCLIContext,
  internalContext?: DeployInternalContext,
) {
  return withSpan("deploy", async (rootSpan) => {
    rootSpan.setAttribute("deploy.dry_run", options?.dryRun ?? false);

    // Before the first config load, so this run re-evaluates user modules
    // instead of reusing another run's cached ones, and is judged on the keys
    // it declares rather than on ones an earlier failed run left behind.
    beginUserModuleRun();
    beginWaitPointScope();

    const configPaths = parseDeployConfigPaths(options?.configPath);
    const dryRun = options?.dryRun ?? false;
    const buildOnly =
      options?.buildOnly ?? parseBoolean(process.env.TAILOR_DEPLOY_BUILD_ONLY) === true;
    const preflightConfigs = buildOnly
      ? []
      : await withSpan("config.preflight", () =>
          loadDeployConfigs({ configPaths, dryRun, buildOnly }),
        );
    const resolvedConfigPaths = preflightConfigs.map(({ config }) => config.path);
    const workspaceContextTargets = preflightConfigs.map(({ config }) => ({
      configPath: config.path,
      applicationId: config.id ?? `name:${config.name}`,
    }));
    const workspace = buildOnly
      ? undefined
      : await resolveDeployWorkspace({
          workspaceId: options?.workspaceId,
          profile: options?.profile,
          createWorkspace: options?.createWorkspace,
          workspaceName: options?.workspaceName,
          workspaceRegion: options?.workspaceRegion,
          organizationId: options?.organizationId,
          folderId: options?.folderId,
          dryRun,
          contextTargets: workspaceContextTargets,
          deployArgs: retryDeployArgs(options, resolvedConfigPaths, cliContext),
          workspaceCommandArgs: workspaceRecoveryArgs(options, cliContext),
          workspaceCommandJson: cliContext?.json || logger.jsonMode,
        });
    const expectedLocalStaticWebsiteNames =
      collectExpectedLocalStaticWebsiteNamesFromConfigs(preflightConfigs);

    // Cleaned once, before the first build, so a later conditional rebuild
    // (see the `needsUrlResolution` branch below) finds the cache the first
    // build just populated instead of wiping it and re-bundling everything
    // from scratch a second time.
    const noCache = options?.noCache ?? false;
    const cacheDir = path.resolve(getDistDir(), "cache");
    if (options?.cleanCache) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      logger.info("Bundle cache cleaned");
    }

    const build = (previousTargets?: ReadonlyArray<BuiltDeploymentTarget>) =>
      withSpan("build", async () => {
        const packageJson = await readPackageJson();

        return buildDeploymentTargets({
          configPaths,
          loadedConfigs: buildOnly ? undefined : preflightConfigs,
          dryRun,
          buildOnly,
          noCache,
          packageVersion: packageJson.version ?? "unknown",
          cacheDir,
          client: workspace?.client,
          workspaceId: workspace?.workspaceId,
          expectedLocalStaticWebsiteNames,
          previousTargets,
        });
      });

    const targets = await build();
    if (buildOnly) {
      return { bundledScripts: mergeBundledScripts(targets) };
    }

    assertUniqueGlobalResourceNames(targets);

    // Note: the normal apply path intentionally skips writing bundle files to
    // .tailor/. Bundles are kept in memory and uploaded directly to the
    // function registry. To test a function locally, use `function run`
    // with a .ts source file instead of a pre-bundled .js file.

    if (!workspace) throw internalError("Workspace was not resolved");
    const { client, workspaceId } = workspace;

    rootSpan.setAttribute("app.name", targets.map((target) => target.application.name).join(","));
    rootSpan.setAttribute("workspace.id", workspaceId);

    // Reused on a rebuild's replan (see below) instead of re-scanning
    // metadata: applyPrerequisiteResources only touches
    // secretManager/staticWebsite/aiGateway/idp/auth labels, and none of the
    // 5 resource kinds a rebuild actually re-diffs (functionRegistry,
    // pipeline, application, executor, workflow) read metadata for those
    // kinds, so the first pass's batch cannot be stale for them.
    let firstMetadataClient: OperatorClient | undefined;
    const plan = async (
      targets: ReadonlyArray<BuiltDeploymentTarget>,
      reuse?: {
        skip: ReadonlySet<ReusablePlanKind>;
        previousDeployments: ReadonlyArray<PlannedDeployment>;
      },
    ) => {
      const planTargets = targets.map((target) => ({
        ...target,
        application: adjustApplicationForMigrationTest(target.application, internalContext),
      }));
      const metadataClient =
        reuse && firstMetadataClient
          ? firstMetadataClient
          : await withSpan("plan.metadataLookup", () =>
              createMetadataLookupClient({
                client,
                workspaceId,
                applications: planTargets.map(({ application }) => application),
              }),
            );
      firstMetadataClient = metadataClient;
      const runInputs = collectDeployRunPlanInputs(planTargets, !options?.dryRun);
      const deployments = await planDeploymentTargets({
        targets: planTargets,
        runInputs,
        client: metadataClient,
        workspaceId,
        noSchemaCheck: options?.noSchemaCheck,
        migrationTestBaselines: internalContext?.migrationTestBaselines,
        migrationTestSnapshots: internalContext?.migrationTestSnapshots,
        skip: reuse?.skip,
        previousDeployments: reuse?.previousDeployments,
      });
      dropCrossDeploymentManagedDeletes(deployments);
      return { planTargets, metadataClient, runInputs, deployments };
    };

    const { planTargets, metadataClient, runInputs, deployments } = await plan(targets);

    // Phase 1b: Confirm
    const missingDependentApps = (
      await Promise.all(
        planTargets.map((target) =>
          fetchMissingDependentApps({
            client: metadataClient,
            workspaceId,
            application: target.application,
            runAppIds: runInputs.runAppIds ?? new Set<string>(),
            subscribedKeys: subscribedResourceKeys(runInputs.eventSubscriptions, target),
            jobsByWorkflow: target.workflowBuildResult?.mainJobDeps ?? {},
          }),
        ),
      )
    ).flat();

    // `confirmDeploymentPlans` appends renamed-app cleanup deletes onto each
    // deployment's `app.deletes` in place. Recorded here so a later rebuild
    // (which replaces `deployments` with a freshly planned `app` for every
    // application) can carry those additions over instead of losing them --
    // confirm itself never runs a second time, so nothing else re-adds them.
    const preConfirmAppDeleteCounts = new Map(
      deployments.map((deployment) => [deployment.application.name, deployment.app.deletes.length]),
    );

    await withSpan("confirm", async () => {
      await confirmDeploymentPlans({
        deployments,
        yes: options?.yes ?? false,
        dryRun,
        missingDependentApps,
      });
    });

    const validate = (deployments: ReadonlyArray<PlannedDeployment>) =>
      options?.noValidate
        ? logger.warn("Client-side validation skipped (--no-validate).")
        : validateDeploymentPlans(deployments);
    await validate(deployments);

    // `env`'s static website placeholders are resolved once, at build time,
    // before this deploy has applied anything. When one references a site the
    // prerequisite apply below just creates, the placeholder is still
    // literally present in `application.env` -- rebuilding now re-resolves it
    // and rebundles only workflow jobs and auth hooks, the two kinds that
    // embed `env` directly (resolver/executor read it through a separate,
    // always-freshly-generated expression, not their function bundle, so they
    // don't need rebundling; see `loadApplication`'s `previous` handling).
    // TailorDB migration scripts don't need this either: they re-resolve
    // `env` themselves right before executing.
    const needsUrlResolution = needsEnvRebuild(deployments, expectedLocalStaticWebsiteNames);

    // On the rebuild path below, the plan actually applied is the rebuilt
    // one, so printing this first-pass plan would only show output that's
    // about to be superseded. Dry run never rebuilds (it returns right
    // below), so it always shows this first pass instead.
    let planSummary: PlanSummary | undefined =
      dryRun || !needsUrlResolution
        ? printDeploymentPlans(deployments, { dryRun: options?.dryRun })
        : undefined;

    if (dryRun) {
      logger.info("Dry run enabled. No changes applied.");
      return undefined;
    }

    // Validate TailorDB's migration state before anything is applied, so a
    // stale migration checkpoint or schema fails the deploy with nothing yet
    // mutated -- not after the prerequisite resources below are already
    // created or updated.
    await preflightAllTailorDB(client, deployments);

    // secretManager/staticWebsite/aiGateway/idp/auth's prerequisite resources
    // can never reference a static website's URL, so applying them first is
    // safe -- and it means a site this same deploy creates already exists by
    // the time env is read again below.
    await applyPrerequisiteResources(client, deployments);

    if (needsUrlResolution) {
      logger.info(
        "A static website was just created; rebuilding so env resolves to its real URL before the rest of this deploy applies.",
      );
      // Reuses everything from the first build except `env` resolution and
      // the workflow-job/auth-hook bundles it feeds -- see `loadApplication`'s
      // `previous` handling for what that skips.
      const rebuiltTargets = await build(targets);
      assertUniqueGlobalResourceNames(rebuiltTargets);
      // None of REUSABLE_ON_REBUILD_KINDS's plans can change from this
      // rebuild (see its definition), and each was already confirmed once
      // above -- reuse them instead of re-querying the platform and
      // re-diffing them for a second time in the same deploy.
      const rebuilt = await plan(rebuiltTargets, {
        skip: REUSABLE_ON_REBUILD_KINDS,
        previousDeployments: deployments,
      });
      assertEnvResolvedAfterRebuild(rebuilt.deployments, expectedLocalStaticWebsiteNames);
      carryConfirmedAppDeletes(deployments, rebuilt.deployments, preConfirmAppDeleteCounts);
      await validate(rebuilt.deployments);
      planSummary = printDeploymentPlans(rebuilt.deployments, { dryRun: options?.dryRun });
      await applyRemainingResources(client, workspaceId, rebuilt.deployments);
    } else {
      await applyRemainingResources(client, workspaceId, deployments);
    }

    if (!internalContext?.suppressResultOutput) {
      if (logger.jsonMode) {
        logger.out({
          summary: assertDefined(planSummary, "planSummary was never printed before this point"),
          status: "applied",
        });
      } else {
        logger.success("Successfully applied changes.");
      }
    }

    return undefined;
  });
}

/**
 * Deploy using the programmatic CLI API.
 * @param options - Deploy execution options
 * @returns Deploy result
 */
export function deploy(options?: DeployOptions) {
  return deployInternal(options);
}

/**
 * Deploy TailorDB baseline snapshots for an isolated migration test.
 * @param options - Deploy execution options
 * @param baselines - Baseline snapshots keyed by TailorDB namespace
 * @param baselineSnapshots - All schema snapshots that must match the source before data loading
 * @returns Deploy result
 */
export function deployMigrationTestBaseline(
  options: DeployOptions,
  baselines: ReadonlyMap<string, TailorDBMigrationTestBaseline>,
  baselineSnapshots: TailorDBMigrationTestSnapshots,
) {
  return deployInternal(options, undefined, {
    migrationTestBaselines: baselines,
    migrationTestSnapshots: baselineSnapshots,
    suppressResultOutput: true,
  });
}

/**
 * Deploy pending migrations without emitting deploy's standalone result payload.
 * @param options - Deploy execution options
 * @param snapshots - Final committed snapshots keyed by TailorDB namespace
 * @returns Deploy result
 */
export function deployMigrationTestTarget(
  options: DeployOptions,
  snapshots: TailorDBMigrationTestSnapshots,
) {
  return deployInternal(options, undefined, {
    migrationTestSnapshots: snapshots,
    suppressResultOutput: true,
  });
}

/**
 * Deploy from the command adapter while preserving global CLI arguments in recovery actions.
 * @param options - Deploy execution options
 * @param cliContext - Global CLI arguments already applied by the command runner
 * @returns Deploy result
 */
export function deployFromCLI(options: DeployOptions | undefined, cliContext: DeployCLIContext) {
  return deployInternal(options, cliContext);
}
