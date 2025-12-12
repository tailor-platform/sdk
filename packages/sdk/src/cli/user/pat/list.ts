import { defineCommand } from "citty";
import { consola } from "consola";
import ml from "multiline-ts";
import { commonArgs, jsonArgs, withCommonArgs } from "../../args";
import { fetchAll, initOperatorClient } from "../../client";
import { fetchLatestToken, readPlatformConfig } from "../../context";
import {
  parsePATFormat,
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
    const format = parsePATFormat(args.json);
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
      consola.info(ml`
        No personal access tokens found.
        Please create a token using 'tailor-sdk user pat create' command.
      `);
      return;
    }

    if (format === "text") {
      // Find the longest name for alignment
      const maxNameLength = Math.max(...pats.map((pat) => pat.name.length));

      // Display as simple list with right-aligned names: "name: scope1/scope2"
      pats.forEach((pat) => {
        const info = transformPersonalAccessToken(pat);
        const paddedName = info.name.padStart(maxNameLength);
        // Use console.log instead of consola.log to avoid timestamp
        console.log(`${paddedName}: ${info.scopes.join("/")}`);
      });
    } else {
      // JSON format with scopes as array
      const patInfos: PersonalAccessTokenInfo[] = pats.map(
        transformPersonalAccessToken,
      );
      console.log(JSON.stringify(patInfos));
    }
  }),
});
