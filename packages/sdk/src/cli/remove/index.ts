import { styleText } from "node:util";
import chalk from "chalk";
import { defineCommand } from "citty";
import { consola } from "consola";
import { loadConfig } from "@/cli/config-loader";
import { commonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadConfigPath, loadWorkspaceId } from "../context";
import {
  collectResourcesToRemove,
  type ResourceToRemove,
} from "./services/collector";
import { removeResources } from "./services/remover";

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

  console.log(
    `\nSearching for resources managed by application ${chalk.bold(`"${appName}"`)}...\n`,
  );

  // Collect all resources to remove
  const resources = await collectResourcesToRemove(
    client,
    workspaceId,
    appName,
  );

  if (resources.length === 0) {
    consola.info("No resources found to remove.");
    return;
  }

  // Display resources to be removed
  printResourcesToRemove(resources);

  // Confirm deletion
  if (!yes) {
    const confirmed = await consola.prompt(
      chalk.yellow(
        `\nAre you sure you want to remove all ${resources.length} resources?`,
      ),
      { type: "confirm", initial: false },
    );
    if (!confirmed) {
      consola.info("Remove cancelled.");
      return;
    }
  } else {
    consola.success("Removing resources (--yes flag specified)...");
  }

  // Remove resources
  await removeResources(client, workspaceId, resources);

  console.log(
    `\n${styleText("green", "✓")} Successfully removed all resources managed by "${appName}".`,
  );
}

function printResourcesToRemove(resources: ResourceToRemove[]) {
  console.log(styleText("bold", "Resources to be removed:"));

  // Group by type for better display
  const grouped = new Map<string, string[]>();
  for (const resource of resources) {
    const list = grouped.get(resource.type) ?? [];
    list.push(resource.name);
    grouped.set(resource.type, list);
  }

  for (const [type, names] of grouped) {
    console.log(`\n  ${styleText("cyan", type)}:`);
    for (const name of names) {
      console.log(styleText("red", `    - ${name}`));
    }
  }
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
