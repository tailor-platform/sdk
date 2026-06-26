import { arg } from "politty";
import { z } from "zod";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import {
  fetchLatestToken,
  loadPlatformClientConfig,
  readPlatformConfig,
} from "#/cli/shared/context";
import { assertWritable } from "#/cli/shared/readonly-guard";
import ml from "#/utils/multiline";
import { getScopesFromWriteFlag, printCreatedToken } from "./transform";
import { resolvePatUser } from "./user";

export const createCommand = defineAppCommand({
  name: "create",
  description: "Create a new personal access token.",
  args: z
    .object({
      name: arg(z.string(), {
        positional: true,
        description: "Token name",
      }),
      write: arg(z.boolean().default(false), {
        alias: "W",
        description: "Grant write permission (default: read-only)",
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

    const scopes = getScopesFromWriteFlag(args.write);
    const result = await client.createPersonalAccessToken({
      name: args.name,
      scopes,
    });

    if (!result.accessToken) {
      throw new Error("Failed to create personal access token");
    }

    printCreatedToken(args.name, result.accessToken, args.write, "created");
  },
});
