import open from "open";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";

const consoleBaseUrl = "https://console.tailor.tech";

export const openAuthConnectionCommand = defineAppCommand({
  name: "open",
  description: "Open the auth connections page in the Tailor Platform Console.",
  args: z.strictObject({ ...workspaceArgs }),
  run: async (args) => {
    const workspaceId = await loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });
    const consolePath = `/workspaces/${workspaceId}/settings/connections`;
    const consoleUrl = new URL(consolePath, consoleBaseUrl).toString();
    const jsonOutput = logger.jsonMode;

    logger.info("Opening auth connections page in Tailor Platform Console...");

    let opened = true;
    try {
      await open(consoleUrl);
    } catch {
      opened = false;
    }

    if (jsonOutput) {
      logger.out({ consoleUrl, workspaceId, opened });
      return;
    }

    if (opened) {
      logger.out(`Console URL: ${consoleUrl}`);
      logger.out(`Workspace ID: ${workspaceId}`);
    } else {
      logger.warn(
        `Failed to open browser automatically. Please open this URL manually:\n${consoleUrl}`,
      );
    }
  },
});
