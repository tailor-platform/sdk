import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { statusLabels } from "./status";

export const domainGetCommand = defineAppCommand({
  name: "get",
  description: "Get details of a custom domain.",
  args: z.strictObject({
    ...workspaceArgs,
    domain: arg(z.string(), {
      positional: true,
      description: "Custom domain name",
    }),
  }),
  run: async (args) => {
    const { client, workspaceId } = await loadOperatorWorkspaceContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
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
        // platform may return enum values newer than this SDK
        // oxlint-disable-next-line typescript/no-unnecessary-condition
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
