import { defineCommand, arg } from "politty";
import { z } from "zod";
import { defineApplication } from "@/cli/application";
import {
  loadAndCollectJobs,
  printLoadedWorkflows,
  type CollectedJob,
  type WorkflowLoadResult,
} from "@/cli/application/workflow/service";
import { bundleExecutors } from "@/cli/bundler/executor/executor-bundler";
import { bundleResolvers } from "@/cli/bundler/resolver/resolver-bundler";
import { buildTriggerContext, type TriggerContext } from "@/cli/bundler/trigger-context";
import {
  bundleWorkflowJobs,
  type BundleWorkflowJobsResult,
} from "@/cli/bundler/workflow/workflow-bundler";
import { loadConfig } from "@/cli/config-loader";
import { generateUserTypes } from "@/cli/type-generator";
import { commonArgs, confirmationArgs, deploymentArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";
import { applyApplication, planApplication } from "./services/application";
import { applyAuth, planAuth } from "./services/auth";
import {
  confirmImportantResourceDeletion,
  confirmOwnerConflict,
  confirmUnmanagedResources,
  type ImportantResourceDeletion,
  type OwnerConflict,
  type UnmanagedResource,
} from "./services/confirm";
import { applyExecutor, planExecutor } from "./services/executor";
import { applyIdP, planIdP } from "./services/idp";
import { createChangeSet } from "./services/index";
import { applyPipeline, planPipeline } from "./services/resolver";
import { applyStaticWebsite, planStaticWebsite } from "./services/staticwebsite";
import { applyTailorDB, planTailorDB } from "./services/tailordb";
import { applyWorkflow, planWorkflow } from "./services/workflow";
import type { Application } from "@/cli/application";
import type { FileLoadConfig } from "@/cli/application/file-loader";
import type { OperatorClient } from "@/cli/client";
import type { LoadedConfig } from "@/cli/config-loader";

export interface ApplyOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  dryRun?: boolean;
  yes?: boolean;
  noSchemaCheck?: boolean;
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
}

export type ApplyPhase = "create-update" | "delete" | "delete-resources" | "delete-services";

/**
 * Apply the configured application to the Tailor platform.
 * @param options - Options for apply execution
 * @returns Promise that resolves when apply completes
 */
export async function apply(options?: ApplyOptions) {
  // Load and validate options
  const { config } = await loadConfig(options?.configPath);
  const dryRun = options?.dryRun ?? false;
  const yes = options?.yes ?? false;
  const buildOnly = options?.buildOnly ?? process.env.TAILOR_PLATFORM_SDK_BUILD_ONLY === "true";

  // TailorDB only mode: skip other services when migration version is specified
  const tailorDBOnlyMode = !!process.env.TAILOR_INTERNAL_APPLY_MIGRATION_VERSION;

  // Generate user types from loaded config
  await generateUserTypes(config, config.path);
  const application = defineApplication(config);

  // Build services (skipped in TailorDB only mode)
  const { workflowResult, workflowBuildResult } = await buildServices(
    application,
    tailorDBOnlyMode,
  );
  if (buildOnly) return;

  // Initialize client
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  // Load services (non-TailorDB services skipped in TailorDB only mode)
  await loadServices(application, workflowResult, tailorDBOnlyMode);
  logger.newline();

  // Log TailorDB only mode
  if (tailorDBOnlyMode) {
    logger.info("TailorDB only mode: other services will be skipped");
    logger.newline();
  }

  // Phase 1: Plan
  const ctx: PlanContext = {
    client,
    workspaceId,
    application,
    forRemoval: false,
    config,
    noSchemaCheck: options?.noSchemaCheck,
  };
  const { tailorDB, staticWebsite, idp, auth, pipeline, app, executor, workflow } =
    await planServices(
      ctx,
      client,
      workspaceId,
      application.name,
      workflowResult,
      workflowBuildResult,
      tailorDBOnlyMode,
    );

  // Confirm conflicts
  const allConflicts: OwnerConflict[] = [
    ...tailorDB.conflicts,
    ...staticWebsite.conflicts,
    ...idp.conflicts,
    ...auth.conflicts,
    ...pipeline.conflicts,
    ...executor.conflicts,
    ...workflow.conflicts,
  ];
  await confirmOwnerConflict(allConflicts, application.name, yes);
  // Confirm unmanaged resources
  const allUnmanaged: UnmanagedResource[] = [
    ...tailorDB.unmanaged,
    ...staticWebsite.unmanaged,
    ...idp.unmanaged,
    ...auth.unmanaged,
    ...pipeline.unmanaged,
    ...executor.unmanaged,
    ...workflow.unmanaged,
  ];
  await confirmUnmanagedResources(allUnmanaged, application.name, yes);
  // Confirm important deletions
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
  await confirmImportantResourceDeletion(importantDeletions, yes);

  // Delete renamed applications
  // NOTE: When removing resources while renaming the app at the same time,
  // the app and its resources don't get deleted and are left orphaned...
  const resourceOwners = new Set([
    ...tailorDB.resourceOwners,
    ...staticWebsite.resourceOwners,
    ...idp.resourceOwners,
    ...auth.resourceOwners,
    ...pipeline.resourceOwners,
    ...executor.resourceOwners,
    ...workflow.resourceOwners,
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
  if (dryRun) {
    logger.info("Dry run enabled. No changes applied.");
    return;
  }

  // Phase 2: Create/Update services that Application depends on
  // - Subgraph services (for GraphQL SDL composition): TailorDB, IdP, Auth, Pipeline
  // - StaticWebsite (for CORS and OAuth2 redirect URI resolution)

  // TailorDB: Automatically validates migrations and handles migration flow internally
  await applyTailorDB(client, tailorDB, "create-update");

  // Other services: Apply after TailorDB migrations complete
  // (empty plans in TailorDB only mode - apply functions do nothing)
  await applyStaticWebsite(client, staticWebsite, "create-update");
  await applyIdP(client, idp, "create-update");
  await applyAuth(client, auth, "create-update");
  await applyPipeline(client, pipeline, "create-update");

  // Phase 3: Delete subgraph resources (types, resolvers, etc.) before Application update
  // This avoids GraphQL SDL composition errors when resources conflict with system-generated ones
  // NOTE: Services are NOT deleted here - they will be deleted after Application is deleted
  // NOTE: TailorDB resource deletions are handled within create-update phase (above)
  //       because migration flow requires: pre-migration → script execution → post-migration (with deletions)
  await applyPipeline(client, pipeline, "delete-resources");
  await applyAuth(client, auth, "delete-resources");
  await applyIdP(client, idp, "delete-resources");

  // Phase 4: Create/Update Application (after subgraph resource changes complete)
  await applyApplication(client, app, "create-update");

  // Phase 5: Create/Update services that depend on Application
  await applyExecutor(client, executor, "create-update");
  await applyWorkflow(client, workflow, "create-update");

  // Phase 6: Delete services that depend on Application
  await applyWorkflow(client, workflow, "delete");
  await applyExecutor(client, executor, "delete");
  await applyStaticWebsite(client, staticWebsite, "delete");

  // Phase 7: Delete Application
  await applyApplication(client, app, "delete");

  // Phase 8: Delete subgraph services (after Application is deleted, no reference errors)
  // Fix for issue #570: Services couldn't be deleted because Application was still referencing them
  await applyPipeline(client, pipeline, "delete-services");
  await applyAuth(client, auth, "delete-services");
  await applyIdP(client, idp, "delete-services");
  await applyTailorDB(client, tailorDB, "delete-services");

  logger.success("Successfully applied changes.");
}

async function buildPipeline(
  namespace: string,
  config: FileLoadConfig,
  triggerContext?: TriggerContext,
) {
  await bundleResolvers(namespace, config, triggerContext);
}

async function buildExecutor(config: FileLoadConfig, triggerContext?: TriggerContext) {
  await bundleExecutors(config, triggerContext);
}

async function buildWorkflow(
  collectedJobs: CollectedJob[],
  mainJobNames: string[],
  env: Record<string, string | number | boolean>,
  triggerContext?: TriggerContext,
): Promise<BundleWorkflowJobsResult> {
  // Use the workflow bundler with already collected jobs
  return bundleWorkflowJobs(collectedJobs, mainJobNames, env, triggerContext);
}

// ============================================================================
// Service orchestration functions
// ============================================================================

interface BuildServicesResult {
  workflowResult: WorkflowLoadResult | undefined;
  workflowBuildResult: BundleWorkflowJobsResult | undefined;
}

async function buildServices(
  application: Readonly<Application>,
  tailorDBOnly: boolean,
): Promise<BuildServicesResult> {
  if (tailorDBOnly) {
    return { workflowResult: undefined, workflowBuildResult: undefined };
  }

  let workflowResult: WorkflowLoadResult | undefined;
  if (application.workflowConfig) {
    workflowResult = await loadAndCollectJobs(application.workflowConfig);
  }

  const triggerContext = await buildTriggerContext(application.workflowConfig);

  for (const app of application.applications) {
    for (const pipeline of app.resolverServices) {
      await buildPipeline(pipeline.namespace, pipeline.config, triggerContext);
    }
  }
  if (application.executorService) {
    await buildExecutor(application.executorService.config, triggerContext);
  }

  let workflowBuildResult: BundleWorkflowJobsResult | undefined;
  if (workflowResult && workflowResult.jobs.length > 0) {
    const mainJobNames = workflowResult.workflowSources.map((ws) => ws.workflow.mainJob.name);
    workflowBuildResult = await buildWorkflow(
      workflowResult.jobs,
      mainJobNames,
      application.env,
      triggerContext,
    );
  }

  return { workflowResult, workflowBuildResult };
}

async function loadServices(
  application: Readonly<Application>,
  workflowResult: WorkflowLoadResult | undefined,
  tailorDBOnly: boolean,
) {
  // Always load TailorDB types
  for (const tailordb of application.tailorDBServices) {
    await tailordb.loadTypes();
  }

  if (tailorDBOnly) {
    return;
  }

  // Load other services
  for (const pipeline of application.resolverServices) {
    await pipeline.loadResolvers();
  }
  if (application.executorService) {
    await application.executorService.loadExecutors();
  }
  if (workflowResult) {
    printLoadedWorkflows(workflowResult);
  }
}

// Empty plan helpers - using type assertions since the plans are empty and won't be used
type StaticWebsitePlanResult = Awaited<ReturnType<typeof planStaticWebsite>>;
type IdPPlanResult = Awaited<ReturnType<typeof planIdP>>;
type AuthPlanResult = Awaited<ReturnType<typeof planAuth>>;
type PipelinePlanResult = Awaited<ReturnType<typeof planPipeline>>;
type ApplicationPlanResult = Awaited<ReturnType<typeof planApplication>>;
type ExecutorPlanResult = Awaited<ReturnType<typeof planExecutor>>;
type WorkflowPlanResult = Awaited<ReturnType<typeof planWorkflow>>;

function emptyStaticWebsitePlan(): StaticWebsitePlanResult {
  return {
    changeSet: createChangeSet("StaticWebsites"),
    conflicts: [],
    unmanaged: [],
    resourceOwners: new Set<string>(),
  } as unknown as StaticWebsitePlanResult;
}

function emptyIdPPlan(): IdPPlanResult {
  return {
    changeSet: {
      service: createChangeSet("IdP services"),
      client: createChangeSet("IdP clients"),
    },
    conflicts: [],
    unmanaged: [],
    resourceOwners: new Set<string>(),
  } as unknown as IdPPlanResult;
}

function emptyAuthPlan(): AuthPlanResult {
  return {
    changeSet: {
      service: createChangeSet("Auth services"),
      idpConfig: createChangeSet("IdP configs"),
      oauth2Client: createChangeSet("OAuth2 clients"),
      machineUser: createChangeSet("Machine users"),
      userProfileConfig: createChangeSet("User profile configs"),
      tenantConfig: createChangeSet("Tenant configs"),
      scim: createChangeSet("SCIM configs"),
      scimResource: createChangeSet("SCIM resources"),
    },
    conflicts: [],
    unmanaged: [],
    resourceOwners: new Set<string>(),
  } as unknown as AuthPlanResult;
}

function emptyPipelinePlan(): PipelinePlanResult {
  return {
    changeSet: {
      service: createChangeSet("Pipeline services"),
      resolver: createChangeSet("Resolvers"),
    },
    conflicts: [],
    unmanaged: [],
    resourceOwners: new Set<string>(),
  } as unknown as PipelinePlanResult;
}

function emptyApplicationPlan(): ApplicationPlanResult {
  return createChangeSet("Applications") as unknown as ApplicationPlanResult;
}

function emptyExecutorPlan(): ExecutorPlanResult {
  return {
    changeSet: createChangeSet("Executors"),
    conflicts: [],
    unmanaged: [],
    resourceOwners: new Set<string>(),
  } as unknown as ExecutorPlanResult;
}

function emptyWorkflowPlan(): WorkflowPlanResult {
  return {
    changeSet: createChangeSet("Workflows"),
    conflicts: [],
    unmanaged: [],
    resourceOwners: new Set<string>(),
    appName: "",
  } as unknown as WorkflowPlanResult;
}

async function planServices(
  ctx: PlanContext,
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  workflowResult: WorkflowLoadResult | undefined,
  workflowBuildResult: BundleWorkflowJobsResult | undefined,
  tailorDBOnly: boolean,
) {
  const tailorDB = await planTailorDB(ctx);

  if (tailorDBOnly) {
    return {
      tailorDB,
      staticWebsite: emptyStaticWebsitePlan(),
      idp: emptyIdPPlan(),
      auth: emptyAuthPlan(),
      pipeline: emptyPipelinePlan(),
      app: emptyApplicationPlan(),
      executor: emptyExecutorPlan(),
      workflow: emptyWorkflowPlan(),
    };
  }

  return {
    tailorDB,
    staticWebsite: await planStaticWebsite(ctx),
    idp: await planIdP(ctx),
    auth: await planAuth(ctx),
    pipeline: await planPipeline(ctx),
    app: await planApplication(ctx),
    executor: await planExecutor(ctx),
    workflow: await planWorkflow(
      client,
      workspaceId,
      appName,
      workflowResult?.workflows ?? {},
      workflowBuildResult?.mainJobDeps ?? {},
    ),
  };
}

export const applyCommand = defineCommand({
  name: "apply",
  description: "Apply Tailor configuration to deploy your application.",
  args: z.object({
    ...commonArgs,
    ...deploymentArgs,
    ...confirmationArgs,
    "dry-run": arg(z.boolean().optional(), {
      alias: "d",
      description: "Run the command without making any changes",
    }),
    "no-schema-check": arg(z.boolean().optional(), {
      description: "Skip schema diff check against migration snapshots",
    }),
  }),
  run: withCommonArgs(async (args) => {
    await apply({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      dryRun: args["dry-run"],
      yes: args.yes,
      noSchemaCheck: args["no-schema-check"],
    });
  }),
});
