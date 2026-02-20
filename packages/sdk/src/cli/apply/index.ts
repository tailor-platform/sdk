import { defineCommand, arg } from "politty";
import { z } from "zod";
import { loadApplication, type Application } from "@/cli/application";
import { loadConfig } from "@/cli/config-loader";
import { generateUserTypes } from "@/cli/type-generator";
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
import {
  applyFunctionRegistry,
  collectFunctionEntries,
  planFunctionRegistry,
} from "./services/function-registry";
import { applyIdP, planIdP } from "./services/idp";
import { applyPipeline, planPipeline } from "./services/resolver";
import { applyStaticWebsite, planStaticWebsite } from "./services/staticwebsite";
import { applyTailorDB, planTailorDB } from "./services/tailordb";
import { applyWorkflow, planWorkflow } from "./services/workflow";
import type { OperatorClient } from "@/cli/client";
import type { LoadedConfig } from "@/cli/config-loader";
import type { Plugin } from "@/parser/plugin-config/types";

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
  const { config, plugins } = await loadConfig(options?.configPath);
  const dryRun = options?.dryRun ?? false;
  const yes = options?.yes ?? false;
  const buildOnly = options?.buildOnly ?? process.env.TAILOR_PLATFORM_SDK_BUILD_ONLY === "true";

  // Initialize plugin manager if plugins are provided
  let pluginManager: PluginManager | undefined;
  if (plugins.length > 0) {
    pluginManager = new PluginManager(plugins as unknown as Plugin[]);
  }

  // Generate user types from loaded config
  await generateUserTypes({ config, configPath: config.path });

  // Load and initialize all application resources
  // This includes: types, plugins, workflows, bundling, and validation
  const { application, workflowResult, workflowBuildResult } = await loadApplication({
    config,
    pluginManager,
  });
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

  // Collect function entries from bundled scripts (after build, before plan)
  const functionEntries = collectFunctionEntries(application, workflowResult?.jobs ?? []);

  // Phase 1: Plan
  const ctx: PlanContext = {
    client,
    workspaceId,
    application,
    forRemoval: false,
    config,
    noSchemaCheck: options?.noSchemaCheck,
  };
  const functionRegistry = await planFunctionRegistry(
    client,
    workspaceId,
    application.name,
    functionEntries,
  );
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
    ...functionRegistry.conflicts,
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
    ...functionRegistry.unmanaged,
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
    ...functionRegistry.resourceOwners,
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
  // - Function registry (must be registered before services that reference them)
  // - Subgraph services (for GraphQL SDL composition): TailorDB, IdP, Auth, Pipeline
  // - StaticWebsite (for CORS and OAuth2 redirect URI resolution)

  // Register function scripts first (resolvers, executors, workflows reference them)
  await applyFunctionRegistry(client, workspaceId, functionRegistry, "create-update");

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

  // Phase 9: Delete unused function registry entries (after all referencing services are deleted)
  await applyFunctionRegistry(client, workspaceId, functionRegistry, "delete");

  logger.success("Successfully applied changes.");
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
