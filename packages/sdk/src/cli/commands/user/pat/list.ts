import { z } from "zod";
import { paginationArgs, toPageDirection } from "#/cli/shared/args";
import { fetchPaged, initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import {
  fetchLatestToken,
  loadPlatformClientConfig,
  readPlatformConfig,
} from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import ml from "#/utils/multiline";
import { transformPersonalAccessToken, type PersonalAccessTokenInfo } from "./transform";
import { resolvePatUser } from "./user";

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all personal access tokens.",
  args: z.object({ ...paginationArgs() }).strict(),
  run: async (args) => {
    const jsonOutput = logger.jsonMode;
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
