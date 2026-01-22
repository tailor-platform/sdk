import { defineCommand } from "citty";
import open from "open";
import { commonArgs, deploymentArgs, withCommonArgs } from "../args";
import { loadConfig } from "../config-loader";
import { loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";

const consoleBaseUrl = "https://console.tailor.tech";

export const openCommand = defineCommand({
  meta: {
    name: "open",
    description: "Open Tailor Platform Console for the application",
  },
  args: {
    ...commonArgs,
    ...deploymentArgs,
  },
  run: withCommonArgs(async (args) => {
    const workspaceId = loadWorkspaceId({
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
  }),
});
