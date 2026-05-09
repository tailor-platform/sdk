import { arg } from "politty";
import { z } from "zod";
import { fetchAll, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { fetchLatestToken, readPlatformConfig, writePlatformConfig } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import type { ProfileInfo } from ".";

export const createCommand = defineAppCommand({
  name: "create",
  description: "Create a new profile.",
  args: z
    .object({
      name: arg(z.string(), {
        positional: true,
        description: "Profile name",
      }),
      user: arg(z.string(), {
        alias: "u",
        description: "User email",
      }),
      "workspace-id": arg(z.string(), {
        alias: "w",
        description: "Workspace ID",
      }),
      readonly: arg(z.boolean().default(false), {
        description: "Create as a read-only profile that blocks all write commands.",
      }),
    })
    .strict(),
  run: async (args) => {
    const config = await readPlatformConfig();

    // Check if profile already exists
    if (config.profiles[args.name]) {
      throw new Error(`Profile "${args.name}" already exists.`);
    }

    // Check if user exists
    const token = await fetchLatestToken(config, args.user);

    // Check if workspace exists
    const client = await initOperatorClient(token);
    const workspaces = await fetchAll(async (pageToken, maxPageSize) => {
      const { workspaces, nextPageToken } = await client.listWorkspaces({
        pageToken,
        pageSize: maxPageSize,
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
      ...(args.readonly ? { readonly: true } : {}),
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
      readonly: args.readonly,
    };
    logger.out(profileInfo);
  },
});
