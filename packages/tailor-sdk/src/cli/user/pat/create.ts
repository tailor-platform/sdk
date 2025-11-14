import { defineCommand } from "citty";
import ml from "multiline-ts";
import { commonArgs, withCommonArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { fetchLatestToken, readPlatformConfig } from "../../context";
import {
  getScopesFromWriteFlag,
  parsePATFormat,
  patFormatArgs,
  printCreatedToken,
} from "./transform";

export const createCommand = defineCommand({
  meta: {
    name: "create",
    description: "Create new personal access token",
  },
  args: {
    ...commonArgs,
    ...patFormatArgs,
    name: {
      type: "positional",
      description: "Token name",
      required: true,
    },
    write: {
      type: "boolean",
      description: "Grant write permission (default: read-only)",
      default: false,
    },
  },
  run: withCommonArgs(async (args) => {
    const format = parsePATFormat(args.format);
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

    printCreatedToken(
      args.name,
      result.accessToken,
      args.write,
      format,
      "created",
    );
  }),
});
