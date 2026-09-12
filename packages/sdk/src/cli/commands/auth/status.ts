import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAuthStatus } from "#/cli/shared/context";
import { CLIError, loginNextAction } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";

export const statusCommand = defineAppCommand({
  name: "status",
  description: "Show the active Tailor Platform authentication status without printing tokens.",
  args: z.strictObject({
    profile: workspaceArgs.profile,
  }),
  run: async ({ profile }) => {
    const status = await loadAuthStatus({ profile });
    logger.out(status);
    if (!status.authenticated) {
      throw CLIError({
        code: "AUTH_NOT_AUTHENTICATED",
        message: "Not authenticated.",
        suggestion: "Log in and try again.",
        next: loginNextAction(profile),
      });
    }
  },
});
