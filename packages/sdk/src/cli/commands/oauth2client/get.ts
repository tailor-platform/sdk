import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "@politty/zod";
import { z } from "zod";
import { deploymentArgs } from "#/cli/shared/args";
import { loadAuthApplication } from "#/cli/shared/auth-applications";
import { type OperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfigFile, type LoadedConfigFile } from "#/cli/shared/config-loader";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { assertDefined } from "#/utils/assert";
import { oauth2ClientAuths, type OAuth2ClientRef, resolveOAuth2Client } from "./resolve";
import { type OAuth2ClientCredentials, toOAuth2ClientCredentials } from "./transform";

export interface GetOAuth2ClientOptions {
  name: string;
  workspaceId?: string;
  profile?: string;
  configPath?: string;
}

interface ResolveOAuth2ClientTargetParams {
  client: OperatorClient;
  workspaceId: string;
  loaded: LoadedConfigFile;
  value: string;
}

async function resolveOAuth2ClientTarget(
  params: ResolveOAuth2ClientTargetParams,
): Promise<OAuth2ClientRef> {
  const { client, workspaceId, loaded, value } = params;
  if (loaded.kind === "workspace") {
    return resolveOAuth2Client({ value, auths: oauth2ClientAuths(loaded) });
  }
  const { authNamespace } = await loadAuthApplication({
    client,
    workspaceId,
    name: loaded.config.name,
  });
  const auth = oauth2ClientAuths(loaded).find(({ name }) => name === authNamespace);
  return resolveOAuth2Client({
    value,
    auths: [{ name: authNamespace, oauth2Clients: auth?.oauth2Clients }],
  });
}

/**
 * Get OAuth2 client credentials. The name may name its Auth service as `<auth>/<name>`.
 * @param options - OAuth2 client lookup options
 * @returns OAuth2 client credentials
 */
export async function getOAuth2Client(
  options: GetOAuth2ClientOptions,
): Promise<OAuth2ClientCredentials> {
  const { client, workspaceId } = await loadOperatorWorkspaceContext({
    profile: options.profile,
    workspaceId: options.workspaceId,
  });
  const loaded = await loadConfigFile(options.configPath);
  const { authNamespace, name } = await resolveOAuth2ClientTarget({
    client,
    workspaceId,
    loaded,
    value: options.name,
  });

  try {
    const { oauth2Client } = await client.getAuthOAuth2Client({
      workspaceId,
      namespaceName: authNamespace,
      name,
    });

    return toOAuth2ClientCredentials(
      assertDefined(oauth2Client, "oauth2Client missing in response"),
    );
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw CLIError({
        code: "OAUTH2_CLIENT_NOT_FOUND",
        message: `OAuth2 client '${options.name}' not found.`,
        context: { oauth2Client: options.name },
        cause: error,
      });
    }
    throw error;
  }
}

export const getCommand = defineAppCommand({
  name: "get",
  description: "Get OAuth2 client credentials (including client secret).",
  args: z.strictObject({
    ...deploymentArgs,
    name: arg(z.string(), {
      positional: true,
      description: "OAuth2 client name",
    }),
  }),
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
