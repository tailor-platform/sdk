import { defineCommand } from "citty";
import { consola } from "consola";
import ml from "multiline-ts";
import { defineApplication } from "@/cli/application";
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
import { commonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadConfigPath, loadWorkspaceId } from "../context";

export interface RemoveOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
  yes?: boolean;
}

export async function remove(options?: RemoveOptions) {
  // Load and validate options
  const configPath = loadConfigPath(options?.configPath);
  const { config } = await loadConfig(configPath);
  const yes = options?.yes ?? false;
  const appName = config.name;

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

  console.log(`Planning removal of resources managed by "${appName}"...\n`);

  // Create application context
  const application = defineApplication(config);

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

  // Confirm deletion
  if (!yes) {
    const confirmed = await consola.prompt(
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
    consola.success("Removing all resources (--yes flag specified)...");
  }

  // Apply deletions in reverse order of dependencies
  await applyExecutor(client, executor, "delete");
  await applyApplication(client, app, "delete");
  await applyPipeline(client, pipeline, "delete");
  await applyAuth(client, auth, "delete");
  await applyIdP(client, idp, "delete");
  await applyStaticWebsite(client, staticWebsite, "delete");
  await applyTailorDB(client, tailorDB, "delete");

  consola.success(
    `Successfully removed all resources managed by "${appName}".`,
  );
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
      description: "ID of the workspace to remove resources from",
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
    yes: {
      type: "boolean",
      description: "Skip all confirmation prompts",
      alias: "y",
    },
  },
  run: withCommonArgs(async (args) => {
    await remove({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      yes: args.yes,
    });
  }),
});
