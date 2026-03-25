import { arg } from "politty";
import { z } from "zod";
import { deploymentArgs } from "@/cli/shared/args";
import { fetchMachineUserToken, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";

export interface GetMachineUserTokenOptions {
  name: string;
  workspaceId?: string;
  profile?: string;
  configPath?: string;
}

export interface MachineUserTokenInfo {
  accessToken: string;
  tokenType: string;
  expiresAt: string;
}

/**
 * Get a machine user access token for the current application.
 * @param options - Token retrieval options
 * @returns Machine user token info
 */
export async function getMachineUserToken(
  options: GetMachineUserTokenOptions,
): Promise<MachineUserTokenInfo> {
  // Load and validate options
  const accessToken = await loadAccessToken({
    useProfile: true,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  // Get application
  const { config } = await loadConfig(options.configPath);
  const { application } = await client.getApplication({
    workspaceId,
    applicationName: config.name,
  });
  if (!application?.authNamespace) {
    throw new Error(`Application ${config.name} does not have an auth configuration.`);
  }

  // Get machine user
  const { machineUser } = await client.getAuthMachineUser({
    workspaceId,
    authNamespace: application.authNamespace,
    name: options.name,
  });
  if (!machineUser) {
    throw new Error(`Machine user ${options.name} not found.`);
  }

  // Fetch machine user token
  const resp = await fetchMachineUserToken(
    application.url,
    machineUser.clientId,
    machineUser.clientSecret,
  );
  const expiresAt = new Date();
  expiresAt.setSeconds(expiresAt.getSeconds() + resp.expires_in);

  return {
    accessToken: resp.access_token,
    tokenType: resp.token_type,
    expiresAt: expiresAt.toISOString(),
  };
}

export const tokenCommand = defineAppCommand({
  name: "token",
  description: "Get an access token for a machine user.",
  args: z
    .object({
      ...deploymentArgs,
      name: arg(z.string(), {
        positional: true,
        description: "Machine user name",
      }),
    })
    .strict(),
  run: async (args) => {
    // Execute machineuser token logic
    const token = await getMachineUserToken({
      name: args.name,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
    });

    // Show machine user token info
    // TODO: remove this transformation
    const tokenInfo = {
      access_token: token.accessToken,
      token_type: token.tokenType,
      expires_at: token.expiresAt,
    };
    logger.out(tokenInfo);
  },
});
