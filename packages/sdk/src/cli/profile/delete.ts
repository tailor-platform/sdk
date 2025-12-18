import { defineCommand } from "citty";
import { commonArgs, withCommonArgs } from "../args";
import { readPlatformConfig, writePlatformConfig } from "../context";
import { logger } from "../utils/logger";

export const deleteCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Delete profile",
  },
  args: {
    ...commonArgs,
    name: {
      type: "positional",
      description: "Profile name",
      required: true,
    },
  },
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
