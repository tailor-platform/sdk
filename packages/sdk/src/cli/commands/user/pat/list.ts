import { z } from "zod";
import { paginationArgs, toPageDirection } from "#src/cli/shared/args";
import { fetchPaged, initOperatorClient } from "#src/cli/shared/client";
import { defineAppCommand } from "#src/cli/shared/command";
import { fetchLatestToken, readPlatformConfig } from "#src/cli/shared/context";
import { logger } from "#src/cli/shared/logger";
import ml from "#src/utils/multiline";
import { transformPersonalAccessToken, type PersonalAccessTokenInfo } from "./transform";

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all personal access tokens.",
  args: z.object({ ...paginationArgs() }).strict(),
  run: async (args) => {
    const jsonOutput = logger.jsonMode;
    const config = await readPlatformConfig();

    if (!config.current_user) {
      throw new Error(ml`
        No user logged in.
        Please login first using 'tailor-sdk login' command.
      `);
    }

    const token = await fetchLatestToken(config, config.current_user);
    const client = await initOperatorClient(token);

    const pageDirection = toPageDirection(args.order);
    const pats = await fetchPaged(
      async (pageToken, pageSize) => {
        const { personalAccessTokens, nextPageToken } = await client.listPersonalAccessTokens({
          pageToken,
          pageSize,
          pageDirection,
        });
        return [personalAccessTokens, nextPageToken];
      },
      { limit: args.limit },
    );

    if (pats.length === 0) {
      logger.info(ml`
        No personal access tokens found.
        Please create a token using 'tailor-sdk user pat create' command.
      `);
      if (!jsonOutput) {
        return;
      }
    }

    const patInfos: PersonalAccessTokenInfo[] = pats.map(transformPersonalAccessToken);
    if (jsonOutput) {
      logger.out(patInfos);
      return;
    }

    // Text format: aligned list "name: scope1/scope2"
    const maxNameLength = Math.max(...pats.map((pat) => pat.name.length));

    pats.forEach((pat) => {
      const info = transformPersonalAccessToken(pat);
      const paddedName = info.name.padStart(maxNameLength);
      logger.log(`${paddedName}: ${info.scopes.join("/")}`);
    });
  },
});
