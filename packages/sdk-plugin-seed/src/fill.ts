import {
  loadSeedContext,
  configArg,
  defineAppCommand,
  logger,
  arg,
} from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { z } from "zod";
import { datasetArg, selectDatasets } from "./datasets";

export const seedFillCommand = defineAppCommand({
  name: "fill",
  description: "Fill in the values a record gets on create for JSONL seed data rows missing them.",
  notes:
    "The values come from the table itself, and nothing is validated, so rows can be filled while the " +
    "data around them is still incomplete — run `tailor seed validate` when it is ready. A value " +
    "already in the file is never replaced, and a line that gains nothing is left byte for byte as " +
    "it was. A field the table gives no value to is skipped, so one field list covers a whole data " +
    "directory. With --dataset, only the files of the selected datasets are filled.",
  args: z.strictObject({
    ...configArg,
    ...datasetArg,
    fields: arg(z.string().default("id"), {
      alias: "f",
      description: "Comma-separated fields to fill",
      completion: { type: "none" },
    }),
    path: arg(z.string().optional(), {
      positional: true,
      description:
        "File or directory to fill (default: the data directory under the seedPlugin distPath)",
      completion: { type: "file", extensions: ["jsonl"] },
    }),
  }),
  run: async (args) => {
    const { fillSeedData } = await import("@tailor-platform/sdk/seed");

    const fields = args.fields
      .split(",")
      .map((field) => field.trim())
      .filter(Boolean);
    if (fields.length === 0) {
      throw new Error("--fields needs at least one field name.");
    }
    if (args.path && args.dataset.length > 0) {
      throw new Error("--dataset cannot be combined with a path.");
    }

    if (args.path || args.dataset.length === 0) {
      const targetPath = args.path
        ? path.resolve(process.cwd(), args.path)
        : path.join((await loadSeedContext({ configPath: args.config })).distPath, "data");
      const result = await fillSeedData({ path: targetPath, fields });
      if (result.output) {
        logger.log(result.output);
      }
      if (args.json) {
        logger.out({ path: targetPath, filled: result.filled });
      }
      return;
    }

    const context = await loadSeedContext({ configPath: args.config });
    const dataDir = path.join(context.distPath, "data");
    const datasets = selectDatasets(context, args.dataset);
    const filled = [];
    for (const dir of datasets.dirs) {
      const result = await fillSeedData({ path: dir, fields, schemaDir: dataDir });
      if (result.output) {
        logger.log(result.output);
      }
      filled.push(...result.filled);
    }
    if (args.json) {
      logger.out({ path: dataDir, datasets: datasets.names, filled });
    }
  },
});
