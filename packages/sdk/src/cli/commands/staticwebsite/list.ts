import { z } from "zod";
import { type Order, paginationArgs, toPageDirection, workspaceArgs } from "#/cli/shared/args";
import { fetchPaged } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";

export interface StaticWebsiteInfo {
  workspaceId: string;
  name: string;
  description: string;
  url: string;
  allowedIpAddresses: string[];
}

type StaticWebsiteListOptions = {
  workspaceId?: string;
  profile?: string;
  order?: Order;
  limit?: number;
};

/**
 * List static websites in the workspace.
 * @param options - Static website listing options
 * @returns List of static websites
 */
async function listStaticWebsites(
  options?: StaticWebsiteListOptions,
): Promise<StaticWebsiteInfo[]> {
  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options?.profile,
    workspaceId: options?.workspaceId,
  });

  const pageDirection = toPageDirection(options?.order);
  const websites = await fetchPaged(
    async (pageToken, pageSize) => {
      const { staticwebsites, nextPageToken } = await client.listStaticWebsites({
        workspaceId,
        pageToken,
        pageSize,
        pageDirection,
      });
      return [staticwebsites, nextPageToken];
    },
    { limit: options?.limit },
  );

  return websites.map((site) => ({
    workspaceId,
    name: site.name,
    description: site.description,
    url: site.url,
    allowedIpAddresses: site.allowedIpAddresses,
  }));
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all static websites in a workspace.",
  args: z.strictObject({
    ...workspaceArgs,
    ...paginationArgs(),
  }),
  run: async (args) => {
    const jsonOutput = logger.jsonMode;
    const websites = await listStaticWebsites({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      order: args.order,
      limit: args.limit,
    });

    const formatted = jsonOutput
      ? websites
      : websites.map(({ allowedIpAddresses, ...rest }) => {
          if (allowedIpAddresses.length === 0) {
            return {
              ...rest,
              allowedIpAddresses: "No allowed IP addresses",
            };
          }

          const count = allowedIpAddresses.length;
          const label = count === 1 ? "1 IP address" : `${count} IP addresses`;

          return {
            ...rest,
            allowedIpAddresses: label,
          };
        });

    logger.out(formatted);
  },
});
