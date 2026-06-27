import { arg } from "politty";
import { z } from "zod";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { fetchLatestToken, readPlatformConfig } from "#/cli/shared/context";
import { assertWritable } from "#/cli/shared/readonly-guard";
import ml from "#/utils/multiline";
import { getScopesFromWriteFlag, printCreatedToken } from "./transform";

export const updateCommand = defineAppCommand({
  name: "update",
  description: "Update a personal access token (delete and recreate).",
  args: z.strictObject({
    name: arg(z.string(), {
      positional: true,
      description: "Token name",
    }),
    write: arg(z.boolean().default(false), {
      alias: "W",
      description: "Grant write permission (if not specified, keeps read-only)",
    }),
  }),
  run: async (args) => {
    await assertWritable();
    const config = await readPlatformConfig();

    if (!config.current_user) {
      throw new Error(ml`
        No user logged in.
        Please login first using 'tailor login' command.
      `);
    }

    const { accessToken: token } = await fetchLatestToken(config, config.current_user);
    const client = await initOperatorClient(token);

    // Delete the existing token
    await client.deletePersonalAccessToken({
      name: args.name,
    });

    // Create a new token with the same name
    const scopes = getScopesFromWriteFlag(args.write);
    const result = await client.createPersonalAccessToken({
      name: args.name,
      scopes,
    });

    if (!result.accessToken) {
      throw new Error("Failed to create personal access token");
    }

    printCreatedToken(args.name, result.accessToken, args.write, "updated");
  },
});
