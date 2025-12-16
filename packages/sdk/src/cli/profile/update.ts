import { defineCommand } from "citty";
import { consola } from "consola";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import {
  fetchLatestToken,
  readPlatformConfig,
  writePlatformConfig,
} from "../context";
import { printData } from "../format";
import type { ProfileInfo } from ".";

export const updateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update profile properties",
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
      description: "New user email",
      alias: "u",
    },
    "workspace-id": {
      type: "string",
      description: "New workspace ID",
      alias: "w",
    },
  },
  run: withCommonArgs(async (args) => {
    const config = readPlatformConfig();

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
    const workspaces = await fetchAll(async (pageToken) => {
      const { workspaces, nextPageToken } = await client.listWorkspaces({
        pageToken,
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
      consola.success(`Profile "${args.name}" updated successfully`);
    }

    // Show profile info
    const profileInfo: ProfileInfo = {
      name: args.name,
      user: newUser,
      workspaceId: newWorkspaceId,
    };
    printData(profileInfo, args.json);
  }),
});
