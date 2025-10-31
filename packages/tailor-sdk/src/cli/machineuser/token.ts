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
import { loadAccessToken, loadConfigPath, loadWorkspaceId } from "../context";

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
    // Validate args
    const format = parseFormat(args.format);

    // Initialize client
    const workspaceId = loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);

    // Get machine user
    const { config } = await loadConfig(loadConfigPath(args.config));
    const { application } = await client.getApplication({
      workspaceId,
      applicationName: config.name,
    });
    if (!application?.authNamespace) {
      throw new Error(
        `Application ${config.name} does not have an auth configuration.`,
      );
    }
    const { machineUser } = await client.getAuthMachineUser({
      workspaceId,
      authNamespace: application.authNamespace,
      name: args.name,
    });
    if (!machineUser) {
      throw new Error(`Machine user ${args.name} not found.`);
    }

    // Fetch machine user token
    const resp = await fetchMachineUserToken(
      application.url,
      machineUser.clientId,
      machineUser.clientSecret,
    );
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + resp.expires_in);

    // Show machine user token info
    const tokenInfo = {
      access_token: resp.access_token,
      token_type: resp.token_type,
      expires_at: expiresAt.toISOString(),
    };
    printWithFormat(tokenInfo, format);
  }),
});
