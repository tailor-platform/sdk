import { Code, ConnectError } from "@connectrpc/connect";
import { defineCommand } from "citty";
import { commonArgs, jsonArgs, withCommonArgs } from "../args";
import { initOperatorClient } from "../client";
import { loadAccessToken, loadWorkspaceId } from "../context";
import { printData } from "../format";

export const getCommand = defineCommand({
  meta: {
    name: "get",
    description: "Get static website details",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    name: {
      type: "positional",
      description: "Static website name",
      required: true,
    },
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
  },
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

      printData(info, args.json);
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw new Error(notFoundErrorMessage);
      }
      throw error;
    }
  }),
});
