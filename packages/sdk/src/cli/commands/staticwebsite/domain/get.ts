import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "@/cli/shared/args";
import { initOperatorClient } from "@/cli/shared/client";
import { defineAppCommand } from "@/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";
import { statusLabels } from "./status";

export const domainGetCommand = defineAppCommand({
  name: "get",
  description: "Get details of a custom domain.",
  args: z
    .object({
      ...workspaceArgs,
      domain: arg(z.string(), {
        positional: true,
        description: "Custom domain name",
      }),
    })
    .strict(),
  run: async (args) => {
    const accessToken = await loadAccessToken({
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = await loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    const notFoundErrorMessage = `Custom domain "${args.domain}" not found.`;

    try {
      const { customDomain } = await client.getCustomDomain({
        workspaceId,
        domain: args.domain,
      });

      if (!customDomain) {
        throw new Error(notFoundErrorMessage);
      }

      const info = {
        domain: customDomain.domain,
        status: statusLabels[customDomain.status] ?? "unknown",
        trafficCnameTarget: customDomain.trafficCnameTarget,
        certificateCnameTarget: customDomain.certificateCnameTarget,
        errorMessage: customDomain.errorMessage || undefined,
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
