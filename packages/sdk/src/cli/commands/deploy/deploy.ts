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
import { applyAIGateway, planAIGateway } from "./aigateway";
import { applyApplication, planApplication } from "./application";
import { applyAuth, formatAuthHookChangeEntries, planAuth } from "./auth";
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
  applyExecutor,
  buildPlannedExecutorsByName,
  formatExecutorChangeEntries,
  planExecutor,
} from "./executor";
import {
  applyFunctionRegistry,
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
import { applyIdP, planIdP } from "./idp";
import { buildMetaRequest, hasMatchingSdkVersion, resourceTrn, sdkNameLabelKey } from "./label";
import { applyPipeline, formatResolverChangeEntries, planPipeline } from "./resolver";
import { applySecretManager, planSecretManager } from "./secret-manager";
import { applyStaticWebsite, planStaticWebsite } from "./staticwebsite";
import { applyTailorDB, formatTailorDBResourceChangeEntries, planTailorDB } from "./tailordb";
import { validatePlan } from "./validate-plan";
import { applyWorkflow, formatWorkflowChangeEntries, planWorkflow } from "./workflow";
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

type PrintPlanOptions = {
  dryRun?: boolean;
};

export function printPlanResults(results: PlanResults, opts?: PrintPlanOptions): PlanSummary {
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

  if (logger.jsonMode && opts?.dryRun) {
    const allEntries = [
      ...allDisplayEntries,
      ...allServiceActions.map(({ action, name }) => ({
        action,
        name,
        labels: [],
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
    logger.out({ summary, changes });
    return summary;
  }

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

  if (results.secretManager.skippedSecrets.length > 0) {
    allLines.push(styles.bold("Secret Manager secrets (skipped - no value provided):"));
    for (const name of results.secretManager.skippedSecrets) {
      allLines.push(`  ${styles.dim("○")} ${name}`);
    }
  }

  allLines.push(formatPlanSummary(summary));

  const output = allLines.join("\n");
  if (opts?.dryRun) {
    logger.out(output);
  } else {
    logger.log(output);
  }

  return summary;
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
  const summary: PlanSummary = {
    create: 0,
    update: 0,
    delete: 0,
    replace: 0,
    unchanged: 0,
  };

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
 * Deploy the configured application to the Tailor platform.
 * @param options - Options for deploy execution
 * @returns Promise that resolves to `{ bundledScripts }` when `buildOnly` is true, otherwise void
 */
export async function deploy(options?: DeployOptions) {
  return withSpan("deploy", async (rootSpan) => {
    rootSpan.setAttribute("deploy.dry_run", options?.dryRun ?? false);

    // Phase 0: Build
    const {
      config,
      application,
      workflowBuildResult,
      httpAdapterBuildResult,
      bundledScripts,
      buildOnly,
    } = await withSpan("build", async () => {
      const dryRun = options?.dryRun ?? false;
      const buildOnly =
        options?.buildOnly ?? parseBoolean(process.env.TAILOR_PLATFORM_SDK_BUILD_ONLY) === true;

      const { config, plugins } = await withSpan("build.loadConfig", async () => {
        const foundPath = loadConfigPath(options?.configPath);
        // Locally inject a missing app id; in CI require an existing id
        // instead of auto-generating one. CI dry-runs still run the check
        // read-only (so a forgotten id fails the PR plan); local dry-run and
        // build-only skip it. See ensureConfigIdForDeploy.
        if (foundPath) {
          const resolvedPath = path.resolve(process.cwd(), foundPath);
          if (fs.existsSync(resolvedPath)) {
            await ensureConfigIdForDeploy({ configPath: resolvedPath, dryRun, buildOnly });
          }
        }
        return loadConfig(options?.configPath);
      });

      const noCache = options?.noCache ?? false;

      // Initialize cache manager
      const packageJson = await readPackageJson();
      const cacheDir = path.resolve(getDistDir(), "cache");
      if (options?.cleanCache) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
        logger.info("Bundle cache cleaned");
      }
      const configDir = path.dirname(config.path);
      const lockfilePath =
        findUpSync("pnpm-lock.yaml", { cwd: configDir }) ??
        findUpSync("package-lock.json", { cwd: configDir }) ??
        findUpSync("yarn.lock", { cwd: configDir }) ??
        findUpSync("bun.lock", { cwd: configDir });
      const cacheManager = createCacheManager({
        enabled: !noCache,
        cacheDir,
        sdkVersion: packageJson.version ?? "unknown",
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
      let httpAdapterBuildResult: Awaited<
        ReturnType<typeof loadApplication>
      >["httpAdapterBuildResult"];
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
        // Persist even on partial failure: successfully built bundles
        // are cached so the next run only rebuilds what failed.
        cacheManager.finalize();
      }

      return {
        config,
        plugins,
        application,
        workflowBuildResult,
        httpAdapterBuildResult,
        bundledScripts,
        dryRun,
        buildOnly,
      };
    });
    if (buildOnly) {
      return { bundledScripts };
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

    rootSpan.setAttribute("app.name", application.name);
    rootSpan.setAttribute("workspace.id", workspaceId);

    await withSpan("plan.validateTailorDBTypeNames", () =>
      assertUniqueTailorDBTypeNamesWithExternal({
        client,
        workspaceId,
        tailorDBServices: application.tailorDBServices,
        externalTailorDBNamespaces: application.externalTailorDBNamespaces,
      }),
    );

    // Collect function entries from in-memory bundled scripts (after build, before plan)
    const workflowService = application.workflowService;
    const bundledWorkflowJobs = filterBundledWorkflowJobs(
      workflowService?.jobs ?? [],
      workflowBuildResult?.usedJobNames ?? [],
    );
    const functionEntries = collectFunctionEntries(
      application,
      bundledWorkflowJobs,
      bundledScripts,
    );

    const dryRun = options?.dryRun ?? false;
    const yes = options?.yes ?? false;
    const forceApplyAll = await withSpan("plan.detectSdkVersionChange", () =>
      shouldForceApplyAll(client, workspaceId, application, functionEntries),
    );

    // Phase 1: Plan
    const {
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
    } = await withSpan("plan", async () => {
      const idpUserTriggerTargets = collectIdpUserTriggerTargets(application);
      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config,
        noSchemaCheck: options?.noSchemaCheck,
        forceApplyAll,
        idpUserTriggerTargets,
      };
      const functionRegistry = await withSpan("plan.functionRegistry", () =>
        planFunctionRegistry(
          client,
          workspaceId,
          application.name,
          application.id,
          functionEntries,
        ),
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

    // Phase 1b: Confirm
    await withSpan("confirm", async () => {
      const allConflicts: OwnerConflict[] = [
        ...functionRegistry.conflicts,
        ...tailorDB.conflicts,
        ...staticWebsite.conflicts,
        ...aiGateway.conflicts,
        ...idp.conflicts,
        ...auth.conflicts,
        ...pipeline.conflicts,
        ...executor.conflicts,
        ...workflow.conflicts,
        ...secretManager.conflicts,
      ];
      await confirmOwnerConflict(allConflicts, application.name, yes);

      const allUnmanaged: UnmanagedResource[] = [
        ...functionRegistry.unmanaged,
        ...tailorDB.unmanaged,
        ...staticWebsite.unmanaged,
        ...aiGateway.unmanaged,
        ...idp.unmanaged,
        ...auth.unmanaged,
        ...pipeline.unmanaged,
        ...executor.unmanaged,
        ...workflow.unmanaged,
        ...secretManager.unmanaged,
      ];
      await confirmUnmanagedResources(allUnmanaged, application.name, yes);

      const importantDeletions: ImportantResourceDeletion[] = [];
      for (const del of tailorDB.changeSet.type.deletes) {
        importantDeletions.push({
          resourceType: "TailorDB type",
          resourceName: del.name,
        });
      }
      for (const del of staticWebsite.changeSet.deletes) {
        importantDeletions.push({
          resourceType: "StaticWebsite",
          resourceName: del.name,
        });
      }
      for (const del of aiGateway.changeSet.deletes) {
        importantDeletions.push({
          resourceType: "AIGateway",
          resourceName: del.name,
        });
      }
      for (const del of auth.changeSet.oauth2Client.deletes) {
        importantDeletions.push({
          resourceType: "OAuth2 client",
          resourceName: del.name,
        });
      }
      for (const replace of auth.changeSet.oauth2Client.replaces) {
        importantDeletions.push({
          resourceType: "OAuth2 client (client type change)",
          resourceName: replace.name,
        });
      }
      for (const del of auth.changeSet.connection.deletes) {
        importantDeletions.push({
          resourceType: "Auth connection",
          resourceName: del.name,
        });
      }
      for (const del of secretManager.vaultChangeSet.deletes) {
        importantDeletions.push({
          resourceType: "Secret Manager vault",
          resourceName: del.name,
        });
      }
      for (const del of secretManager.secretChangeSet.deletes) {
        importantDeletions.push({
          resourceType: "Secret Manager secret",
          resourceName: del.name,
        });
      }
      await confirmImportantResourceDeletion(importantDeletions, yes);

      // Delete renamed applications
      const resourceOwners = new Set([
        ...functionRegistry.resourceOwners,
        ...tailorDB.resourceOwners,
        ...staticWebsite.resourceOwners,
        ...aiGateway.resourceOwners,
        ...idp.resourceOwners,
        ...auth.resourceOwners,
        ...pipeline.resourceOwners,
        ...executor.resourceOwners,
        ...workflow.resourceOwners,
        ...secretManager.resourceOwners,
      ]);
      const emptyApps = computeRenamedAppDeletions({
        conflicts: allConflicts,
        resourceOwners,
        targetAppName: application.name,
      });
      for (const emptyApp of emptyApps) {
        app.deletes.push({
          name: emptyApp,
          request: {
            workspaceId,
            applicationName: emptyApp,
          },
        });
      }
    });

    const planSummary = printPlanResults(
      {
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
      },
      { dryRun: options?.dryRun },
    );

    if (options?.noValidate) {
      logger.warn("Client-side validation skipped (--no-validate).");
    } else {
      await validatePlan({
        functionRegistry,
        tailorDB,
        staticWebsite,
        idp,
        auth,
        pipeline,
        app,
        executor,
        workflow,
        secretManager,
      });
    }

    if (dryRun) {
      logger.info("Dry run enabled. No changes applied.");
      return;
    }

    // Phase 2: Create/Update services that Application depends on
    await withSpan("apply.createUpdateServices", async () => {
      await applySecretManager(client, secretManager, "create-update", application);
      await applyFunctionRegistry(client, workspaceId, functionRegistry, "create-update");
      await applyStaticWebsite(client, staticWebsite, "create-update");
      await applyAIGateway(client, aiGateway, "create-update");
      await applyIdP(client, idp, "create-update");
      await applyAuth(client, auth, "create-update");
      await applyTailorDB(client, tailorDB, "create-update");
      await applyPipeline(client, pipeline, "create-update");
    });

    // Phase 3: Delete subgraph resources (types, resolvers, etc.) before Application update
    await withSpan("apply.deleteSubgraphResources", async () => {
      await applyPipeline(client, pipeline, "delete-resources");
      await applyAuth(client, auth, "delete-resources");
      await applyIdP(client, idp, "delete-resources");
    });

    // Phase 4: Create/Update Application
    await withSpan("apply.createUpdateApplication", () =>
      applyApplication(client, app, "create-update"),
    );

    // Phase 5: Create/Update services that depend on Application
    await withSpan("apply.createUpdateDependentServices", async () => {
      await applyExecutor(client, executor, "create-update");
      await applyWorkflow(client, workflow, "create-update");
    });

    // Phase 6: Delete services that depend on Application
    await withSpan("apply.deleteDependentServices", async () => {
      await applyWorkflow(client, workflow, "delete");
      await applyExecutor(client, executor, "delete");
      await applyStaticWebsite(client, staticWebsite, "delete");
      await applyAIGateway(client, aiGateway, "delete");
      await applySecretManager(client, secretManager, "delete");
    });

    // Phase 7: Delete Application
    await withSpan("apply.deleteApplication", () => applyApplication(client, app, "delete"));

    // Phase 8: Delete subgraph services (after Application is deleted, no reference errors)
    await withSpan("apply.deleteSubgraphServices", async () => {
      await applyPipeline(client, pipeline, "delete-services");
      await applyAuth(client, auth, "delete-services");
      await applyIdP(client, idp, "delete-services");
      await applyTailorDB(client, tailorDB, "delete-services");
    });

    // Phase 9: Delete unused function registry entries
    await withSpan("apply.cleanup", () =>
      applyFunctionRegistry(client, workspaceId, functionRegistry, "delete"),
    );

    if (logger.jsonMode) {
      logger.out({ summary: planSummary, status: "applied" });
    } else {
      logger.success("Successfully applied changes.");
    }
  });
}
