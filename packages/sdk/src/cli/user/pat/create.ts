import { defineCommand } from "citty";
import ml from "multiline-ts";
import { commonArgs, jsonArgs, withCommonArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { fetchLatestToken, readPlatformConfig } from "../../context";
import { getScopesFromWriteFlag, printCreatedToken } from "./transform";

export const createCommand = defineCommand({
  meta: {
    name: "create",
    description: "Create new personal access token",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
    name: {
      type: "positional",
      description: "Token name",
      required: true,
    },
    write: {
      type: "boolean",
      description: "Grant write permission (default: read-only)",
      alias: "W",
      default: false,
    },
  },
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

    printCreatedToken(args.name, result.accessToken, args.write, "created", args.json);
  }),
});
