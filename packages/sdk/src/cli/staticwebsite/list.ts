import { defineCommand } from "citty";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";

export interface StaticWebsiteInfo {
  workspaceId: string;
  name: string;
  description: string;
  url: string;
  allowedIpAddresses: string[];
}

interface StaticWebsiteListOptions {
  workspaceId?: string;
  profile?: string;
}

/**
 * List static websites in the workspace.
 * @param [options] - Static website listing options
 * @returns List of static websites
 */
async function listStaticWebsites(
  options?: StaticWebsiteListOptions,
): Promise<StaticWebsiteInfo[]> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  const websites = await fetchAll(async (pageToken) => {
    const { staticwebsites, nextPageToken } = await client.listStaticWebsites({
      workspaceId,
      pageToken,
    });
    return [staticwebsites, nextPageToken];
  });

  return websites.map((site) => ({
    workspaceId,
    name: site.name,
    description: site.description,
    url: site.url ?? "",
    allowedIpAddresses: site.allowedIpAddresses,
  }));
}

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List static websites",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
  },
  run: withCommonArgs(async (args) => {
    const websites = await listStaticWebsites({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    const formatted = args.json
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
  }),
});
