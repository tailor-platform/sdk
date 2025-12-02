import { defineCommand } from "citty";
import { defineApplication } from "@/cli/application";
import {
  loadAndCollectJobs,
  printLoadedWorkflows,
  type CollectedJob,
  type WorkflowLoadResult,
} from "@/cli/application/workflow/service";
import { bundleExecutors } from "@/cli/bundler/executor/executor-bundler";
import { bundleResolvers } from "@/cli/bundler/resolver/resolver-bundler";
import { bundleWorkflowJobs } from "@/cli/bundler/workflow/workflow-bundler";
import { loadConfig } from "@/cli/config-loader";
import { generateUserTypes } from "@/cli/type-generator";
import { commonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadConfigPath, loadWorkspaceId } from "../context";
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
import {
  applyStaticWebsite,
  planStaticWebsite,
} from "./services/staticwebsite";
import { applyTailorDB, planTailorDB } from "./services/tailordb";
import { applyWorkflow, planWorkflow } from "./services/workflow";
import type { Application } from "@/cli/application";
import type { FileLoadConfig } from "@/cli/application/file-loader";
import type { OperatorClient } from "@/cli/client";

export interface ApplyOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  dryRun?: boolean;
  yes?: boolean;
  // NOTE(remiposo): Provide an option to run build-only for testing purposes.
  // This could potentially be exposed as a CLI option.
  buildOnly?: boolean;
}

export interface PlanContext {
  client: OperatorClient;
  workspaceId: string;
  application: Readonly<Application>;
  forRemoval: boolean;
}

export type ApplyPhase = "create-update" | "delete";

export async function apply(options?: ApplyOptions) {
  // Load and validate options
  const configPath = loadConfigPath(options?.configPath);
  const { config } = await loadConfig(configPath);
  const dryRun = options?.dryRun ?? false;
  const yes = options?.yes ?? false;
  const buildOnly = options?.buildOnly ?? false;

  // Generate user types from loaded config
  await generateUserTypes(config, configPath);
  const application = defineApplication(config);

  // Load files first (before building)
  // Load workflows first and collect jobs for bundling
  let workflowResult: WorkflowLoadResult | undefined;
  if (application.workflowConfig) {
    workflowResult = await loadAndCollectJobs(application.workflowConfig);
  }

  // Build functions (using already loaded data)
  for (const app of application.applications) {
    for (const pipeline of app.resolverServices) {
      await buildPipeline(pipeline.namespace, pipeline.config);
    }
  }
  if (application.executorService) {
    await buildExecutor(application.executorService.config);
  }
  if (workflowResult && workflowResult.jobs.length > 0) {
    await buildWorkflow(workflowResult.jobs, application.env);
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
  for (const tailordb of application.tailorDBServices) {
    await tailordb.loadTypes();
  }
  for (const pipeline of application.resolverServices) {
    await pipeline.loadResolvers();
  }
  if (application.executorService) {
    await application.executorService.loadExecutors();
  }
  // Print workflow loading logs last (workflows were already loaded for bundling)
  if (workflowResult) {
    printLoadedWorkflows(workflowResult);
  }
  console.log("");

  // Phase 1: Plan
  const ctx: PlanContext = {
    client,
    workspaceId,
    application,
    forRemoval: false,
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
    workflowResult?.workflows ?? {},
  );

  // Confirm conflicts
  const allConflicts: OwnerConflict[] = [
    ...tailorDB.conflicts,
    ...staticWebsite.conflicts,
    ...idp.conflicts,
    ...auth.conflicts,
    ...pipeline.conflicts,
    ...executor.conflicts,
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
  ]);
  const conflictOwners = new Set(allConflicts.map((c) => c.currentOwner));
  const emptyApps = [...conflictOwners].filter(
    (owner) => !resourceOwners.has(owner),
  );
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
    console.log("Dry run enabled. No changes applied.");
    return;
  }

  // Phase 2: Apply Create/Update
  await applyTailorDB(client, tailorDB, "create-update");
  await applyStaticWebsite(client, staticWebsite, "create-update");
  await applyIdP(client, idp, "create-update");
  await applyAuth(client, auth, "create-update");
  await applyPipeline(client, pipeline, "create-update");
  await applyApplication(client, app, "create-update");
  await applyExecutor(client, executor, "create-update");
  await applyWorkflow(client, workflow, "create-update");

  // Phase 3: Apply Delete in reverse order
  await applyWorkflow(client, workflow, "delete");
  await applyExecutor(client, executor, "delete");
  await applyApplication(client, app, "delete");
  await applyPipeline(client, pipeline, "delete");
  await applyAuth(client, auth, "delete");
  await applyIdP(client, idp, "delete");
  await applyStaticWebsite(client, staticWebsite, "delete");
  await applyTailorDB(client, tailorDB, "delete");

  console.log("Successfully applied changes.");
}

async function buildPipeline(namespace: string, config: FileLoadConfig) {
  await bundleResolvers(namespace, config);
}

async function buildExecutor(config: FileLoadConfig) {
  await bundleExecutors(config);
}

async function buildWorkflow(
  collectedJobs: CollectedJob[],
  env: Record<string, string | number | boolean>,
) {
  // Use the workflow bundler with already collected jobs
  await bundleWorkflowJobs(collectedJobs, env);
}

export const applyCommand = defineCommand({
  meta: {
    name: "apply",
    description: "Apply Tailor configuration to generate files",
  },
  args: {
    ...commonArgs,
    "workspace-id": {
      type: "string",
      description: "ID of the workspace to apply the configuration to",
      alias: "w",
    },
    profile: {
      type: "string",
      description: "Workspace profile to use",
      alias: "p",
    },
    config: {
      type: "string",
      description: "Path to SDK config file",
      alias: "c",
      default: "tailor.config.ts",
    },
    dryRun: {
      type: "boolean",
      description: "Run the command without making any changes",
      alias: "d",
    },
    yes: {
      type: "boolean",
      description: "Skip all confirmation prompts",
      alias: "y",
    },
  },
  run: withCommonArgs(async (args) => {
    await apply({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      dryRun: args.dryRun,
      yes: args.yes,
    });
  }),
});
