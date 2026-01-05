import { timestampDate } from "@bufbuild/protobuf/wkt";
import { defineCommand } from "citty";
import { commonArgs, deploymentArgs, jsonArgs, withCommonArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadConfig } from "../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";
import type { MachineUser } from "@tailor-proto/tailor/v1/auth_resource_pb";

export interface ListMachineUsersOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
}

export interface MachineUserInfo {
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
    createdAt: user.createdAt ? timestampDate(user.createdAt).toISOString() : "N/A",
    updatedAt: user.updatedAt ? timestampDate(user.updatedAt).toISOString() : "N/A",
  };
}

export async function listMachineUsers(
  options?: ListMachineUsersOptions,
): Promise<MachineUserInfo[]> {
  // Load and validate options
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  // Get application
  const { config } = await loadConfig(options?.configPath);
  const { application } = await client.getApplication({
    workspaceId,
    applicationName: config.name,
  });
  if (!application?.authNamespace) {
    throw new Error(`Application ${config.name} does not have an auth configuration.`);
  }

  // Fetch all machine users
  const machineUsers = await fetchAll(async (pageToken) => {
    const { machineUsers, nextPageToken } = await client.listAuthMachineUsers({
      workspaceId,
      pageToken,
      authNamespace: application.authNamespace,
    });
    return [machineUsers, nextPageToken];
  });

  return machineUsers.map(machineUserInfo);
}

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all machine users",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    ...deploymentArgs,
  },
  run: withCommonArgs(async (args) => {
    // Execute machineuser list logic
    const machineUsers = await listMachineUsers({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });

    // Show machine users info
    logger.out(machineUsers);
  }),
});
