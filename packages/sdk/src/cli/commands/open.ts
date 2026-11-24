import open from "open";
import { z } from "zod";
import { appArg, deploymentArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { configApplications, selectApplication } from "#/cli/shared/config-applications";
import { loadConfigFile } from "#/cli/shared/config-loader";
import { loadConsoleBaseUrl, loadWorkspaceId } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";

export const openCommand = defineAppCommand({
  name: "open",
  description: "Open Tailor Platform Console.",
  args: z.strictObject({
    ...deploymentArgs,
    ...appArg("the application list of the workspace"),
  }),
  run: async (args) => {
    const workspaceId = await loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });
    const applicationName = selectApplication(
      configApplications(await loadConfigFile(args.config)),
      args.app,
    )?.name;
    const applicationsPath = `/workspaces/${workspaceId}/services/applications`;
    const consolePath =
      applicationName === undefined
        ? applicationsPath
        : `${applicationsPath}/${encodeURIComponent(applicationName)}`;
    const consoleBaseUrl = await loadConsoleBaseUrl({
      profile: args.profile,
      ...(args["workspace-id"] !== undefined ? { allowMissingProfile: true } : {}),
    });
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
      logger.out({
        consoleUrl,
        workspaceId,
        ...(applicationName === undefined ? {} : { applicationName }),
        opened,
      });
      return;
    }

    if (opened) {
      logger.out(`Console URL: ${consoleUrl}`);
      logger.out(`Workspace ID: ${workspaceId}`);
      if (applicationName !== undefined) {
        logger.out(`Application Name: ${applicationName}`);
      }
    } else {
      logger.warn(
        `Failed to open browser automatically. Please open this URL manually:\n${consoleUrl}`,
      );
    }
  },
});
