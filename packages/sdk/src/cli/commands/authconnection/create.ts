import { Code, ConnectError } from "@connectrpc/connect";
import { AuthConnection_Type } from "@tailor-proto/tailor/v1/auth_resource_pb";
import { z } from "zod";
import { workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { oauth2ConnectionArgs } from "./args";

export const createAuthConnectionCommand = defineAppCommand({
  name: "create",
  description: "Create an auth connection.",
  args: z
    .object({
      ...workspaceArgs,
      ...oauth2ConnectionArgs,
    })
    .strict(),
  run: async (args) => {
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    try {
      await client.createAuthConnection({
        workspaceId,
        connection: {
          name: args.name,
          type: AuthConnection_Type.OAUTH2,
          config: {
            case: "oauth2",
            value: {
              providerUrl: args["provider-url"],
              issuerUrl: args["issuer-url"],
              clientId: args["client-id"],
              clientSecret: args["client-secret"],
              authUrl: args["auth-url"] ?? "",
              tokenUrl: args["token-url"] ?? "",
            },
          },
        },
      });
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.AlreadyExists) {
        throw new Error(`Auth connection "${args.name}" already exists.`);
      }
      throw error;
    }

    logger.success(`Auth connection "${args.name}" created.`);
  },
});
