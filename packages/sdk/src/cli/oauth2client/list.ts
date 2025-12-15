import { defineCommand } from "citty";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { fetchAll, initOperatorClient } from "../client";
import { loadConfig } from "../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { printData } from "../format";
import { type OAuth2ClientInfo, toOAuth2ClientInfo } from "./transform";

export interface OAuth2ClientListOptions {
  workspaceId?: string;
  profile?: string;
  configPath?: string;
}

export async function oauth2ClientList(
  options?: OAuth2ClientListOptions,
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
    throw new Error(
      `Application ${config.name} does not have an auth configuration.`,
    );
  }

  const oauth2Clients = await fetchAll(async (pageToken) => {
    const { oauth2Clients, nextPageToken } = await client.listAuthOAuth2Clients(
      {
        workspaceId,
        pageToken,
        namespaceName: application.authNamespace,
      },
    );
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
    "workspace-id": {
      type: "string",
      description: "Workspace ID",
      alias: "w",
    },
    profile: {
      type: "string",
      description: "Workspace profile",
      alias: "p",
    },
    config: {
      type: "string",
      description: "Path to SDK config file",
      alias: "c",
      default: "tailor.config.ts",
    },
  },
  run: withCommonArgs(async (args) => {
    const oauth2Clients = await oauth2ClientList({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });

    printData(oauth2Clients, args.json);
  }),
});
