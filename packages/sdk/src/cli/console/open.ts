import { defineCommand } from "citty";
import open from "open";
import { commonArgs, withCommonArgs, workspaceArgs } from "../args";
import { loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";

const consoleBaseUrl = "https://console.tailor.tech";

export const openCommand = defineCommand({
  meta: {
    name: "open",
    description: "Open Tailor Platform Console for the workspace",
  },
  args: {
    ...commonArgs,
    ...workspaceArgs,
    "application-name": {
      type: "string",
      description: "Application name",
      alias: "a",
    },
  },
  run: withCommonArgs(async (args) => {
    const workspaceId = loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    const applicationName = args["application-name"];
    const consolePath = applicationName
      ? `/workspaces/${workspaceId}/applications/${encodeURIComponent(applicationName)}/overview`
      : `/workspaces/${workspaceId}/applications`;
    const consoleUrl = new URL(consolePath, consoleBaseUrl).toString();

    logger.info("Opening Tailor Platform Console...");

    try {
      await open(consoleUrl);
      logger.out(`Console URL: ${consoleUrl}`);
      logger.out(`Workspace ID: ${workspaceId}`);
      if (applicationName) {
        logger.out(`Application Name: ${applicationName}`);
      }
    } catch {
      logger.warn(
        `Failed to open browser automatically. Please open this URL manually:\n${consoleUrl}`,
      );
    }
  }),
});
