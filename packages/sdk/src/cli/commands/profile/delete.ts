import { defineCommand, arg } from "politty";
import { z } from "zod";
import { commonArgs, withCommonArgs } from "@/cli/shared/args";
import { readPlatformConfig, writePlatformConfig } from "@/cli/shared/context";
import { logger } from "@/cli/shared/logger";

export const deleteCommand = defineCommand({
  name: "delete",
  description: "Delete a profile.",
  args: z
    .object({
      ...commonArgs,
      name: arg(z.string(), {
        positional: true,
        description: "Profile name",
      }),
    })
    .strict(),
  run: withCommonArgs(async (args) => {
    const config = readPlatformConfig();

    // Check if profile exists
    if (!config.profiles[args.name]) {
      throw new Error(`Profile "${args.name}" not found.`);
    }

    // Delete profile
    delete config.profiles[args.name];
    writePlatformConfig(config);

    logger.success(`Profile "${args.name}" deleted successfully.`);
  }),
});
