import { z } from "zod";
import { orderArg, paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { fetchWithinLimit, reportTruncation } from "#/cli/shared/limit";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { parseOptions } from "#/cli/shared/parse-options";
import { appInfo, type AppInfo } from "./transform";

// strip unknown keys
const listAppsOptionsSchema = z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  order: orderArg.optional(),
  limit: z.coerce.number().int().nonnegative().optional(),
});

export type ListAppsOptions = z.input<typeof listAppsOptionsSchema>;

async function loadOptions(options: ListAppsOptions) {
  const validated = parseOptions(listAppsOptionsSchema, options);

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
 * List applications in a workspace with an optional order and limit.
 * @param options - Application listing options
 * @returns List of applications
 */
export async function listApps(options: ListAppsOptions): Promise<AppInfo[]> {
  const { client, workspaceId, order, limit } = await loadOptions(options);

  const pageDirection = toPageDirection(order);
  const applications = await fetchPaged(
    async (pageToken, pageSize) => {
      const { applications, nextPageToken } = await client.listApplications({
        workspaceId,
        pageToken,
        pageSize,
        pageDirection,
      });
      return [applications, nextPageToken];
    },
    { limit },
  );

  return applications.map(appInfo);
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List applications in a workspace",
  args: z.strictObject({
    ...workspaceArgs,
    ...paginationArgs(),
  }),
  run: async (args) => {
    const jsonOutput = logger.jsonMode;
    const listed = await fetchWithinLimit(args.limit, (limit) =>
      listApps({
        workspaceId: args["workspace-id"],
        profile: args.profile,
        order: args.order,
        limit,
      }),
    );
    const apps = listed.items;

    const formattedApps = jsonOutput
      ? apps
      : apps.map(({ updatedAt: _, createdAt, ...rest }) => ({
          ...rest,
          createdAt: humanizeRelativeTime(createdAt),
        }));

    logger.out(formattedApps);
    await reportTruncation(listed, args.limit);
  },
});
