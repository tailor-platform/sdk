import { defineCommand } from "citty";
import { consola } from "consola";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import {
  fetchLatestToken,
  readPlatformConfig,
  writePlatformConfig,
} from "../context";
import { parseFormat, printWithFormat } from "../format";
import type { ProfileInfo } from ".";

export const createCommand = defineCommand({
  meta: {
    name: "create",
    description: "Create new profile",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    name: {
      type: "positional",
      description: "Profile name",
      required: true,
    },
    user: {
      type: "string",
      description: "User email",
      required: true,
      alias: "u",
    },
    "workspace-id": {
      type: "string",
      description: "Workspace ID",
      required: true,
      alias: "w",
    },
  },
  run: withCommonArgs(async (args) => {
    // Validate args
    const format = parseFormat(args.json);

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

    if (format === "table") {
      consola.success(`Profile "${args.name}" created successfully.`);
    }

    // Show profile info
    const profileInfo: ProfileInfo = {
      name: args.name,
      user: args.user,
      workspaceId: args["workspace-id"],
    };
    printWithFormat(profileInfo, format);
  }),
});
