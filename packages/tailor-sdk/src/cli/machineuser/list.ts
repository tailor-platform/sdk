import { timestampDate } from "@bufbuild/protobuf/wkt";
import { defineCommand } from "citty";
import {
  commonArgs,
  formatArgs,
  parseFormat,
  printWithFormat,
  withCommonArgs,
} from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadConfig } from "../config-loader";
import { loadAccessToken, loadConfigPath, loadWorkspaceId } from "../context";
import type { MachineUser } from "@tailor-proto/tailor/v1/auth_resource_pb";

interface MachineUserInfo {
  name: string;
  clientId: string;
  clientSecret: string;
  createdAt: string;
  updatedAt: string;
}

function machineUserInfo(user: MachineUser): MachineUserInfo {
  return {
    name: user.name,
    clientId: user.clientId,
    clientSecret: user.clientSecret,
    createdAt: user.createdAt
      ? timestampDate(user.createdAt).toISOString()
      : "N/A",
    updatedAt: user.updatedAt
      ? timestampDate(user.updatedAt).toISOString()
      : "N/A",
  };
}

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all machine users",
  },
  args: {
    ...commonArgs,
    ...formatArgs,
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
  },
  run: withCommonArgs(async (args) => {
    // Validate args
    const format = parseFormat(args.format);

    // Initialize client
    const workspaceId = loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);

    // List machine users
    const { config } = await loadConfig(loadConfigPath(args.config));
    const { application } = await client.getApplication({
      workspaceId,
      applicationName: config.name,
    });
    if (!application?.authNamespace) {
      throw new Error(
        `Application ${config.name} does not have an auth configuration.`,
      );
    }
    const machineUsers = await fetchAll(async (pageToken) => {
      const { machineUsers, nextPageToken } = await client.listAuthMachineUsers(
        {
          workspaceId,
          pageToken,
          authNamespace: application.authNamespace,
        },
      );
      return [machineUsers, nextPageToken];
    });

    // Show machine users info
    const machineUserInfos = machineUsers.map(machineUserInfo);
    printWithFormat(machineUserInfos, format);
  }),
});
