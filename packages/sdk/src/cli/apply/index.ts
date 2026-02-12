import * as fs from "node:fs";
import * as path from "pathe";
import { defineCommand, arg } from "politty";
import { z } from "zod";
import { defineApplication } from "@/cli/application";
import { createExecutorService } from "@/cli/application/executor/service";
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
import { generatePluginExecutorFiles } from "@/cli/generator/plugin-executor-generator";
import { generatePluginTypeFiles } from "@/cli/generator/plugin-type-generator";
import { generateUserTypes } from "@/cli/type-generator";
import { getDistDir } from "@/cli/utils/dist-dir";
import { PluginManager } from "@/plugin/manager";
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
import { applyPipeline, planPipeline } from "./services/resolver";
import { applyStaticWebsite, planStaticWebsite } from "./services/staticwebsite";
import { applyTailorDB, planTailorDB } from "./services/tailordb";
import { applyWorkflow, planWorkflow } from "./services/workflow";
import type { Application } from "@/cli/application";
import type { FileLoadConfig } from "@/cli/application/file-loader";
import type { OperatorClient } from "@/cli/client";
import type { LoadedConfig } from "@/cli/config-loader";
import type { PluginBase } from "@/parser/plugin-config/types";

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

type MutableApplication = Omit<Application, "executorService"> & {
  executorService: Application["executorService"];
};

/**
 * Apply the configured application to the Tailor platform.
 * @param options - Options for apply execution
 * @returns Promise that resolves when apply completes
 */
export async function apply(options?: ApplyOptions) {
  // Load and validate options
  const { config, plugins } = await loadConfig(options?.configPath);
  const dryRun = options?.dryRun ?? false;
  const yes = options?.yes ?? false;
  const buildOnly = options?.buildOnly ?? process.env.TAILOR_PLATFORM_SDK_BUILD_ONLY === "true";

  // Initialize plugin manager if plugins are provided
  let pluginManager: PluginManager | undefined;
  if (plugins.length > 0) {
    pluginManager = new PluginManager(plugins as unknown as PluginBase[]);
  }

  // Generate user types from loaded config
  await generateUserTypes({ config, configPath: config.path, plugins });
  const application = defineApplication({ config, pluginManager });

  // Load files first (before building)
  // Load workflows first and collect jobs for bundling
  let workflowResult: WorkflowLoadResult | undefined;
  if (application.workflowConfig) {
    workflowResult = await loadAndCollectJobs(application.workflowConfig);
  }

  // Build trigger context for workflow/job trigger transformation
  const triggerContext = await buildTriggerContext(application.workflowConfig);

  let tailordbTypesLoaded = false;
  let pluginExecutorFiles: string[] = [];

  // Load TailorDB types early to generate plugin type/executor files before bundling
  if (application.tailorDBServices.length > 0) {
    for (const tailordb of application.tailorDBServices) {
      await tailordb.loadTypes();
      // Process namespace plugins (generates types without requiring a source type)
      await tailordb.processNamespacePlugins();
    }
    tailordbTypesLoaded = true;
  }

  // Generate plugin type/executor files (matches `generate` flow ordering)
  const pluginOutputDir = path.join(getDistDir(), "plugin");
  const pluginTypes = pluginManager?.getPluginGeneratedTypes() ?? [];
  const typeGenerationResult = generatePluginTypeFiles(pluginTypes, pluginOutputDir);

  const sourceTypeFilePaths = new Map<string, string>();
  for (const db of application.tailorDBServices) {
    const typeSourceInfo = db.getTypeSourceInfo();
    for (const [typeName, sourceInfo] of Object.entries(typeSourceInfo)) {
      if (sourceInfo.filePath) {
        sourceTypeFilePaths.set(typeName, sourceInfo.filePath);
      }
    }
  }

  const pluginExecutors = pluginManager?.getPluginGeneratedExecutorsWithImportPath() ?? [];
  const generatedExecutorFiles = generatePluginExecutorFiles(
    pluginExecutors,
    pluginOutputDir,
    typeGenerationResult,
    sourceTypeFilePaths,
    config.path,
  );

  // Discover plugin executor files after generation
  const pluginExecutorFileSet = new Set<string>(generatedExecutorFiles);
  // Also check legacy path for backwards compatibility
  const legacyPluginExecutorDir = path.join(getDistDir(), "plugin-executors");
  if (fs.existsSync(legacyPluginExecutorDir)) {
    const legacyFiles = fs
      .readdirSync(legacyPluginExecutorDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(legacyPluginExecutorDir, f));
    for (const file of legacyFiles) {
      pluginExecutorFileSet.add(file);
    }
  }
  pluginExecutorFiles = Array.from(pluginExecutorFileSet);
  const executorService =
    application.executorService ??
    (pluginExecutorFiles.length > 0
      ? createExecutorService({ config: { files: [] }, pluginManager })
      : undefined);
  const mutableApplication = application as MutableApplication;
  mutableApplication.executorService = executorService;

  // Build functions (using already loaded data)
  for (const app of application.applications) {
    for (const pipeline of app.resolverServices) {
      await buildPipeline(pipeline.namespace, pipeline.config, triggerContext);
    }
  }

  if (executorService) {
    await buildExecutor(executorService.config, triggerContext, pluginExecutorFiles);
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

  // Load remaining files and print logs
  // Order: TailorDB → Resolver → Executor → Workflow
  if (!tailordbTypesLoaded) {
    for (const tailordb of application.tailorDBServices) {
      await tailordb.loadTypes();
      // Process namespace plugins (generates types without requiring a source type)
      await tailordb.processNamespacePlugins();
    }
  }

  for (const pipeline of application.resolverServices) {
    await pipeline.loadResolvers();
  }
  if (executorService) {
    await executorService.loadExecutors();
    // Load plugin-generated executors from generated TypeScript files
    if (pluginExecutorFiles.length > 0) {
      await executorService.loadPluginExecutorFiles(pluginExecutorFiles);
    }
  }
  // Print workflow loading logs last (workflows were already loaded for bundling)
  if (workflowResult) {
    printLoadedWorkflows(workflowResult);
  }
  logger.newline();

  // Phase 1: Plan
  const ctx: PlanContext = {
    client,
    workspaceId,
    application,
    forRemoval: false,
    config,
    noSchemaCheck: options?.noSchemaCheck,
  };
  const tailorDB = await planTailorDB(ctx);
  const staticWebsite = await planStaticWebsite(ctx);
  const idp = await planIdP(ctx);
  const auth = await planAuth(ctx);
  const pipeline = await planPipeline(ctx);
  const app = await planApplication(ctx);
  const executor = await planExecutor(ctx);
  const workflow = await planWorkflow(
    client,
    workspaceId,
    application.name,
    workflowResult?.workflows ?? {},
    workflowBuildResult?.mainJobDeps ?? {},
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

  // Other services: Apply before TailorDB (migration scripts may require Auth)
  await applyStaticWebsite(client, staticWebsite, "create-update");
  await applyIdP(client, idp, "create-update");
  await applyAuth(client, auth, "create-update");
  await applyTailorDB(client, tailorDB, "create-update");

  await applyPipeline(client, pipeline, "create-update");

  // Phase 3: Delete subgraph resources (types, resolvers, etc.) before Application update
  // This avoids GraphQL SDL composition errors when resources conflict with system-generated ones
  // NOTE: Services are NOT deleted here - they will be deleted after Application is deleted
  // NOTE: TailorDB resource deletions are handled during the create-update phase
  //       after migration scripts execute.
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

async function buildExecutor(
  config: FileLoadConfig,
  triggerContext?: TriggerContext,
  additionalFiles?: string[],
) {
  await bundleExecutors({ config, triggerContext, additionalFiles });
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
