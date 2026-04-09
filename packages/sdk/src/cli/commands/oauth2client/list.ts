import { z } from "zod";
import { deploymentArgs } from "@/cli/shared/args";
import { fetchAll, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { type OAuth2ClientInfo, toOAuth2ClientInfo } from "./transform";

export interface ListOAuth2ClientsOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
}

/**
 * List OAuth2 clients for the current application.
 * @param options - OAuth2 client listing options
 * @returns List of OAuth2 clients
 */
export async function listOAuth2Clients(
  options?: ListOAuth2ClientsOptions,
): Promise<OAuth2ClientInfo[]> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options?.workspaceId,
    profile: options?.profile,
  });

  const { config } = await loadConfig(options?.configPath);
  const { application } = await client.getApplication({
    workspaceId,
    applicationName: config.name,
  });
  if (!application?.authNamespace) {
    throw new Error(`Application ${config.name} does not have an auth configuration.`);
  }

  const oauth2Clients = await fetchAll(async (pageToken, maxPageSize) => {
    const { oauth2Clients, nextPageToken } = await client.listAuthOAuth2Clients({
      workspaceId,
      pageToken,
      pageSize: maxPageSize,
      namespaceName: application.authNamespace,
    });
    return [oauth2Clients, nextPageToken];
  });

  return oauth2Clients.map(toOAuth2ClientInfo);
}

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all OAuth2 clients in the application.",
  args: z
    .object({
      ...deploymentArgs,
    })
    .strict(),
  run: async (args) => {
    const oauth2Clients = await listOAuth2Clients({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });

    logger.out(oauth2Clients);
  },
});
