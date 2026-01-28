import { defineCommand, arg } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { fetchLatestToken, readPlatformConfig, writePlatformConfig } from "../context";
import { logger } from "../utils/logger";
import type { ProfileInfo } from ".";

export const createCommand = defineCommand({
  name: "create",
  description: "Create new profile",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    name: arg(z.string(), { positional: true, description: "Profile name" }),
    user: arg(z.string(), { alias: "u", description: "User email" }),
    "workspace-id": arg(z.string(), { alias: "w", description: "Workspace ID" }),
  }),
  run: withCommonArgs(async (args) => {
    const config = readPlatformConfig();

    // Check if profile already exists
    if (config.profiles[args.name]) {
      throw new Error(`Profile "${args.name}" already exists.`);
    }

    // Check if user exists
    const token = await fetchLatestToken(config, args.user);

    // Check if workspace exists
    const client = await initOperatorClient(token);
    const workspaces = await fetchAll(async (pageToken) => {
      const { workspaces, nextPageToken } = await client.listWorkspaces({
        pageToken,
      });
      return [workspaces, nextPageToken];
    });

    const workspace = workspaces.find((ws) => ws.id === args["workspace-id"]);
    if (!workspace) {
      throw new Error(`Workspace "${args["workspace-id"]}" not found.`);
    }

    // Create new profile
    config.profiles[args.name] = {
      user: args.user,
      workspace_id: args["workspace-id"],
    };
    writePlatformConfig(config);

    if (!args.json) {
      logger.success(`Profile "${args.name}" created successfully.`);
    }

    // Show profile info
    const profileInfo: ProfileInfo = {
      name: args.name,
      user: args.user,
      workspaceId: args["workspace-id"],
    };
    logger.out(profileInfo);
  }),
});
