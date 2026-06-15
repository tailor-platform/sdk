import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "politty";
import { z } from "zod";
import { deploymentArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { assertDefined } from "@/utils/assert";
import { type OAuth2ClientCredentials, toOAuth2ClientCredentials } from "./transform";

export interface GetOAuth2ClientOptions {
  name: string;
  workspaceId?: string;
  profile?: string;
  configPath?: string;
}

/**
 * Get OAuth2 client credentials for the current application.
 * @param options - OAuth2 client lookup options
 * @returns OAuth2 client credentials
 */
export async function getOAuth2Client(
  options: GetOAuth2ClientOptions,
): Promise<OAuth2ClientCredentials> {
  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const { config } = await loadConfig(options.configPath);
  const { application } = await client.getApplication({
    workspaceId,
    applicationName: config.name,
  });
  if (!application?.authNamespace) {
    throw new Error(`Application ${config.name} does not have an auth configuration.`);
  }

  try {
    const { oauth2Client } = await client.getAuthOAuth2Client({
      workspaceId,
      namespaceName: application.authNamespace,
      name: options.name,
    });

    return toOAuth2ClientCredentials(
      assertDefined(oauth2Client, "oauth2Client missing in response"),
    );
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw new Error(`OAuth2 client '${options.name}' not found.`, { cause: error });
    }
    throw error;
  }
}

export const getCommand = defineAppCommand({
  name: "get",
  description: "Get OAuth2 client credentials (including client secret).",
  args: z
    .object({
      ...deploymentArgs,
      name: arg(z.string(), {
        positional: true,
        description: "OAuth2 client name",
      }),
    })
    .strict(),
  run: async (args) => {
    const credentials = await getOAuth2Client({
      name: args.name,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });

    logger.out(credentials);
  },
});
