import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand, arg } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs, workspaceArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";

export const getCommand = defineCommand({
  name: "get",
  description: "Get static website details",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    ...workspaceArgs,
    name: arg(z.string(), {
      positional: true,
      description: "Static website name",
    }),
  }),
  run: withCommonArgs(async (args) => {
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = loadWorkspaceId({
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
        throw new Error(notFoundErrorMessage);
      }
      throw error;
    }
  }),
});
