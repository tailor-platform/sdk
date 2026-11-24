import { z } from "zod";
import { applyAIGateway, planAIGateway } from "#/cli/commands/deploy/aigateway";
import { findAppIdLock, resolveLockedAppIds } from "#/cli/commands/deploy/app-id-lock";
import { applyApplication, planApplication } from "#/cli/commands/deploy/application";
import { applyAuth, planAuth } from "#/cli/commands/deploy/auth";
import { warnMissingAppId } from "#/cli/commands/deploy/config-id-injector";
import { deployApplicationOf } from "#/cli/commands/deploy/deploy-application";
import { applyExecutor, planExecutor } from "#/cli/commands/deploy/executor";
import {
  applyFunctionRegistry,
  planFunctionRegistry,
} from "#/cli/commands/deploy/function-registry";
import { applyIdP, planIdP } from "#/cli/commands/deploy/idp";
import { applicationOwner } from "#/cli/commands/deploy/label";
import { MANAGED_RESOURCES } from "#/cli/commands/deploy/managed-resources";
import { applyPipeline, planPipeline } from "#/cli/commands/deploy/resolver";
import { assertResourcesNotInUse } from "#/cli/commands/deploy/resources-in-use";
import { applySecretManager, planSecretManager } from "#/cli/commands/deploy/secret-manager";
import {
  applyStaticWebsite,
  assertStaticWebsiteDeletesNotOffered,
  planStaticWebsite,
} from "#/cli/commands/deploy/staticwebsite";
import { applyTailorDB, planTailorDB } from "#/cli/commands/deploy/tailordb/index";
import { applyWorkflow, planWorkflow } from "#/cli/commands/deploy/workflow";
import {
  applyWorkflowJobFunctionExecutionPolicy,
  planWorkflowJobFunctionExecutionPolicy,
} from "#/cli/commands/deploy/workflow-execution-policy";
import { type Application, defineApplication } from "#/cli/services/application";
import { confirmationArgs, deploymentArgs } from "#/cli/shared/args";
import { type OperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig, type LoadedConfig } from "#/cli/shared/config-loader";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { printMutationResult } from "#/cli/shared/mutation-result";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import ml from "#/utils/multiline";
import type { PlanResults } from "#/cli/commands/deploy/apply-phases";
import type { ManagedResourceType } from "#/cli/commands/deploy/managed-resource-type";
import type { PlanContext } from "#/cli/commands/deploy/types";

export interface RemoveOptions {
  workspaceId?: string | undefined;
  profile?: string | undefined;
  configPath?: string | undefined;
}

// remove never writes: a config whose id is not recorded yet is removed by
// name, with the same warning deploy prints.
async function resolveRemoveConfigId(config: LoadedConfig): Promise<LoadedConfig> {
  const lock = findAppIdLock(config.path);
  if (lock === null) {
    warnMissingAppId(config.id);
    return config;
  }
  const plan = await resolveLockedAppIds({
    lock,
    mode: "read",
    entries: [{ configPath: config.path, configId: config.id }],
  });
  return { ...config, id: plan.entries[0]?.id };
}

async function loadOptions(options?: RemoveOptions) {
  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options?.profile,
    workspaceId: options?.workspaceId,
  });
  const { config: loadedConfig } = await loadConfig(options?.configPath);
  const config = await resolveRemoveConfigId(loadedConfig);
  const application = defineApplication({ config });
  return {
    client,
    workspaceId,
    application,
    config,
  };
}

// Planned deletions in the same order as apply dry-run. Removal never plans custom domains.
const REMOVAL_LISTING_ORDER: ReadonlyArray<ManagedResourceType> = [
  "function_registry",
  "staticwebsite",
  "aigateway",
  "application",
  "tailordb.service",
  "tailordb.type",
  "tailordb.gql_permission",
  "pipeline.service",
  "pipeline.resolver",
  "executor",
  "workflow",
  "workflow_job_function",
  "workflow_job_function_execution_policy",
  "idp.service",
  "idp.client",
  "auth.service",
  "auth.idp_config",
  "auth.user_profile_config",
  "auth.tenant_config",
  "auth.machine_user",
  "auth.oauth2_client",
  "auth.hook",
  "auth.scim",
  "auth.scim_resource",
  "auth.connection",
  "secret.vault",
  "secret.secret",
];

async function execRemove(
  client: OperatorClient,
  workspaceId: string,
  application: Application,
  config: LoadedConfig,
  confirm?: () => Promise<void>,
) {
  // Plan all resources with forRemoval=true
  const owner = applicationOwner(application);
  const ctx: PlanContext = {
    client,
    workspaceId,
    application,
    applications: [deployApplicationOf(application)],
    owner,
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
    workflow: await planWorkflow(client, workspaceId, owner, {}, {}),
    workflowExecutionPolicy: await planWorkflowJobFunctionExecutionPolicy(
      client,
      workspaceId,
      owner,
      {},
    ),
    functionRegistry: await planFunctionRegistry(client, workspaceId, owner, []),
    secretManager: await planSecretManager(ctx),
  } satisfies PlanResults;

  // No cross-deployment pass runs here, and nothing drops these deletes, so the
  // planned deletions are already final.
  assertStaticWebsiteDeletesNotOffered(plans.staticWebsite);
  await assertResourcesNotInUse({
    deployments: [{ application, applications: ctx.applications, ...plans }],
    command: "remove",
    client,
    workspaceId,
  });

  // Resources carrying this application's sdk-name whose sdk-app-id the config
  // does not match, because it holds a different id or none. They are skipped,
  // so removal is not complete.
  const leftBehind = Object.values(plans).some(
    (plan) => "resourceOwners" in plan && plan.resourceOwners.has(application.name),
  );

  const deletions = REMOVAL_LISTING_ORDER.map((resourceType) =>
    MANAGED_RESOURCES[resourceType].changeSetOf(plans),
  );
  const removeLines = deletions.flatMap((changeSet) => changeSet.lines());
  if (removeLines.length > 0) logger.log(removeLines.join("\n"));

  if (deletions.every((changeSet) => changeSet.deletes.length === 0)) {
    return { removed: false, leftBehind };
  }

  // Confirm deletion
  if (confirm) {
    await confirm();
  }

  // Apply deletions in reverse order of dependencies
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
  await applyFunctionRegistry(client, plans.functionRegistry, "delete");
  await applySecretManager(client, plans.secretManager, "delete");

  return { removed: true, leftBehind };
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

    const removal = await execRemove(client, workspaceId, application, config, async () => {
      if (!args.yes) {
        const confirmed = await prompt.confirm({
          message: "Are you sure you want to remove all resources?",
          default: false,
        });
        if (!confirmed) {
          throw CLIError({
            code: "REMOVE_CANCELLED",
            message: ml`
        Remove cancelled. No resources were deleted.
        To override, run again and confirm, or use --yes flag.
      `,
          });
        }
      } else {
        logger.success("Removing all resources (--yes flag specified)...");
      }
    });

    printMutationResult({
      changed: removal.removed,
      workspaceId,
      application: application.name,
      complete: !removal.leftBehind,
    });
    if (removal.leftBehind) {
      logger.warn(ml`
        Resources tagged with "${application.name}" were left in place: they carry an application id this config does not match.
        Record that id for this config (in .github/tailor.lock, or the config's 'id'), or run deploy to take them over first, then remove again.
      `);
      return;
    }
    logger.success(`Successfully removed all resources managed by "${application.name}".`);
  },
});
