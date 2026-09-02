import { z } from "zod";
import { applyAIGateway, planAIGateway } from "#/cli/commands/deploy/aigateway";
import { applyApplication, planApplication } from "#/cli/commands/deploy/application";
import { applyAuth, planAuth } from "#/cli/commands/deploy/auth";
import { warnMissingAppId } from "#/cli/commands/deploy/config-id-injector";
import { withDeployLock } from "#/cli/commands/deploy/deploy-lock";
import { fenceClient } from "#/cli/commands/deploy/deploy-lock-fence";
import { applyExecutor, planExecutor } from "#/cli/commands/deploy/executor";
import {
  applyFunctionRegistry,
  planFunctionRegistry,
} from "#/cli/commands/deploy/function-registry";
import { applyIdP, planIdP } from "#/cli/commands/deploy/idp";
import { applyPipeline, planPipeline } from "#/cli/commands/deploy/resolver";
import { applySecretManager, planSecretManager } from "#/cli/commands/deploy/secret-manager";
import { applyStaticWebsite, planStaticWebsite } from "#/cli/commands/deploy/staticwebsite";
import { applyTailorDB, planTailorDB } from "#/cli/commands/deploy/tailordb/index";
import { applyWorkflow, planWorkflow } from "#/cli/commands/deploy/workflow";
import {
  applyWorkflowJobFunctionExecutionPolicy,
  planWorkflowJobFunctionExecutionPolicy,
} from "#/cli/commands/deploy/workflow-execution-policy";
import { type Application, defineApplication } from "#/cli/services/application";
import { confirmationArgs, deploymentArgs } from "#/cli/shared/args";
import { initOperatorClient, type OperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig, type LoadedConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import ml from "#/utils/multiline";
import type { PlannedDeployment } from "#/cli/commands/deploy/apply-phases";
import type { PlanContext } from "#/cli/commands/deploy/types";

export interface RemoveOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
}

async function loadOptions(options?: RemoveOptions) {
  const accessToken = await loadAccessToken({
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });
  const { config } = await loadConfig(options?.configPath);
  const application = defineApplication({ config });
  warnMissingAppId(application.id);
  return {
    client,
    workspaceId,
    application,
    config,
  };
}

async function execRemove(
  client: OperatorClient,
  workspaceId: string,
  application: Application,
  config: LoadedConfig,
  confirm?: () => Promise<void>,
  assertLockHeld: () => void = () => {},
) {
  // Plan all resources with forRemoval=true
  const ctx: PlanContext = {
    client,
    workspaceId,
    application,
    forRemoval: true,
    config,
  };
  // Keyed like `PlannedDeployment` (deploy/apply-phases.ts): adding a resource
  // type there without also adding it here fails to compile.
  const plans = {
    tailorDB: await planTailorDB(ctx),
    staticWebsite: await planStaticWebsite(ctx),
    aiGateway: await planAIGateway(ctx),
    idp: await planIdP(ctx),
    auth: await planAuth(ctx),
    pipeline: await planPipeline(ctx),
    app: await planApplication(ctx),
    executor: await planExecutor(ctx),
    workflow: await planWorkflow(client, workspaceId, application.name, application.id, {}, {}),
    workflowExecutionPolicy: await planWorkflowJobFunctionExecutionPolicy(
      client,
      workspaceId,
      application.name,
      application.id,
      {},
    ),
    functionRegistry: await planFunctionRegistry(
      client,
      workspaceId,
      application.name,
      application.id,
      [],
    ),
    secretManager: await planSecretManager(ctx),
  } satisfies Omit<PlannedDeployment, "application">;

  // Resources carrying this application's sdk-name whose sdk-app-id the config
  // does not match, because it holds a different id or none. They are skipped,
  // so removal is not complete.
  const leftBehind = Object.values(plans).some(
    (plan) => "resourceOwners" in plan && plan.resourceOwners.has(application.name),
  );

  // Print planned deletions (same order as apply dry-run)
  const removeLines = [
    ...plans.functionRegistry.changeSet.lines(),
    ...plans.staticWebsite.changeSet.lines(),
    ...plans.aiGateway.changeSet.lines(),
    ...plans.app.lines(),
    ...plans.tailorDB.changeSet.service.lines(),
    ...plans.tailorDB.changeSet.type.lines(),
    ...plans.tailorDB.changeSet.gqlPermission.lines(),
    ...plans.pipeline.changeSet.service.lines(),
    ...plans.pipeline.changeSet.resolver.lines(),
    ...plans.executor.changeSet.lines(),
    ...plans.workflow.changeSet.lines(),
    ...plans.workflowExecutionPolicy.changeSet.lines(),
    ...plans.idp.changeSet.service.lines(),
    ...plans.idp.changeSet.client.lines(),
    ...plans.auth.changeSet.service.lines(),
    ...plans.auth.changeSet.idpConfig.lines(),
    ...plans.auth.changeSet.userProfileConfig.lines(),
    ...plans.auth.changeSet.tenantConfig.lines(),
    ...plans.auth.changeSet.machineUser.lines(),
    ...plans.auth.changeSet.oauth2Client.lines(),
    ...plans.auth.changeSet.authHook.lines(),
    ...plans.auth.changeSet.scim.lines(),
    ...plans.auth.changeSet.scimResource.lines(),
    ...plans.auth.changeSet.connection.lines(),
    ...plans.secretManager.vaultChangeSet.lines(),
    ...plans.secretManager.secretChangeSet.lines(),
  ];
  if (removeLines.length > 0) logger.log(removeLines.join("\n"));

  if (
    plans.tailorDB.changeSet.service.deletes.length === 0 &&
    plans.staticWebsite.changeSet.deletes.length === 0 &&
    plans.aiGateway.changeSet.deletes.length === 0 &&
    plans.idp.changeSet.service.deletes.length === 0 &&
    plans.auth.changeSet.service.deletes.length === 0 &&
    plans.pipeline.changeSet.service.deletes.length === 0 &&
    plans.app.deletes.length === 0 &&
    plans.executor.changeSet.deletes.length === 0 &&
    plans.workflow.changeSet.deletes.length === 0 &&
    plans.workflowExecutionPolicy.changeSet.deletes.length === 0 &&
    plans.functionRegistry.changeSet.deletes.length === 0 &&
    plans.secretManager.vaultChangeSet.deletes.length === 0 &&
    plans.secretManager.secretChangeSet.deletes.length === 0
  ) {
    return { leftBehind };
  }

  // Confirm deletion
  if (confirm) {
    await confirm();
  }

  // Apply deletions in reverse order of dependencies
  assertLockHeld();
  await applyWorkflow(client, plans.workflow, "delete");
  await applyWorkflowJobFunctionExecutionPolicy(client, plans.workflowExecutionPolicy, "delete");
  await applyExecutor(client, plans.executor, "delete");
  await applyStaticWebsite(client, plans.staticWebsite, "delete");
  await applyAIGateway(client, plans.aiGateway, "delete");
  await applyApplication(client, plans.app, "delete");
  await applyPipeline(client, plans.pipeline, "delete-resources");
  await applyPipeline(client, plans.pipeline, "delete-services");
  await applyAuth(client, plans.auth, "delete-resources");
  await applyAuth(client, plans.auth, "delete-services");
  await applyIdP(client, plans.idp, "delete-resources");
  await applyIdP(client, plans.idp, "delete-services");
  await applyTailorDB(client, plans.tailorDB, "delete-resources");
  await applyTailorDB(client, plans.tailorDB, "delete-services");
  await applyFunctionRegistry(client, workspaceId, plans.functionRegistry, "delete");
  await applySecretManager(client, plans.secretManager, "delete");

  return { leftBehind };
}

/**
 * Remove all resources managed by the current application.
 * @param options - Remove options
 * @returns Promise that resolves when removal completes
 */
export async function remove(options?: RemoveOptions): Promise<void> {
  const { client, workspaceId, application, config } = await loadOptions(options);
  await withDeployLock({ client, workspaceId, applications: [application] }, (lock) =>
    execRemove(fenceClient(client, lock), workspaceId, application, config, undefined, () =>
      lock.assertHeld(),
    ),
  );
}

export const removeCommand = defineAppCommand({
  name: "remove",
  description: "Remove all resources managed by the application from the workspace.",
  args: z.strictObject({
    ...deploymentArgs,
    ...confirmationArgs,
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const { client, workspaceId, application, config } = await loadOptions({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });

    logger.info(`Planning removal of resources managed by "${application.name}"...`);
    logger.newline();

    const { leftBehind } = await withDeployLock(
      { client, workspaceId, applications: [application] },
      (lock) =>
        execRemove(
          fenceClient(client, lock),
          workspaceId,
          application,
          config,
          async () => {
            if (!args.yes) {
              const confirmed = await prompt.confirm({
                message: "Are you sure you want to remove all resources?",
                default: false,
              });
              if (!confirmed) {
                throw new Error(ml`
        Remove cancelled. No resources were deleted.
        To override, run again and confirm, or use --yes flag.
      `);
              }
            } else {
              logger.success("Removing all resources (--yes flag specified)...");
            }
          },
          () => lock.assertHeld(),
        ),
    );

    if (leftBehind) {
      logger.warn(ml`
        Resources tagged with "${application.name}" were left in place: they carry an application id this config does not match.
        Put that id in your config, or run deploy to take them over first, then remove again.
      `);
      return;
    }
    logger.success(`Successfully removed all resources managed by "${application.name}".`);
  },
});
