import { z } from "zod";
import { applyAIGateway, planAIGateway } from "#src/cli/commands/deploy/aigateway";
import { applyApplication, planApplication } from "#src/cli/commands/deploy/application";
import { applyAuth, planAuth } from "#src/cli/commands/deploy/auth";
import { applyExecutor, planExecutor } from "#src/cli/commands/deploy/executor";
import {
  applyFunctionRegistry,
  planFunctionRegistry,
} from "#src/cli/commands/deploy/function-registry";
import { applyIdP, planIdP } from "#src/cli/commands/deploy/idp";
import { applyPipeline, planPipeline } from "#src/cli/commands/deploy/resolver";
import { applySecretManager, planSecretManager } from "#src/cli/commands/deploy/secret-manager";
import { applyStaticWebsite, planStaticWebsite } from "#src/cli/commands/deploy/staticwebsite";
import { applyTailorDB, planTailorDB } from "#src/cli/commands/deploy/tailordb/index";
import { applyWorkflow, planWorkflow } from "#src/cli/commands/deploy/workflow";
import { type Application, defineApplication } from "#src/cli/services/application";
import { confirmationArgs, deploymentArgs } from "#src/cli/shared/args";
import { initOperatorClient, type OperatorClient } from "#src/cli/shared/client";
import { defineAppCommand } from "#src/cli/shared/command";
import { loadConfig, type LoadedConfig } from "#src/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";
import { prompt } from "#src/cli/shared/prompt";
import { assertWritable } from "#src/cli/shared/readonly-guard";
import ml from "#src/utils/multiline";
import type { PlanContext } from "#src/cli/commands/deploy/types";

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
) {
  // Plan all resources with forRemoval=true
  const ctx: PlanContext = {
    client,
    workspaceId,
    application,
    forRemoval: true,
    config,
  };
  const tailorDB = await planTailorDB(ctx);
  const staticWebsite = await planStaticWebsite(ctx);
  const aiGateway = await planAIGateway(ctx);
  const idp = await planIdP(ctx);
  const auth = await planAuth(ctx);
  const pipeline = await planPipeline(ctx);
  const app = await planApplication(ctx);
  const executor = await planExecutor(ctx);
  const workflow = await planWorkflow(
    client,
    workspaceId,
    application.name,
    application.id,
    {},
    {},
  );
  const functionRegistry = await planFunctionRegistry(
    client,
    workspaceId,
    application.name,
    application.id,
    [],
  );
  const secretManager = await planSecretManager(ctx);

  // Print planned deletions (same order as apply dry-run)
  functionRegistry.changeSet.print();
  staticWebsite.changeSet.print();
  aiGateway.changeSet.print();
  app.print();
  tailorDB.changeSet.service.print();
  tailorDB.changeSet.type.print();
  tailorDB.changeSet.gqlPermission.print();
  pipeline.changeSet.service.print();
  pipeline.changeSet.resolver.print();
  executor.changeSet.print();
  workflow.changeSet.print();
  idp.changeSet.service.print();
  idp.changeSet.client.print();
  auth.changeSet.service.print();
  auth.changeSet.idpConfig.print();
  auth.changeSet.userProfileConfig.print();
  auth.changeSet.tenantConfig.print();
  auth.changeSet.machineUser.print();
  auth.changeSet.oauth2Client.print();
  auth.changeSet.authHook.print();
  auth.changeSet.scim.print();
  auth.changeSet.scimResource.print();
  auth.changeSet.connection.print();
  secretManager.vaultChangeSet.print();
  secretManager.secretChangeSet.print();

  if (
    tailorDB.changeSet.service.deletes.length === 0 &&
    staticWebsite.changeSet.deletes.length === 0 &&
    aiGateway.changeSet.deletes.length === 0 &&
    idp.changeSet.service.deletes.length === 0 &&
    auth.changeSet.service.deletes.length === 0 &&
    pipeline.changeSet.service.deletes.length === 0 &&
    app.deletes.length === 0 &&
    executor.changeSet.deletes.length === 0 &&
    workflow.changeSet.deletes.length === 0 &&
    functionRegistry.changeSet.deletes.length === 0 &&
    secretManager.vaultChangeSet.deletes.length === 0 &&
    secretManager.secretChangeSet.deletes.length === 0
  ) {
    return;
  }

  // Confirm deletion
  if (confirm) {
    await confirm();
  }

  // Apply deletions in reverse order of dependencies
  await applyWorkflow(client, workflow, "delete");
  await applyExecutor(client, executor, "delete");
  await applyStaticWebsite(client, staticWebsite, "delete");
  await applyAIGateway(client, aiGateway, "delete");
  await applyApplication(client, app, "delete");
  await applyPipeline(client, pipeline, "delete-resources");
  await applyPipeline(client, pipeline, "delete-services");
  await applyAuth(client, auth, "delete-resources");
  await applyAuth(client, auth, "delete-services");
  await applyIdP(client, idp, "delete-resources");
  await applyIdP(client, idp, "delete-services");
  await applyTailorDB(client, tailorDB, "delete-resources");
  await applyTailorDB(client, tailorDB, "delete-services");
  await applyFunctionRegistry(client, workspaceId, functionRegistry, "delete");
  await applySecretManager(client, secretManager, "delete");
}

/**
 * Remove all resources managed by the current application.
 * @param options - Remove options
 * @returns Promise that resolves when removal completes
 */
export async function remove(options?: RemoveOptions): Promise<void> {
  const { client, workspaceId, application, config } = await loadOptions(options);
  await execRemove(client, workspaceId, application, config);
}

export const removeCommand = defineAppCommand({
  name: "remove",
  description: "Remove all resources managed by the application from the workspace.",
  args: z
    .object({
      ...deploymentArgs,
      ...confirmationArgs,
    })
    .strict(),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const { client, workspaceId, application, config } = await loadOptions({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });

    logger.info(`Planning removal of resources managed by "${application.name}"...`);
    logger.newline();

    await execRemove(client, workspaceId, application, config, async () => {
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
    });

    logger.success(`Successfully removed all resources managed by "${application.name}".`);
  },
});
