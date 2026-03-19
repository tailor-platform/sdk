import * as fs from "node:fs";
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
import { applyAuth, planAuth } from "./auth";
import {
  confirmImportantResourceDeletion,
  confirmOwnerConflict,
  confirmUnmanagedResources,
  type ImportantResourceDeletion,
  type OwnerConflict,
  type UnmanagedResource,
} from "./confirm";
import { applyExecutor, planExecutor } from "./executor";
import {
  applyFunctionRegistry,
  collectFunctionEntries,
  planFunctionRegistry,
} from "./function-registry";
import { applyIdP, planIdP } from "./idp";
import { applyPipeline, planPipeline } from "./resolver";
import { applySecretManager, planSecretManager } from "./secret-manager";
import { applyStaticWebsite, planStaticWebsite } from "./staticwebsite";
import { applyTailorDB, planTailorDB } from "./tailordb";
import { applyWorkflow, planWorkflow } from "./workflow";
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
}

export type ApplyPhase = "create-update" | "delete" | "delete-resources" | "delete-services";

/**
 * Apply the configured application to the Tailor platform.
 * @param options - Options for apply execution
 * @returns Promise that resolves when apply completes
 */
export async function apply(options?: ApplyOptions) {
  return withSpan("apply", async (rootSpan) => {
    rootSpan.setAttribute("apply.dry_run", options?.dryRun ?? false);

    // Phase 0: Build
    const { config, application, workflowBuildResult, buildOnly } = await withSpan(
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
        try {
          const result = await withSpan("build.loadApplication", () =>
            loadApplication({ config, pluginManager, bundleCache: cacheManager.bundleCache }),
          );
          application = result.application;
          workflowBuildResult = result.workflowBuildResult;
        } finally {
          // Persist even on partial failure: successfully built bundles
          // are cached so the next run only rebuilds what failed.
          cacheManager.finalize();
        }

        return { config, plugins, application, workflowBuildResult, dryRun, buildOnly };
      },
    );
    if (buildOnly) return;

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

    // Collect function entries from bundled scripts (after build, before plan)
    const workflowService = application.workflowService;
    const functionEntries = collectFunctionEntries(application, workflowService?.jobs ?? []);

    const dryRun = options?.dryRun ?? false;
    const yes = options?.yes ?? false;

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
      };
      const [
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
      ] = await Promise.all([
        withSpan("plan.functionRegistry", () =>
          planFunctionRegistry(client, workspaceId, application.name, functionEntries),
        ),
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
