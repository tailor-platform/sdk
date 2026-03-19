import open from "open";
import { z } from "zod";
import { deploymentArgs } from "@/cli/shared/args";
import { defineAppCommand } from "@/cli/shared/command";
import { loadConfig } from "@/cli/shared/config-loader";
import { loadWorkspaceId } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";

const consoleBaseUrl = "https://console.tailor.tech";

export const openCommand = defineAppCommand({
  name: "open",
  description: "Open Tailor Platform Console.",
  args: z
    .object({
      ...deploymentArgs,
    })
    .strict(),
  run: async (args) => {
    const workspaceId = await loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });
    const { config } = await loadConfig(args.config);
    const applicationName = config.name;
    const consolePath = `/workspaces/${workspaceId}/applications/${encodeURIComponent(applicationName)}/overview`;
    const consoleUrl = new URL(consolePath, consoleBaseUrl).toString();

    logger.info("Opening Tailor Platform Console...");

    try {
      await open(consoleUrl);
      logger.out(`Console URL: ${consoleUrl}`);
      logger.out(`Workspace ID: ${workspaceId}`);
      logger.out(`Application Name: ${applicationName}`);
    } catch {
      logger.warn(
        `Failed to open browser automatically. Please open this URL manually:\n${consoleUrl}`,
      );
    }
  },
});
