import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";

export const getCommand = defineAppCommand({
  name: "get",
  description: "Get details of a specific static website.",
  args: z
    .object({
      ...workspaceArgs,
      name: arg(z.string(), {
        positional: true,
        description: "Static website name",
      }),
    })
    .strict(),
  run: async (args) => {
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = await loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    const notFoundErrorMessage = `Static website "${args.name}" not found.`;

    try {
      const { staticwebsite } = await client.getStaticWebsite({
        workspaceId,
        name: args.name,
      });

      if (!staticwebsite) {
        throw new Error(notFoundErrorMessage);
      }

      const info = {
        workspaceId,
        name: staticwebsite.name,
        description: staticwebsite.description,
        url: staticwebsite.url,
        allowedIpAddresses: args.json
          ? staticwebsite.allowedIpAddresses
          : staticwebsite.allowedIpAddresses.join("\n"),
      };

      logger.out(info);
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw new Error(notFoundErrorMessage, { cause: error });
      }
      throw error;
    }
  },
});
