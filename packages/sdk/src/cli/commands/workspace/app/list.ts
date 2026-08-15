import * as v from "valibot";
import { orderArg, paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged, initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { humanizeRelativeTime } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { assertDefined } from "#/utils/assert";
import { appInfo, type AppInfo } from "./transform";

// strip unknown keys
const listAppsOptionsSchema = v.object({
  workspaceId: v.optional(v.pipe(v.string(), v.uuid("workspace-id must be a valid UUID"))),
  profile: v.optional(v.string()),
  order: v.optional(orderArg),
  limit: v.optional(v.pipe(v.unknown(), v.transform(Number), v.integer(), v.minValue(0))),
});

export type ListAppsOptions = v.InferInput<typeof listAppsOptionsSchema>;

async function loadOptions(options: ListAppsOptions) {
  const result = v.safeParse(listAppsOptionsSchema, options);
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
  args: v.strictObject({
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
