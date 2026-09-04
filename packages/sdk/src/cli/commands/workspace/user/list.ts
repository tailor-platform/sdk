import { z } from "zod";
import { orderArg, paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { parseOptions } from "#/cli/shared/parse-options";
import { userInfo, type UserInfo } from "./transform";

// strip unknown keys
const listUsersOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  order: orderArg.optional(),
  limit: z.coerce.number().int().nonnegative().optional(),
});

export type ListUsersOptions = z.input<typeof listUsersOptionsSchema>;

async function loadOptions(options: ListUsersOptions) {
  const validated = parseOptions(listUsersOptionsSchema, options);

  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: validated.profile,
    workspaceId: validated.workspaceId,
  });

  return {
    client,
    workspaceId,
    order: validated.order,
    limit: validated.limit,
  };
}

/**
 * List users in a workspace with an optional order and limit.
 * @param options - User listing options
 * @returns List of workspace users
 */
export async function listUsers(options: ListUsersOptions): Promise<UserInfo[]> {
  const { client, workspaceId, order, limit } = await loadOptions(options);

  const pageDirection = toPageDirection(order);
  const users = await fetchPaged(
    async (pageToken, pageSize) => {
      const { workspacePlatformUsers, nextPageToken } = await client.listWorkspacePlatformUsers({
        workspaceId,
        pageToken,
        pageSize,
        pageDirection,
      });
      return [workspacePlatformUsers, nextPageToken];
    },
    { limit },
  );

  return users.map(userInfo);
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List users in a workspace",
  args: z.strictObject({
    ...workspaceArgs,
    ...paginationArgs(),
  }),
  run: async (args) => {
    const users = await listUsers({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      order: args.order,
      limit: args.limit,
    });

    logger.out(users);
  },
});
