import * as fs from "node:fs";
import * as path from "pathe";
import { type Application } from "#/cli/services/application";
import { assertUniqueTailorDBTypeNamesWithExternal } from "#/cli/services/tailordb/type-name-validation";
import { getOrNull, type OperatorClient } from "#/cli/shared/client";
import { getDistDir } from "#/cli/shared/dist-dir";
import { logger } from "#/cli/shared/logger";
import { readPackageJson } from "#/cli/shared/package-json";
import { parseBoolean } from "#/cli/shared/parse-boolean";
import { beginUserModuleRun } from "#/cli/shared/user-modules";
import { withSpan } from "#/cli/telemetry/index";
import { beginWaitPointScope } from "#/utils/wait-point-registry";
import { planAIGateway } from "./aigateway";
import { planApplication } from "./application";
import {
  applyDeploymentPlans,
  deploymentPlanResults,
  type PlannedDeployment,
} from "./apply-phases";
import { planAuth } from "./auth";
import { mergeBundledScripts } from "./bundled-scripts";
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
import { type DeployLock, withDeployLock } from "./deploy-lock";
import { fenceClient } from "./deploy-lock-fence";
import {
  buildDeploymentTargets,
  loadDeployConfig,
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
  filterBundledWorkflowJobs,
  planFunctionRegistry,
  WORKFLOW_PREFIX,
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
    ...(options?.profile ? ["--profile", options.profile] : []),
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
  } = params;
  const { config, application, workflowBuildResult, httpAdapterBuildResult, bundledScripts } =
    target;
  const owned = ownedSubscriptions(runInputs.eventSubscriptions, target);

  const migrationTestServices = application.tailorDBServices.map((service) => {
    const snapshot = migrationTestSnapshots?.get(service.namespace);
    return snapshot ? { ...service, types: snapshot.tables, typeSourceInfo: {} } : service;
  });
  await withSpan("plan.validateTailorDBTypeNames", () =>
    assertUniqueTailorDBTypeNamesWithExternal({
      client,
      workspaceId,
      tailorDBServices: migrationTestServices,
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
      workflowExecutionPolicy,
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
          {
            ...subscribedWorkflows(owned),
            jobPublishEvents: collectWorkflowJobPublishEvents(target),
            dependentApps: ctx.dependentApps,
            runAppIds: ctx.runAppIds,
          },
        ),
      ),
      withSpan("plan.workflowExecutionPolicy", () =>
        planWorkflowJobFunctionExecutionPolicy(
          client,
          workspaceId,
          application.name,
          application.id,
          config.workflow?.executionPolicies ?? {},
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
      workflowExecutionPolicy,
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
          Promise.all(
            configPaths.map((configPath) => loadDeployConfig({ configPath, dryRun, buildOnly })),
          ),
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
    const targets = await withSpan("build", async () => {
      const noCache = options?.noCache ?? false;
      const packageJson = await readPackageJson();
      const cacheDir = path.resolve(getDistDir(), "cache");
      if (options?.cleanCache) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
        logger.info("Bundle cache cleaned");
      }

      const targets = await buildDeploymentTargets({
        configPaths,
        loadedConfigs: preflightConfigs,
        dryRun,
        buildOnly,
        noCache,
        packageVersion: packageJson.version ?? "unknown",
        cacheDir,
      });

      return targets;
    });
    if (buildOnly) {
      return { bundledScripts: mergeBundledScripts(targets) };
    }

    assertUniqueGlobalResourceNames(targets);

    // Note: the normal apply path intentionally skips writing bundle files to
    // .tailor/. Bundles are kept in memory and uploaded directly to the
    // function registry. To test a function locally, use `function run`
    // with a .ts source file instead of a pre-bundled .js file.

    if (!workspace) throw new Error("Workspace was not resolved");
    const { client, workspaceId } = workspace;

    rootSpan.setAttribute("app.name", targets.map((target) => target.application.name).join(","));
    rootSpan.setAttribute("workspace.id", workspaceId);

    const planAndApply = async (lock: DeployLock): Promise<undefined> => {
      const planTargets = targets.map((target) => ({
        ...target,
        application: adjustApplicationForMigrationTest(target.application, internalContext),
      }));
      const metadataClient = await withSpan("plan.metadataLookup", () =>
        createMetadataLookupClient({
          client,
          workspaceId,
          applications: planTargets.map(({ application }) => application),
        }),
      );
      const runInputs = collectDeployRunPlanInputs(planTargets, !options?.dryRun);
      const deployments = await planDeploymentTargets({
        targets: planTargets,
        runInputs,
        client: metadataClient,
        workspaceId,
        noSchemaCheck: options?.noSchemaCheck,
        migrationTestBaselines: internalContext?.migrationTestBaselines,
        migrationTestSnapshots: internalContext?.migrationTestSnapshots,
      });

      const yes = options?.yes ?? false;

      dropCrossDeploymentManagedDeletes(deployments);

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

      await withSpan("confirm", async () => {
        await confirmDeploymentPlans({ deployments, yes, dryRun, missingDependentApps });
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

      await applyDeploymentPlans(fenceClient(client, lock), workspaceId, deployments, () =>
        lock.assertHeld(),
      );

      if (!internalContext?.suppressResultOutput) {
        if (logger.jsonMode) {
          logger.out({ summary: planSummary, status: "applied" });
        } else {
          logger.success("Successfully applied changes.");
        }
      }

      return undefined;
    };

    if (dryRun) return await planAndApply({ assertHeld: () => {} });
    return await withDeployLock(
      {
        client,
        workspaceId,
        applications: targets.map(({ application }) => ({
          name: application.name,
          id: application.id,
        })),
      },
      planAndApply,
    );
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
