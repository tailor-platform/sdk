import { defineCommand } from "citty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { loadAccessToken, loadWorkspaceId } from "../../context";
import { logger } from "../../utils/logger";
import { userInfo, type UserInfo } from "./transform";

const listUsersOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export type ListUsersOptions = z.input<typeof listUsersOptionsSchema>;

async function loadOptions(options: ListUsersOptions) {
  const result = listUsersOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(result.error.issues[0].message);
  }

  const accessToken = await loadAccessToken();
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: result.data.workspaceId,
    profile: result.data.profile,
  });

  return {
    client,
    workspaceId,
    limit: result.data.limit,
  };
}

/**
 * List users in a workspace with an optional limit.
 * @param options - User listing options
 * @returns List of workspace users
 */
export async function listUsers(options: ListUsersOptions): Promise<UserInfo[]> {
  const { client, workspaceId, limit } = await loadOptions(options);
  const hasLimit = limit !== undefined;

  const results: UserInfo[] = [];
  let pageToken = "";

  while (true) {
    if (hasLimit && results.length >= limit!) {
      break;
    }

    const remaining = hasLimit ? limit! - results.length : undefined;
    const pageSize = remaining !== undefined && remaining > 0 ? remaining : undefined;

    const { workspacePlatformUsers, nextPageToken } = await client.listWorkspacePlatformUsers({
      workspaceId,
      pageToken,
      ...(pageSize !== undefined ? { pageSize } : {}),
    });

    const mapped = workspacePlatformUsers.map(userInfo);

    if (remaining !== undefined && mapped.length > remaining) {
      results.push(...mapped.slice(0, remaining));
    } else {
      results.push(...mapped);
    }

    if (!nextPageToken) {
      break;
    }
    pageToken = nextPageToken;
  }

  return results;
}

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List users in a workspace",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    limit: {
      type: "string",
      alias: "l",
      description: "Maximum number of users to list",
    },
  },
  run: withCommonArgs(async (args) => {
    let limit: number | undefined;
    if (args.limit) {
      limit = parseInt(args.limit, 10);
      if (Number.isNaN(limit) || limit <= 0) {
        throw new Error(`--limit must be a positive integer, got '${args.limit}'`);
      }
    }

    const users = await listUsers({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      limit,
    });

    logger.out(users);
  }),
});
