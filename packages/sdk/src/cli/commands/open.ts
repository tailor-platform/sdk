import open from "open";
import { z } from "zod";
import { deploymentArgs } from "#src/cli/shared/args";
import { defineAppCommand } from "#src/cli/shared/command";
import { loadConfig } from "#src/cli/shared/config-loader";
import { loadWorkspaceId } from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";

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
    const jsonOutput = logger.jsonMode;

    logger.info("Opening Tailor Platform Console...");

    let opened = true;
    try {
      await open(consoleUrl);
    } catch {
      opened = false;
    }

    if (jsonOutput) {
      logger.out({ consoleUrl, workspaceId, applicationName, opened });
      return;
    }

    if (opened) {
      logger.out(`Console URL: ${consoleUrl}`);
      logger.out(`Workspace ID: ${workspaceId}`);
      logger.out(`Application Name: ${applicationName}`);
    } else {
      logger.warn(
        `Failed to open browser automatically. Please open this URL manually:\n${consoleUrl}`,
      );
    }
  },
});
