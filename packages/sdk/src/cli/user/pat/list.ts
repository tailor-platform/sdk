import { defineCommand } from "citty";
import ml from "multiline-ts";
import { commonArgs, jsonArgs, withCommonArgs } from "../../args";
import { fetchAll, initOperatorClient } from "../../client";
import { fetchLatestToken, readPlatformConfig } from "../../context";
import { printData } from "../../format";
import { logger } from "../../utils/logger";
import {
  transformPersonalAccessToken,
  type PersonalAccessTokenInfo,
} from "./transform";

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List all personal access tokens",
  },
  args: {
    ...commonArgs,
    ...jsonArgs,
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

    const pats = await fetchAll(async (pageToken) => {
      const { personalAccessTokens, nextPageToken } =
        await client.listPersonalAccessTokens({
          pageToken,
        });
      return [personalAccessTokens, nextPageToken];
    });

    if (pats.length === 0) {
      logger.info(ml`
        No personal access tokens found.
        Please create a token using 'tailor-sdk user pat create' command.
      `);
      return;
    }

    if (args.json) {
      // JSON format with scopes as array
      const patInfos: PersonalAccessTokenInfo[] = pats.map(
        transformPersonalAccessToken,
      );
      printData(patInfos, args.json);
      return;
    }

    // Text format: aligned list "name: scope1/scope2"
    const maxNameLength = Math.max(...pats.map((pat) => pat.name.length));

    pats.forEach((pat) => {
      const info = transformPersonalAccessToken(pat);
      const paddedName = info.name.padStart(maxNameLength);
      logger.log(`${paddedName}: ${info.scopes.join("/")}`);
    });
  }),
});
