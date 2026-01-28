import ml from "multiline-ts";
import { defineCommand, arg } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { fetchLatestToken, readPlatformConfig } from "../../context";
import { getScopesFromWriteFlag, printCreatedToken } from "./transform";

export const updateCommand = defineCommand({
  name: "update",
  description: "Update personal access token (delete and recreate)",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    name: arg(z.string(), { positional: true, description: "Token name" }),
    write: arg(z.boolean().default(false), {
      alias: "W",
      description: "Grant write permission (if not specified, keeps read-only)",
    }),
  }),
  run: withCommonArgs(async (args) => {
    const config = readPlatformConfig();

    if (!config.current_user) {
      throw new Error(ml`
        No user logged in.
        Please login first using 'tailor-sdk login' command.
      `);
    }

    const token = await fetchLatestToken(config, config.current_user);
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
  }),
});
