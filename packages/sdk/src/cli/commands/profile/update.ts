import { arg } from "politty";
import { z } from "zod";
import { fetchAll, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { fetchLatestToken, readPlatformConfig, writePlatformConfig } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import type { ProfileInfo } from ".";

export const updateCommand = defineAppCommand({
  name: "update",
  description: "Update profile properties.",
  args: z
    .object({
      name: arg(z.string(), {
        positional: true,
        description: "Profile name",
      }),
      user: arg(z.string().optional(), {
        alias: "u",
        description: "New user email",
      }),
      "workspace-id": arg(z.string().optional(), {
        alias: "w",
        description: "New workspace ID",
      }),
    })
    .strict(),
  run: async (args) => {
    const config = await readPlatformConfig();

    // Check if profile exists
    if (!config.profiles[args.name]) {
      throw new Error(`Profile "${args.name}" not found.`);
    }

    // Check if at least one property is provided
    if (!args.user && !args["workspace-id"]) {
      throw new Error("Please provide at least one property to update.");
    }

    const profile = config.profiles[args.name]!;
    const oldUser = profile.user;
    const newUser = args.user || oldUser;
    const oldWorkspaceId = profile.workspace_id;
    const newWorkspaceId = args["workspace-id"] || oldWorkspaceId;

    // Check if user exists
    const token = await fetchLatestToken(config, newUser);

    // Check if workspace exists
    const client = await initOperatorClient(token);
    const workspaces = await fetchAll(async (pageToken, maxPageSize) => {
      const { workspaces, nextPageToken } = await client.listWorkspaces({
        pageToken,
        pageSize: maxPageSize,
      });
      return [workspaces, nextPageToken];
    });
    const workspace = workspaces.find((ws) => ws.id === newWorkspaceId);
    if (!workspace) {
      throw new Error(`Workspace "${newWorkspaceId}" not found.`);
    }

    // Update properties
    profile.user = newUser;
    profile.workspace_id = newWorkspaceId;
    writePlatformConfig(config);
    if (!args.json) {
      logger.success(`Profile "${args.name}" updated successfully`);
    }

    // Show profile info
    const profileInfo: ProfileInfo = {
      name: args.name,
      user: newUser,
      workspaceId: newWorkspaceId,
    };
    logger.out(profileInfo);
  },
});
