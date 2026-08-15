import * as v from "valibot";
import { orderArg, paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged, initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";
import { userInfo, type UserInfo } from "./transform";

// strip unknown keys
const listUsersOptionsSchema = v.object({
  workspaceId: v.optional(v.pipe(v.string(), v.uuid("workspace-id must be a valid UUID"))),
  profile: v.optional(v.string()),
  order: v.optional(orderArg),
  limit: v.optional(v.pipe(v.unknown(), v.transform(Number), v.integer(), v.minValue(0))),
});

export type ListUsersOptions = v.InferInput<typeof listUsersOptionsSchema>;

async function loadOptions(options: ListUsersOptions) {
  const result = v.safeParse(listUsersOptionsSchema, options);
  if (!result.success) {
    throw new Error(assertDefined(result.issues[0], "Valibot returned no issues").message);
  }

  const accessToken = await loadAccessToken({ profile: result.output.profile });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: result.output.workspaceId,
    profile: result.output.profile,
  });

  return {
    client,
    workspaceId,
    order: result.output.order,
    limit: result.output.limit,
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
  args: v.strictObject({
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
