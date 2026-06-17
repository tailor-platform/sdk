import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "#src/cli/shared/args";
import { initOperatorClient } from "#src/cli/shared/client";
import { defineAppCommand } from "#src/cli/shared/command";
import { loadAccessToken, loadWorkspaceId } from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";
import { statusLabels } from "./status";

export const domainListCommand = defineAppCommand({
  name: "list",
  description: "List custom domains for a static website.",
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
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = await loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    try {
      const { customDomains } = await client.listCustomDomains({
        workspaceId,
        staticWebsiteName: args.name,
      });

      if (customDomains.length === 0) {
        logger.info("No custom domains found.");
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
