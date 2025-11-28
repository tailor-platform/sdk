import { defineCommand } from "citty";
import {
  commonArgs,
  formatArgs,
  parseFormat,
  printWithFormat,
  withCommonArgs,
} from "../args";
import { fetchMachineUserToken, initOperatorClient } from "../client";
import { loadConfig } from "../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../context";

export interface MachineUserTokenOptions {
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

export async function machineUserToken(
  options: MachineUserTokenOptions,
): Promise<MachineUserTokenInfo> {
  // Load and validate options
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

  // Get application
  const { application } = await client.getApplication({
    workspaceId,
    applicationName: config.name,
  });
  if (!application?.authNamespace) {
    throw new Error(
      `Application ${config.name} does not have an auth configuration.`,
    );
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

export const tokenCommand = defineCommand({
  meta: {
    name: "token",
    description: "Get machine user token",
  },
  args: {
    ...commonArgs,
    ...formatArgs,
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
    name: {
      type: "positional",
      description: "Machine user name",
      required: true,
    },
  },
  run: withCommonArgs(async (args) => {
    // Validate CLI specific args
    const format = parseFormat(args.format);

    // Execute machineuser token logic
    const token = await machineUserToken({
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
    printWithFormat(tokenInfo, format);
  }),
});
