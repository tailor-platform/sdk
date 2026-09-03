import { z } from "zod";
import { paginationArgs, toPageDirection } from "#/cli/shared/args";
import { fetchPaged } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { humanizeRelativeTime } from "#/cli/shared/format";
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
    logger.out(patInfos, {
      display: {
        scopes: (value) => (value as string[]).join("/"),
        lastUsedAt: (value) => (value === null ? "never" : humanizeRelativeTime(value as Date)),
      },
    });
  },
});
