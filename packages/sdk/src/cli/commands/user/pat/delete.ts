import { arg } from "politty";
import { z } from "zod";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import {
  fetchLatestToken,
  loadPlatformClientConfig,
  readPlatformConfig,
} from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { assertWritable } from "#/cli/shared/readonly-guard";
import ml from "#/utils/multiline";
import { resolvePatUser } from "./user";

export const deleteCommand = defineAppCommand({
  name: "delete",
  description: "Delete a personal access token.",
  args: z
    .object({
      name: arg(z.string(), {
        positional: true,
        description: "Token name",
      }),
    })
    .strict(),
  run: async (args) => {
    await assertWritable();
    const platformConfig = await loadPlatformClientConfig();
    const config = await readPlatformConfig();
    const user = resolvePatUser(config);

    if (!user) {
      throw new Error(ml`
        No user logged in.
        Please login first using 'tailor-sdk login' command.
      `);
    }

    const token = await fetchLatestToken(config, user, platformConfig);
    const client = await initOperatorClient(token, platformConfig);

    await client.deletePersonalAccessToken({
      name: args.name,
    });

    logger.success(`Personal access token "${args.name}" deleted successfully.`);
  },
});
