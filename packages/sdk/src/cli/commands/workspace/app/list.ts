import { z } from "zod";
import { orderArg, paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged, initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";
import { appInfo, type AppInfo } from "./transform";

const listAppsOptionsSchema = /* strip unknown keys */ z.object({
  workspaceId: z.uuid({ message: "workspace-id must be a valid UUID" }).optional(),
  profile: z.string().optional(),
  order: orderArg.optional(),
  limit: z.coerce.number().int().nonnegative().optional(),
});

export type ListAppsOptions = z.input<typeof listAppsOptionsSchema>;

async function loadOptions(options: ListAppsOptions) {
  const result = listAppsOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error(assertDefined(result.error.issues[0], "Zod returned no issues").message);
  }

  const accessToken = await loadAccessToken({ profile: result.data.profile });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: result.data.workspaceId,
    profile: result.data.profile,
  });

  return {
    client,
    workspaceId,
    order: result.data.order,
    limit: result.data.limit,
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
    const apps = await listApps({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      order: args.order,
      limit: args.limit,
    });

    const formattedApps = jsonOutput
      ? apps
      : apps.map(({ updatedAt: _, createdAt, ...rest }) => ({
          ...rest,
          createdAt: humanizeRelativeTime(createdAt),
        }));

    logger.out(formattedApps);
  },
});
