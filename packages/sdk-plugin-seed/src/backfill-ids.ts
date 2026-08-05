import { loadSeedContext } from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { configArg } from "./shared/args";
import { defineAppCommand } from "./shared/command";
import { logger } from "./shared/logger";

export const seedBackfillIdsCommand = defineAppCommand({
  name: "backfill-ids",
  description:
    "Backfill missing `id` values into JSONL seed data.\n" +
    "Only the `id` field is written back; every other field keeps the value its line already had.\n" +
    "The ids are newly generated and cannot match rows an earlier `apply` already created, " +
    "so backfill before the data is first applied (or reseed with `apply --truncate`).",
  args: z.strictObject({
    ...configArg,
    path: arg(z.string().optional(), {
      positional: true,
      description:
        "Data directory to backfill (default: the data directory under the seedPlugin distPath)",
      completion: { type: "directory" },
    }),
  }),
  run: async (args) => {
    const { backfillSeedIds } = await import("@tailor-platform/sdk/seed");

    let targetPath: string;
    if (args.path) {
      targetPath = path.resolve(process.cwd(), args.path);
    } else {
      const context = await loadSeedContext({ configPath: args.config });
      targetPath = path.join(context.distPath, "data");
    }

    const result = await backfillSeedIds({ path: targetPath, verbose: args.verbose });
    if (result.output) {
      logger.log(result.output);
    }
    if (args.json) {
      logger.out({ backfilled: result.backfilled, path: targetPath });
    }
  },
});
