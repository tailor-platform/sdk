import * as fs from "node:fs";
import { Code, ConnectError } from "@connectrpc/connect";
import { findUpSync } from "find-up-simple";
import * as path from "pathe";
import { hashFile } from "@/cli/cache/hasher";
import { createCacheManager } from "@/cli/cache/manager";
import { loadApplication, type Application } from "@/cli/services/application";
import { initOperatorClient } from "@/cli/shared/client";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { getDistDir } from "@/cli/shared/dist-dir";
import { logger } from "@/cli/shared/logger";
import { readPackageJson } from "@/cli/shared/package-json";
import { generateUserTypes } from "@/cli/shared/type-generator";
import { withSpan } from "@/cli/telemetry";
import { PluginManager } from "@/plugin/manager";
import { applyApplication, planApplication } from "./application";
import { applyAuth, formatAuthHookChangeEntries, planAuth } from "./auth";
import {
  formatPlanSummary,
  summarizeChangeSets,
  type HasName,
  type PlanSummary,
} from "./change-set";
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
  authHookFunctionName,
  collectFunctionEntries,
  executorFunctionName,
  filterBundledWorkflowJobs,
  planFunctionRegistry,
  resolverFunctionName,
  splitFunctionRegistryChanges,
  WORKFLOW_PREFIX,
  workflowJobFunctionName,
} from "./function-registry";
import {
  formatChangeSetEntries,
  printGroupedDisplaySection,
  type GroupedDisplayEntry,
} from "./grouped-display";
import { applyIdP, planIdP } from "./idp";
import { buildMetaRequest, hasMatchingSdkVersion, sdkNameLabelKey } from "./label";
import { applyPipeline, formatResolverChangeEntries, planPipeline } from "./resolver";
import { applySecretManager, planSecretManager } from "./secret-manager";
import { applyStaticWebsite, planStaticWebsite } from "./staticwebsite";
import { applyTailorDB, formatTailorDBResourceChangeEntries, planTailorDB } from "./tailordb";
import { applyWorkflow, formatWorkflowChangeEntries, planWorkflow } from "./workflow";
import type { OperatorClient } from "@/cli/shared/client";
import type { LoadedConfig } from "@/cli/shared/config-loader";

export interface ApplyOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  dryRun?: boolean;
  yes?: boolean;
  noSchemaCheck?: boolean;
  noCache?: boolean;
  cleanCache?: boolean;
  // NOTE(remiposo): Provide an option to run build-only for testing purposes.
  // This could potentially be exposed as a CLI option.
  buildOnly?: boolean;
}

export interface PlanContext {
  client: OperatorClient;
  workspaceId: string;
  application: Readonly<Application>;
  forRemoval: boolean;
  config: LoadedConfig;
  noSchemaCheck?: boolean;
  forceApplyAll?: boolean;
}

export type ApplyPhase = "create-update" | "delete" | "delete-resources" | "delete-services";

function applicationTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:application:${name}`;
}

function functionRegistryTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:function_registry:${name}`;
}

function pipelineTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:pipeline:${name}`;
}

function idpTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:idp:${name}`;
}

function authTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:auth:${name}`;
}

function executorTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:executor:${name}`;
}

function workflowTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:workflow:${name}`;
}

function staticWebsiteTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:staticwebsite:${name}`;
}

function tailorDBTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:tailordb:${name}`;
}

function vaultTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:vault:${name}`;
}

async function shouldForceApplyAll(
  client: OperatorClient,
  workspaceId: string,
  application: Readonly<Application>,
  functionEntries: ReadonlyArray<{ name: string }>,
) {
  const desiredLabels = (
    await buildMetaRequest(applicationTrn(workspaceId, application.name), application.name)
  ).labels;
  const candidateTrns = new Set<string>();

  if (application.subgraphs.length > 0) {
    candidateTrns.add(applicationTrn(workspaceId, application.name));
  }
  application.staticWebsiteServices.forEach((website) => {
    candidateTrns.add(staticWebsiteTrn(workspaceId, website.name));
  });
  application.resolverServices.forEach((pipeline) => {
    candidateTrns.add(pipelineTrn(workspaceId, pipeline.namespace));
  });
  application.idpServices.forEach((idp) => {
    candidateTrns.add(idpTrn(workspaceId, idp.name));
  });
  if (application.authService) {
    candidateTrns.add(authTrn(workspaceId, application.authService.config.name));
  }
  Object.values(application.executorService?.executors ?? {}).forEach((executor) => {
    candidateTrns.add(executorTrn(workspaceId, executor.name));
  });
  Object.values(application.workflowService?.workflows ?? {}).forEach((workflow) => {
    candidateTrns.add(workflowTrn(workspaceId, workflow.name));
  });
  application.tailorDBServices.forEach((service) => {
    candidateTrns.add(tailorDBTrn(workspaceId, service.namespace));
  });
  application.secrets.forEach((vault) => {
    candidateTrns.add(vaultTrn(workspaceId, vault.vaultName));
  });
  functionEntries.forEach((entry) => {
    candidateTrns.add(functionRegistryTrn(workspaceId, entry.name));
  });

  for (const trn of candidateTrns) {
    try {
      const { metadata } = await client.getMetadata({ trn });
      if (metadata?.labels?.[sdkNameLabelKey] !== application.name) {
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

type PlanResults = {
  functionRegistry: Awaited<ReturnType<typeof planFunctionRegistry>>;
  tailorDB: Awaited<ReturnType<typeof planTailorDB>>;
  staticWebsite: Awaited<ReturnType<typeof planStaticWebsite>>;
  idp: Awaited<ReturnType<typeof planIdP>>;
  auth: Awaited<ReturnType<typeof planAuth>>;
  pipeline: Awaited<ReturnType<typeof planPipeline>>;
  app: Awaited<ReturnType<typeof planApplication>>;
  executor: Awaited<ReturnType<typeof planExecutor>>;
  workflow: Awaited<ReturnType<typeof planWorkflow>>;
  secretManager: Awaited<ReturnType<typeof planSecretManager>>;
};

function printPlanResults(results: PlanResults) {
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
  const tailorDBEntries: GroupedDisplayEntry[] = [
    ...formatChangeSetEntries(results.tailorDB.changeSet.service, ["service"]),
    ...tailorDBResourceEntries,
  ];
  const pipelineEntries: GroupedDisplayEntry[] = [
    ...formatChangeSetEntries(results.pipeline.changeSet.service, ["service"]),
    ...resolverEntries,
  ];
  const nsFromRequest = (item: HasName) =>
    "request" in item &&
    item.request &&
    typeof item.request === "object" &&
    "namespaceName" in item.request
      ? (item.request.namespaceName as string)
      : undefined;
  const authNsFromRequest = (item: HasName) =>
    "request" in item &&
    item.request &&
    typeof item.request === "object" &&
    "authNamespace" in item.request
      ? (item.request.authNamespace as string)
      : undefined;
  const idpEntries: GroupedDisplayEntry[] = [
    ...formatChangeSetEntries(results.idp.changeSet.service, ["service"]),
    ...formatChangeSetEntries(results.idp.changeSet.client, ["client"], nsFromRequest),
  ];
  const authEntries: GroupedDisplayEntry[] = [
    ...formatChangeSetEntries(results.auth.changeSet.service, ["service"]),
    ...formatChangeSetEntries(results.auth.changeSet.idpConfig, ["idpConfig"], nsFromRequest),
    ...formatChangeSetEntries(
      results.auth.changeSet.userProfileConfig,
      ["userProfileConfig"],
      nsFromRequest,
    ),
    ...formatChangeSetEntries(results.auth.changeSet.tenantConfig, ["tenantConfig"], nsFromRequest),
    ...formatChangeSetEntries(
      results.auth.changeSet.machineUser,
      ["machineUser"],
      authNsFromRequest,
    ),
    ...authHookEntries,
    ...formatChangeSetEntries(results.auth.changeSet.oauth2Client, ["oauth2Client"], nsFromRequest),
    ...formatChangeSetEntries(results.auth.changeSet.scim, ["scimConfig"], nsFromRequest),
    ...formatChangeSetEntries(results.auth.changeSet.scimResource, ["scimResource"], nsFromRequest),
    ...(results.auth.changeSet.connection
      ? formatChangeSetEntries(results.auth.changeSet.connection, ["connection"], nsFromRequest)
      : []),
  ];

  // Print grouped sections
  printGroupedDisplaySection("TailorDB", tailorDBEntries);
  printGroupedDisplaySection("Resolver", pipelineEntries);
  printGroupedDisplaySection("Executor", executorEntries);
  printGroupedDisplaySection("Workflow", workflowEntries);
  printGroupedDisplaySection("IdP", idpEntries);
  printGroupedDisplaySection("Auth", authEntries);

  // Compute summary
  const summary = summarizePlanResultsForDisplay(results, {
    executorEntries,
    resolverEntries,
    workflowEntries,
    authHookEntries,
    tailorDBEntries: tailorDBResourceEntries,
  });

  logger.log(formatPlanSummary(summary));
}

function addPlanSummary(target: PlanSummary, source: PlanSummary) {
  target.create += source.create;
  target.update += source.update;
  target.delete += source.delete;
  target.replace += source.replace;
  target.unchanged += source.unchanged;
}

function summarizeDisplayEntries(
  entries: ReadonlyArray<Pick<GroupedDisplayEntry, "action">>,
  unchanged = 0,
): PlanSummary {
  const summary: PlanSummary = {
    create: 0,
    update: 0,
    delete: 0,
    replace: 0,
    unchanged,
  };

  for (const entry of entries) {
    switch (entry.action) {
      case "create":
        summary.create += 1;
        break;
      case "update":
        summary.update += 1;
        break;
      case "delete":
        summary.delete += 1;
        break;
      case "replace":
        summary.replace += 1;
        break;
      default:
        throw new Error(`Unknown action type: ${entry.action satisfies never}`);
    }
  }

  return summary;
}

function countUnchangedNamesExcludingChanged(
  unchangedGroups: ReadonlyArray<ReadonlyArray<HasName>>,
  changedGroups: ReadonlyArray<ReadonlyArray<HasName>>,
): number {
  const changedNames = new Set<string>();
  for (const group of changedGroups) {
    for (const item of group) {
      changedNames.add(item.name);
    }
  }

  const unchangedNames = new Set<string>();
  for (const group of unchangedGroups) {
    for (const item of group) {
      if (!changedNames.has(item.name)) {
        unchangedNames.add(item.name);
      }
    }
  }

  return unchangedNames.size;
}

function countUnchangedItemsWithoutChangedRelations<T extends HasName>(
  unchangedItems: ReadonlyArray<T>,
  changedGroups: ReadonlyArray<ReadonlyArray<HasName>>,
  getRelatedChangedNames: (item: T) => ReadonlyArray<string>,
): number {
  const changedNames = new Set<string>();
  for (const group of changedGroups) {
    for (const item of group) {
      changedNames.add(item.name);
    }
  }

  let count = 0;
  for (const item of unchangedItems) {
    if (!getRelatedChangedNames(item).some((name) => changedNames.has(name))) {
      count += 1;
    }
  }

  return count;
}

type GroupedDisplayEntries = {
  executorEntries: ReadonlyArray<GroupedDisplayEntry>;
  resolverEntries: ReadonlyArray<GroupedDisplayEntry>;
  workflowEntries: ReadonlyArray<GroupedDisplayEntry>;
  authHookEntries: ReadonlyArray<GroupedDisplayEntry>;
  tailorDBEntries: ReadonlyArray<GroupedDisplayEntry>;
};

/**
 * Summarize plan counts using the same grouped units shown in dry-run output.
 * @param results - Planned apply results
 * @param displayEntries - Pre-computed grouped display entries for each resource kind
 * @returns Aggregated plan summary aligned with grouped display rows
 */
export function summarizePlanResultsForDisplay(
  results: PlanResults,
  displayEntries: GroupedDisplayEntries,
): PlanSummary {
  const { executorEntries, resolverEntries, workflowEntries, authHookEntries, tailorDBEntries } =
    displayEntries;
  const summary: PlanSummary = {
    create: 0,
    update: 0,
    delete: 0,
    replace: 0,
    unchanged: 0,
  };

  const { otherChanges } = splitFunctionRegistryChanges(results.functionRegistry.changeSet);
  addPlanSummary(
    summary,
    summarizeChangeSets([
      otherChanges,
      results.staticWebsite.changeSet,
      results.app,
      results.secretManager.vaultChangeSet,
      results.secretManager.secretChangeSet,
    ]),
  );

  addPlanSummary(
    summary,
    summarizeDisplayEntries(
      tailorDBEntries,
      countUnchangedNamesExcludingChanged(
        [
          results.tailorDB.changeSet.type.unchanged,
          results.tailorDB.changeSet.gqlPermission.unchanged,
        ],
        [
          results.tailorDB.changeSet.type.creates,
          results.tailorDB.changeSet.type.updates,
          results.tailorDB.changeSet.type.deletes,
          results.tailorDB.changeSet.type.replaces,
          results.tailorDB.changeSet.gqlPermission.creates,
          results.tailorDB.changeSet.gqlPermission.updates,
          results.tailorDB.changeSet.gqlPermission.deletes,
          results.tailorDB.changeSet.gqlPermission.replaces,
        ],
      ),
    ),
  );

  addPlanSummary(
    summary,
    summarizeDisplayEntries(
      resolverEntries,
      countUnchangedItemsWithoutChangedRelations(
        results.pipeline.changeSet.resolver.unchanged,
        [
          results.functionRegistry.resolverFunctionChanges.creates,
          results.functionRegistry.resolverFunctionChanges.updates,
          results.functionRegistry.resolverFunctionChanges.deletes,
          results.functionRegistry.resolverFunctionChanges.replaces,
        ],
        (item) => {
          const ns = results.pipeline.resolverNamespaceMap.get(item.name);
          return ns ? [resolverFunctionName(ns, item.name)] : [];
        },
      ),
    ),
  );

  addPlanSummary(
    summary,
    summarizeDisplayEntries(
      executorEntries,
      countUnchangedItemsWithoutChangedRelations(
        results.executor.changeSet.unchanged,
        [
          results.functionRegistry.executorFunctionChanges.creates,
          results.functionRegistry.executorFunctionChanges.updates,
          results.functionRegistry.executorFunctionChanges.deletes,
          results.functionRegistry.executorFunctionChanges.replaces,
        ],
        (item) => [executorFunctionName(item.name)],
      ),
    ),
  );

  addPlanSummary(
    summary,
    summarizeDisplayEntries(
      workflowEntries,
      countUnchangedItemsWithoutChangedRelations(
        results.workflow.changeSet.unchanged,
        [
          results.functionRegistry.workflowJobChanges.creates,
          results.functionRegistry.workflowJobChanges.updates,
          results.functionRegistry.workflowJobChanges.deletes,
          results.functionRegistry.workflowJobChanges.replaces,
        ],
        (item) => {
          const jobNames = results.workflow.unchangedWorkflowJobMap.get(item.name);
          return jobNames?.map((name) => workflowJobFunctionName(name)) ?? [];
        },
      ),
    ),
  );

  addPlanSummary(
    summary,
    summarizeDisplayEntries(
      authHookEntries,
      countUnchangedItemsWithoutChangedRelations(
        results.auth.changeSet.authHook.unchanged,
        [
          results.functionRegistry.authHookFunctionChanges.creates,
          results.functionRegistry.authHookFunctionChanges.updates,
          results.functionRegistry.authHookFunctionChanges.deletes,
          results.functionRegistry.authHookFunctionChanges.replaces,
        ],
        (item) => {
          const [namespaceName, hookPoint] = item.name.split("/");
          return namespaceName && hookPoint ? [authHookFunctionName(namespaceName, hookPoint)] : [];
        },
      ),
    ),
  );

  // Count service-level and non-grouped resources not tracked via display entries above
  addPlanSummary(
    summary,
    summarizeChangeSets([
      results.tailorDB.changeSet.service,
      results.pipeline.changeSet.service,
      results.idp.changeSet.service,
      results.idp.changeSet.client,
      results.auth.changeSet.service,
      results.auth.changeSet.idpConfig,
      results.auth.changeSet.userProfileConfig,
      results.auth.changeSet.tenantConfig,
      results.auth.changeSet.machineUser,
      results.auth.changeSet.oauth2Client,
      results.auth.changeSet.scim,
      results.auth.changeSet.scimResource,
      ...(results.auth.changeSet.connection ? [results.auth.changeSet.connection] : []),
    ]),
  );

  return summary;
}

/**
 * Apply the configured application to the Tailor platform.
 * @param options - Options for apply execution
 * @returns Promise that resolves to `{ bundledScripts }` when `buildOnly` is true, otherwise void
 */
export async function apply(options?: ApplyOptions) {
  return withSpan("apply", async (rootSpan) => {
    rootSpan.setAttribute("apply.dry_run", options?.dryRun ?? false);

    // Phase 0: Build
    const { config, application, workflowBuildResult, bundledScripts, buildOnly } = await withSpan(
      "build",
      async () => {
        const { config, plugins } = await withSpan("build.loadConfig", () =>
          loadConfig(options?.configPath),
        );

        const dryRun = options?.dryRun ?? false;
        const buildOnly =
          options?.buildOnly ?? process.env.TAILOR_PLATFORM_SDK_BUILD_ONLY === "true";
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
        let bundledScripts: Awaited<ReturnType<typeof loadApplication>>["bundledScripts"];
        try {
          const result = await withSpan("build.loadApplication", () =>
            loadApplication({ config, pluginManager, bundleCache: cacheManager.bundleCache }),
          );
          application = result.application;
          workflowBuildResult = result.workflowBuildResult;
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
          bundledScripts,
          dryRun,
          buildOnly,
        };
      },
    );
    if (buildOnly) {
      return { bundledScripts };
    }

    // Note: the normal apply path intentionally skips writing bundle files to
    // .tailor-sdk/. Bundles are kept in memory and uploaded directly to the
    // function registry. To test a function locally, use `function test-run`
    // with a .ts source file instead of a pre-bundled .js file.

    // Initialize client
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: options?.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = await loadWorkspaceId({
      workspaceId: options?.workspaceId,
      profile: options?.profile,
    });

    rootSpan.setAttribute("app.name", application.name);
    rootSpan.setAttribute("workspace.id", workspaceId);

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
      idp,
      auth,
      pipeline,
      app,
      executor,
      workflow,
      secretManager,
    } = await withSpan("plan", async () => {
      const ctx: PlanContext = {
        client,
        workspaceId,
        application,
        forRemoval: false,
        config,
        noSchemaCheck: options?.noSchemaCheck,
        forceApplyAll,
      };
      const functionRegistry = await withSpan("plan.functionRegistry", () =>
        planFunctionRegistry(client, workspaceId, application.name, functionEntries),
      );
      const unchangedWorkflowJobs = new Set(
        functionRegistry.changeSet.unchanged
          .filter((entry) => entry.name.startsWith(WORKFLOW_PREFIX))
          .map((entry) => entry.name.slice(WORKFLOW_PREFIX.length)),
      );
      const [tailorDB, staticWebsite, idp, auth, pipeline, app, executor, workflow, secretManager] =
        await Promise.all([
          withSpan("plan.tailorDB", () => planTailorDB(ctx)),
          withSpan("plan.staticWebsite", () => planStaticWebsite(ctx)),
          withSpan("plan.idp", () => planIdP(ctx)),
          withSpan("plan.auth", () => planAuth(ctx)),
          withSpan("plan.pipeline", () => planPipeline(ctx)),
          withSpan("plan.application", () => planApplication(ctx)),
          withSpan("plan.executor", () => planExecutor(ctx)),
          withSpan("plan.workflow", () =>
            planWorkflow(
              client,
              workspaceId,
              application.name,
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
        ...idp.resourceOwners,
        ...auth.resourceOwners,
        ...pipeline.resourceOwners,
        ...executor.resourceOwners,
        ...workflow.resourceOwners,
        ...secretManager.resourceOwners,
      ]);
      const conflictOwners = new Set(allConflicts.map((c) => c.currentOwner));
      const emptyApps = [...conflictOwners].filter((owner) => !resourceOwners.has(owner));
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

    printPlanResults({
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

    if (dryRun) {
      logger.info("Dry run enabled. No changes applied.");
      return;
    }

    // Phase 2: Create/Update services that Application depends on
    await withSpan("apply.createUpdateServices", async () => {
      await applySecretManager(client, secretManager, "create-update", application);
      await applyFunctionRegistry(client, workspaceId, functionRegistry, "create-update");
      await applyStaticWebsite(client, staticWebsite, "create-update");
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

    logger.success("Successfully applied changes.");
  });
}
