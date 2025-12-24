import { defineCommand } from "citty";
import ml from "multiline-ts";
import { type Application, defineApplication } from "@/cli/application";
import { type PlanContext } from "@/cli/apply";
import {
  applyApplication,
  planApplication,
} from "@/cli/apply/services/application";
import { applyAuth, planAuth } from "@/cli/apply/services/auth";
import { applyExecutor, planExecutor } from "@/cli/apply/services/executor";
import { applyIdP, planIdP } from "@/cli/apply/services/idp";
import { applyPipeline, planPipeline } from "@/cli/apply/services/resolver";
import {
  applyStaticWebsite,
  planStaticWebsite,
} from "@/cli/apply/services/staticwebsite";
import { applyTailorDB, planTailorDB } from "@/cli/apply/services/tailordb";
import { loadConfig } from "@/cli/config-loader";
import { applyWorkflow, planWorkflow } from "./apply/services/workflow";
import { commonArgs, withCommonArgs } from "./args";
import { initOperatorClient, type OperatorClient } from "./client";
import { loadAccessToken, loadWorkspaceId } from "./context";
import { logger } from "./utils/logger";

export interface RemoveOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
}

async function loadOptions(options?: RemoveOptions) {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });
  const { config } = await loadConfig(options?.configPath);
  const application = defineApplication(config);
  return {
    client,
    workspaceId,
    application,
  };
}

async function execRemove(
  client: OperatorClient,
  workspaceId: string,
  application: Application,
  confirm?: () => Promise<void>,
) {
  // Plan all resources with forRemoval=true
  const ctx: PlanContext = {
    client,
    workspaceId,
    application,
    forRemoval: true,
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
    {},
    {},
  );

  if (
    tailorDB.changeSet.service.deletes.length === 0 &&
    staticWebsite.changeSet.deletes.length === 0 &&
    idp.changeSet.service.deletes.length === 0 &&
    auth.changeSet.service.deletes.length === 0 &&
    pipeline.changeSet.service.deletes.length === 0 &&
    app.deletes.length === 0 &&
    executor.changeSet.deletes.length === 0 &&
    workflow.changeSet.deletes.length === 0
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
  await applyApplication(client, app, "delete");
  await applyPipeline(client, pipeline, "delete-resources");
  await applyPipeline(client, pipeline, "delete-services");
  await applyAuth(client, auth, "delete-resources");
  await applyAuth(client, auth, "delete-services");
  await applyIdP(client, idp, "delete-resources");
  await applyIdP(client, idp, "delete-services");
  await applyTailorDB(client, tailorDB, "delete-resources");
  await applyTailorDB(client, tailorDB, "delete-services");
}

export async function remove(options?: RemoveOptions): Promise<void> {
  const { client, workspaceId, application } = await loadOptions(options);
  await execRemove(client, workspaceId, application);
}

export const removeCommand = defineCommand({
  meta: {
    name: "remove",
    description: "Remove all resources managed by the application",
  },
  args: {
    ...commonArgs,
    "workspace-id": {
      type: "string",
      description: "Workspace ID",
      alias: "w",
    },
    profile: {
      type: "string",
      description: "Workspace profile",
      alias: "p",
    },
    config: {
      type: "string",
      description: "Path to SDK config file",
      alias: "c",
      default: "tailor.config.ts",
    },
    yes: {
      type: "boolean",
      description: "Skip confirmation prompt",
      alias: "y",
      default: false,
    },
  },
  run: withCommonArgs(async (args) => {
    const { client, workspaceId, application } = await loadOptions({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });

    logger.info(
      `Planning removal of resources managed by "${application.name}"...`,
    );
    logger.newline();

    await execRemove(client, workspaceId, application, async () => {
      if (!args.yes) {
        const confirmed = await logger.prompt(
          "Are you sure you want to remove all resources?",
          { type: "confirm", initial: false },
        );
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

    logger.success(
      `Successfully removed all resources managed by "${application.name}".`,
    );
  }),
});
