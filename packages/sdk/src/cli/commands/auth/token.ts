import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";

export const tokenCommand = defineAppCommand({
  name: "token",
  description:
    "Print a valid Tailor Platform access token to stdout, refreshing it first if expired.",
  args: z.strictObject({
    profile: workspaceArgs.profile,
  }),
  run: async ({ profile }) => {
    const token = await loadAccessToken({ profile });
    logger.out(token);
  },
});
