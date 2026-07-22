import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "#/cli/shared/command";
import { readPlatformConfig, writePlatformConfig } from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";

export const deleteCommand = defineAppCommand({
  name: "delete",
  description: "Delete a profile.",
  args: z
    .object({
      name: arg(z.string(), {
        positional: true,
        description: "Profile name",
      }),
    })
    .strict(),
  run: async (args) => {
    const config = await readPlatformConfig();

    // Check if profile exists
    if (!config.profiles[args.name]) {
      throw new Error(`Profile "${args.name}" not found.`);
    }

    // Delete profile
    delete config.profiles[args.name];
    writePlatformConfig(config);

    logger.success(`Profile "${args.name}" deleted successfully.`);
  },
});
