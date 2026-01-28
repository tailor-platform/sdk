import ml from "multiline-ts";
import { defineCommand, arg } from "politty";
import { z } from "zod";
import { commonArgs, jsonArgs, withCommonArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { fetchLatestToken, readPlatformConfig } from "../../context";
import { getScopesFromWriteFlag, printCreatedToken } from "./transform";

export const createCommand = defineCommand({
  name: "create",
  description: "Create new personal access token",
  args: z.object({
    ...commonArgs,
    ...jsonArgs,
    name: arg(z.string(), { positional: true, description: "Token name" }),
    write: arg(z.boolean().default(false), {
      alias: "W",
      description: "Grant write permission (default: read-only)",
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

    const scopes = getScopesFromWriteFlag(args.write);
    const result = await client.createPersonalAccessToken({
      name: args.name,
      scopes,
    });

    if (!result.accessToken) {
      throw new Error("Failed to create personal access token");
    }

    printCreatedToken(args.name, result.accessToken, args.write, "created");
  }),
});
