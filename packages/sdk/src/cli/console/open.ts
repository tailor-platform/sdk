import { defineCommand } from "citty";
import open from "open";
import { commonArgs, withCommonArgs, workspaceArgs } from "../args";
import { loadWorkspaceId } from "../context";
import { logger } from "../utils/logger";

const consoleBaseUrl = process.env.TAILOR_CONSOLE_URL ?? "https://console.tailor.tech";

export const openCommand = defineCommand({
  meta: {
    name: "open",
    description: "Open Tailor Platform Console for the workspace",
  },
  args: {
    ...commonArgs,
    ...workspaceArgs,
  },
  run: withCommonArgs(async (args) => {
    const workspaceId = loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    const consoleUrl = new URL(
      `/workspaces/${workspaceId}/applications`,
      consoleBaseUrl,
    ).toString();

    logger.info(`Opening Tailor Platform Console:\n${consoleUrl}\n`);

    try {
      await open(consoleUrl);
      logger.out(`Console URL: ${consoleUrl}`);
      logger.out(`Workspace ID: ${workspaceId}`);
    } catch {
      logger.warn("Failed to open browser automatically. Please open the URL above manually.");
    }
  }),
});
