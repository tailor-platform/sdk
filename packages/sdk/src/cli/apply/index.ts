import * as path from "node:path";
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
import { buildTriggerContext, type TriggerContext } from "@/cli/bundler/trigger-context";
import {
  bundleWorkflowJobs,
  type BundleWorkflowJobsResult,
} from "@/cli/bundler/workflow/workflow-bundler";
import { loadConfig } from "@/cli/config-loader";
import { generateUserTypes } from "@/cli/type-generator";
import { commonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { KyselyGeneratorID } from "../generator/builtin/kysely-type";
import { assertValidMigrationFiles } from "../tailordb/migrate/snapshot";
import { getNamespacesWithMigrations, type PendingMigration } from "../tailordb/migrate/types";
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
import {
  detectPendingMigrations,
  executeMigrations,
  getMigrationMachineUser,
  getMigrationTimeout,
} from "./services/migration";
import { applyPipeline, planPipeline } from "./services/resolver";
import { applyStaticWebsite, planStaticWebsite } from "./services/staticwebsite";
import {
  applyTailorDB,
  planTailorDB,
  checkMigrationDiffs,
  formatMigrationCheckResults,
} from "./services/tailordb";
import { applyWorkflow, planWorkflow } from "./services/workflow";
import type { Application } from "@/cli/application";
import type { FileLoadConfig } from "@/cli/application/file-loader";
import type { OperatorClient } from "@/cli/client";
import type { AppConfig } from "@/configure/config";
import type { TailorDBServiceConfig } from "@/configure/services/tailordb/types";
import type { Generator } from "@/parser/generator-config";

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
}

export type ApplyPhase =
  | "create-update"
  | "pre-migration"
  | "post-migration"
  | "delete"
  | "delete-resources"
  | "delete-services";

/**
 * Apply the configured application to the Tailor platform.
 * @param {ApplyOptions} [options] - Options for apply execution
 * @returns {Promise<void>} Promise that resolves when apply completes
 */
export async function apply(options?: ApplyOptions) {
  // Load and validate options
  const { config, generators, configPath } = await loadConfig(options?.configPath);
  const dryRun = options?.dryRun ?? false;
  const yes = options?.yes ?? false;
  const buildOnly = options?.buildOnly ?? process.env.TAILOR_PLATFORM_SDK_BUILD_ONLY === "true";

  // Generate user types from loaded config
  await generateUserTypes(config, configPath);
  const application = defineApplication(config);

  // Load files first (before building)
  // Load workflows first and collect jobs for bundling
  let workflowResult: WorkflowLoadResult | undefined;
  if (application.workflowConfig) {
    workflowResult = await loadAndCollectJobs(application.workflowConfig);
  }

  // Build trigger context for workflow/job trigger transformation
  const triggerContext = await buildTriggerContext(application.workflowConfig);

  // Build functions (using already loaded data)
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

  // Check migration diffs and detect pending migrations
  const noSchemaCheck = options?.noSchemaCheck ?? false;
  const configDir = path.dirname(configPath);
  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);
  let pendingMigrations: PendingMigration[] = [];

  if (namespacesWithMigrations.length > 0) {
    // Validate migration file integrity (sequential numbers, no gaps, no duplicates)
    for (const { namespace, migrationsDir } of namespacesWithMigrations) {
      assertValidMigrationFiles(migrationsDir, namespace);
    }

    // Check for schema diffs if not skipped
    if (!noSchemaCheck) {
      const migrationResults = await checkMigrationDiffs(
        application.tailorDBServices,
        namespacesWithMigrations,
      );
      const hasDiffs = migrationResults.some((r) => r.hasDiff);

      if (hasDiffs) {
        logger.error("Schema changes detected that are not in migration files:");
        logger.log(formatMigrationCheckResults(migrationResults));
        logger.newline();
        logger.info("Run 'tailor-sdk tailordb migrate generate' to create migration files.");
        logger.info("Or use '--no-schema-check' to skip this check.");
        throw new Error("Schema migration check failed");
      }
    }

    // Detect pending migrations (migration scripts that haven't been executed yet)
    pendingMigrations = await detectPendingMigrations(
      client,
      workspaceId,
      namespacesWithMigrations,
    );

    if (pendingMigrations.length > 0) {
      logger.info(`Found ${pendingMigrations.length} pending migration(s) to execute.`);
    }
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
  logger.newline();

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
  if (pendingMigrations.length > 0) {
    // 2-stage TailorDB update for migrations with breaking changes
    // Phase 2a: Pre-migration - create/update types with breaking fields as optional
    await applyTailorDB(client, tailorDB, "pre-migration", pendingMigrations);
    await applyStaticWebsite(client, staticWebsite, "create-update");
    await applyIdP(client, idp, "create-update");
    await applyAuth(client, auth, "create-update");
    await applyPipeline(client, pipeline, "create-update");

    // Phase 2b: Execute pending migration scripts
    // Only execute migrations that require migration scripts
    const migrationsRequiringScripts = pendingMigrations.filter(
      (m) => m.diff.requiresMigrationScript,
    );
    if (migrationsRequiringScripts.length > 0) {
      await executePendingMigrations(
        client,
        workspaceId,
        application,
        config,
        generators,
        migrationsRequiringScripts,
      );
    }

    // Phase 2c: Post-migration - apply final types (required: true) and deletions
    await applyTailorDB(client, tailorDB, "post-migration", pendingMigrations);
  } else {
    // Normal flow without migrations
    await applyTailorDB(client, tailorDB, "create-update");
    await applyStaticWebsite(client, staticWebsite, "create-update");
    await applyIdP(client, idp, "create-update");
    await applyAuth(client, auth, "create-update");
    await applyPipeline(client, pipeline, "create-update");

    // Phase 3: Delete subgraph resources (types, resolvers, etc.) before Application update
    // This avoids GraphQL SDL composition errors when resources conflict with system-generated ones
    // NOTE: Services are NOT deleted here - they will be deleted after Application is deleted
    await applyTailorDB(client, tailorDB, "delete-resources");
  }

  // Delete resources for other subgraph services
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

/**
 * Execute pending migration scripts
 * @param {OperatorClient} client - Operator client
 * @param {string} workspaceId - Workspace ID
 * @param {Readonly<Application>} application - Application instance
 * @param {AppConfig} config - Application config
 * @param {Generator[]} generators - Generators configuration
 * @param {PendingMigration[]} pendingMigrations - Pending migrations to execute
 * @returns {Promise<void>} Promise that resolves when migrations complete
 */
async function executePendingMigrations(
  client: OperatorClient,
  workspaceId: string,
  application: Readonly<Application>,
  config: AppConfig,
  generators: Generator[],
  pendingMigrations: PendingMigration[],
): Promise<void> {
  // Get the auth namespace from the application
  const authService = application.authService;
  if (!authService) {
    throw new Error("Auth configuration is required to execute migration scripts.");
  }
  const authNamespace = authService.config.name;

  // Get machine users from auth config
  const machineUsers = authService.config.machineUsers
    ? Object.keys(authService.config.machineUsers)
    : undefined;

  // Find the first namespace with pending migrations to get config
  const firstMigration = pendingMigrations[0];
  const dbConfig = config.db?.[firstMigration.namespace] as TailorDBServiceConfig | undefined;
  const migrationConfig = dbConfig?.migration;

  // Get machine user for migration execution
  const machineUserName = getMigrationMachineUser(migrationConfig, machineUsers);
  if (!machineUserName) {
    throw new Error(
      "No machine user available for migration execution. " +
        "Either configure 'migration.machineUser' in db config or define machine users in auth config.",
    );
  }

  // Get timeout
  const timeout = getMigrationTimeout(migrationConfig);

  // Get generated TailorDB path from kysely generator
  const kyselyGenerator = generators.find(
    (g) => g.id === KyselyGeneratorID || (g as { id?: string }).id === KyselyGeneratorID,
  );
  if (!kyselyGenerator) {
    throw new Error(
      "Kysely generator (@tailor-platform/kysely-type) is required for migration execution. " +
        "Add it to your generators configuration.",
    );
  }
  const generatedTailorDBPath = (kyselyGenerator as { options?: { distPath?: string } }).options
    ?.distPath;
  if (!generatedTailorDBPath) {
    throw new Error("Kysely generator distPath is not configured.");
  }

  // Execute migrations
  await executeMigrations(
    {
      client,
      workspaceId,
      authNamespace,
      machineUserName,
      generatedTailorDBPath,
      timeout,
    },
    pendingMigrations,
  );
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
    "dry-run": {
      type: "boolean",
      description: "Run the command without making any changes",
      alias: "d",
    },
    yes: {
      type: "boolean",
      description: "Skip all confirmation prompts",
      alias: "y",
    },
    "no-schema-check": {
      type: "boolean",
      description: "Skip schema diff check against migration snapshots",
    },
  },
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
