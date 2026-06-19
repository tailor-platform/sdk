import { arg } from "politty";
import { z } from "zod";
import { deploymentArgs } from "@/cli/shared/args";
import { fetchMachineUserToken, initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadAccessToken, loadMachineUserName, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";

export interface GetMachineUserTokenOptions {
  name?: string;
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
  const name = await loadMachineUserName({ machineUser: options.name, profile: options.profile });
  if (!name) {
    throw new Error(
      "Machine user is required. Provide the NAME positional argument, set TAILOR_PLATFORM_MACHINE_USER_NAME, or set a profile default with 'tailor-sdk profile update <profile> --machine-user <name>'.",
    );
  }

  const accessToken = await loadAccessToken({
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
    name,
  });
  if (!machineUser) {
    throw new Error(`Machine user ${name} not found.`);
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
      name: arg(z.string().optional(), {
        positional: true,
        description: "Machine user name. Falls back to the active profile's default machine user.",
        env: "TAILOR_PLATFORM_MACHINE_USER_NAME",
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
