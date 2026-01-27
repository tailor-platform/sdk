import { defineCommand } from "citty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { loadAccessToken, loadWorkspaceId } from "../../context";
import { humanizeRelativeTime } from "../../utils/format";
import { logger } from "../../utils/logger";
import { appInfo, type AppInfo } from "./transform";

const listAppsOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export type ListAppsOptions = z.input<typeof listAppsOptionsSchema>;

async function loadOptions(options: ListAppsOptions) {
  const result = listAppsOptionsSchema.safeParse(options);
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
 * List applications in a workspace with an optional limit.
 * @param options - Application listing options
 * @returns List of applications
 */
export async function listApps(options: ListAppsOptions): Promise<AppInfo[]> {
  const { client, workspaceId, limit } = await loadOptions(options);
  const hasLimit = limit !== undefined;

  const results: AppInfo[] = [];
  let pageToken = "";

  while (true) {
    if (hasLimit && results.length >= limit!) {
      break;
    }

    const remaining = hasLimit ? limit! - results.length : undefined;
    const pageSize = remaining !== undefined && remaining > 0 ? remaining : undefined;

    const { applications, nextPageToken } = await client.listApplications({
      workspaceId,
      pageToken,
      ...(pageSize !== undefined ? { pageSize } : {}),
    });

    const mapped = applications.map(appInfo);

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
    description: "List applications in a workspace",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    limit: {
      type: "string",
      alias: "l",
      description: "Maximum number of applications to list",
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

    const apps = await listApps({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      limit,
    });

    const formattedApps = args.json
      ? apps
      : apps.map(({ updatedAt: _, createdAt, ...rest }) => ({
          ...rest,
          createdAt: humanizeRelativeTime(createdAt),
        }));

    logger.out(formattedApps);
  }),
});
