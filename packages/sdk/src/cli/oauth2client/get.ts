import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import { commonArgs, deploymentArgs, jsonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadConfig } from "../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { printData } from "../format";
import {
  type OAuth2ClientCredentials,
  toOAuth2ClientCredentials,
} from "./transform";

export interface GetOAuth2ClientOptions {
  name: string;
  workspaceId?: string;
  profile?: string;
  configPath?: string;
}

export async function getOAuth2Client(
  options: GetOAuth2ClientOptions,
): Promise<OAuth2ClientCredentials> {
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const { config } = await loadConfig(options.configPath);
  const { application } = await client.getApplication({
    workspaceId,
    applicationName: config.name,
  });
  if (!application?.authNamespace) {
    throw new Error(
      `Application ${config.name} does not have an auth configuration.`,
    );
  }

  try {
    const { oauth2Client } = await client.getAuthOAuth2Client({
      workspaceId,
      namespaceName: application.authNamespace,
      name: options.name,
    });

    return toOAuth2ClientCredentials(oauth2Client!);
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(`OAuth2 client '${options.name}' not found.`);
    }
    throw error;
  }
}

export const getCommand = defineCommand({
  meta: {
    name: "get",
    description: "Get OAuth2 client credentials",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    ...deploymentArgs,
    name: {
      type: "positional",
      description: "OAuth2 client name",
      required: true,
    },
  },
  run: withCommonArgs(async (args) => {
    const credentials = await getOAuth2Client({
      name: args.name,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });

    printData(credentials, args.json);
  }),
});
