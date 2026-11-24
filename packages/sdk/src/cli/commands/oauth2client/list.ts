import { z } from "zod";
import { deploymentArgs, type Order, paginationArgs, toPageDirection } from "#/cli/shared/args";
import { listAcrossAuthNamespaces, listedAuthNamespaces } from "#/cli/shared/auth-applications";
import { fetchPaged } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfigFile } from "#/cli/shared/config-loader";
import { fetchWithinLimit, reportTruncation } from "#/cli/shared/limit";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { type OAuth2ClientInfo, toOAuth2ClientInfo } from "./transform";

export interface ListOAuth2ClientsOptions {
  workspaceId?: string | undefined;
  profile?: string | undefined;
  configPath?: string | undefined;
  order?: Order | undefined;
  limit?: number | undefined;
}

/**
 * List OAuth2 clients of the config's Auth services.
 * @param options - OAuth2 client listing options
 * @returns List of OAuth2 clients
 */
export async function listOAuth2Clients(
  options?: ListOAuth2ClientsOptions,
): Promise<OAuth2ClientInfo[]> {
  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options?.profile,
    workspaceId: options?.workspaceId,
  });
  const loaded = await loadConfigFile(options?.configPath);
  const authNamespaces = await listedAuthNamespaces({ client, workspaceId, loaded });

  const pageDirection = toPageDirection(options?.order);
  return await listAcrossAuthNamespaces({
    authNamespaces,
    order: options?.order,
    limit: options?.limit,
    itemLabel: "OAuth2 clients",
    fetch: async (authNamespace, limit) => {
      const oauth2Clients = await fetchPaged(
        async (pageToken, pageSize) => {
          const { oauth2Clients, nextPageToken } = await client.listAuthOAuth2Clients({
            workspaceId,
            pageToken,
            pageSize,
            namespaceName: authNamespace,
            pageDirection,
          });
          return [oauth2Clients, nextPageToken];
        },
        { limit },
      );
      return oauth2Clients.map((oauth2Client) => toOAuth2ClientInfo(oauth2Client, authNamespace));
    },
    createdAt: (oauth2Client) => oauth2Client.createdAt,
  });
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all OAuth2 clients in the application.",
  args: z.strictObject({
    ...deploymentArgs,
    ...paginationArgs(),
  }),
  run: async (args) => {
    const listed = await fetchWithinLimit(args.limit, (limit) =>
      listOAuth2Clients({
        workspaceId: args["workspace-id"],
        profile: args.profile,
        configPath: args.config,
        order: args.order,
        limit,
      }),
    );
    const oauth2Clients = listed.items;

    logger.out(oauth2Clients);
    await reportTruncation(listed, args.limit);
  },
});
