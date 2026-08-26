import { z } from "zod";
import { paginationArgs, toPageDirection } from "#/cli/shared/args";
import { fetchPaged } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import ml from "#/utils/multiline";
import { transformPersonalAccessToken, type PersonalAccessTokenInfo } from "./transform";
import { createPatOperatorClient } from "./user";

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all personal access tokens.",
  args: z.strictObject({ ...paginationArgs() }),
  run: async (args) => {
    const jsonOutput = logger.jsonMode;
    const client = await createPatOperatorClient();

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
        Please create a token using 'tailor user pat create' command.
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
