import { toJson } from "@bufbuild/protobuf";
import { timestampDate, ValueSchema } from "@bufbuild/protobuf/wkt";
import { z } from "zod";
import { deploymentArgs } from "@/cli/shared/args";
import { fetchAll, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
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
  createdAt: Date | null;
  updatedAt: Date | null;
  attributes: Record<string, unknown>;
}

/**
 * Map a MachineUser protobuf message to CLI-friendly info.
 * @param user - Machine user resource
 * @returns Flattened machine user info
 */
function machineUserInfo(user: MachineUser): MachineUserInfo {
  return {
    name: user.name,
    clientId: user.clientId,
    clientSecret: user.clientSecret,
    createdAt: user.createdAt ? timestampDate(user.createdAt) : null,
    updatedAt: user.updatedAt ? timestampDate(user.updatedAt) : null,
    attributes: Object.fromEntries(
      Object.entries(user.attributeMap).map(([key, value]) => [key, toJson(ValueSchema, value)]),
    ),
  };
}

/**
 * List machine users for the current application.
 * @param options - Machine user listing options
 * @returns List of machine users
 */
export async function listMachineUsers(
  options?: ListMachineUsersOptions,
): Promise<MachineUserInfo[]> {
  // Load and validate options
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
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
  const machineUsers = await fetchAll(async (pageToken, maxPageSize) => {
    const { machineUsers, nextPageToken } = await client.listAuthMachineUsers({
      workspaceId,
      pageToken,
      pageSize: maxPageSize,
      authNamespace: application.authNamespace,
    });
    return [machineUsers, nextPageToken];
  });

  return machineUsers.map(machineUserInfo);
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all machine users in the application.",
  args: z
    .object({
      ...deploymentArgs,
    })
    .strict(),
  run: async (args) => {
    // Execute machineuser list logic
    const machineUsers = await listMachineUsers({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });

    // Show machine users info
    logger.out(machineUsers, { display: { createdAt: null, updatedAt: null } });
  },
});
