import { z } from "zod";
import { type Order, paginationArgs, toPageDirection, workspaceArgs } from "#src/cli/shared/args";
import { fetchPaged, initOperatorClient } from "#src/cli/shared/client";
import { defineAppCommand } from "#src/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";

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
  const accessToken = await loadAccessToken({
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
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
  args: z
    .object({
      ...workspaceArgs,
      ...paginationArgs(),
    })
    .strict(),
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
