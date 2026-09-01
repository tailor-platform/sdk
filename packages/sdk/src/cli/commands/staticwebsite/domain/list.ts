import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { statusLabels } from "./status";

export const domainListCommand = defineAppCommand({
  name: "list",
  description: "List custom domains for a static website.",
  args: z.strictObject({
    ...workspaceArgs,
    name: arg(z.string(), {
      positional: true,
      description: "Static website name",
    }),
  }),
  run: async (args) => {
    const { client, workspaceId } = await loadOperatorWorkspaceContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
    });

    try {
      const { customDomains } = await client.listCustomDomains({
        workspaceId,
        staticWebsiteName: args.name,
      });

      if (customDomains.length === 0) {
        logger.info("No custom domains found.");
        if (logger.jsonMode) {
          logger.out([]);
        }
        return;
      }

      const formatted = customDomains.map((d) => ({
        domain: d.domain,
        // platform may return enum values newer than this SDK
        // oxlint-disable-next-line typescript/no-unnecessary-condition
        status: statusLabels[d.status] ?? "unknown",
        trafficCnameTarget: d.trafficCnameTarget,
        certificateCnameTarget: d.certificateCnameTarget,
      }));

      logger.out(formatted);
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw new Error(`Static website "${args.name}" not found.`, { cause: error });
      }
      throw error;
    }
  },
});
