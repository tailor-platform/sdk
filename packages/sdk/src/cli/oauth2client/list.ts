import { defineCommand } from "citty";
import { commonArgs, deploymentArgs, jsonArgs, withCommonArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadConfig } from "../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";
import { type OAuth2ClientInfo, toOAuth2ClientInfo } from "./transform";

export interface ListOAuth2ClientsOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
}

export async function listOAuth2Clients(
  options?: ListOAuth2ClientsOptions,
): Promise<OAuth2ClientInfo[]> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options?.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
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

  const oauth2Clients = await fetchAll(async (pageToken) => {
    const { oauth2Clients, nextPageToken } = await client.listAuthOAuth2Clients({
      workspaceId,
      pageToken,
      namespaceName: application.authNamespace,
    });
    return [oauth2Clients, nextPageToken];
  });

  return oauth2Clients.map(toOAuth2ClientInfo);
}

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all OAuth2 clients",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    ...deploymentArgs,
  },
  run: withCommonArgs(async (args) => {
    const oauth2Clients = await listOAuth2Clients({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });

    logger.data(oauth2Clients);
  }),
});
