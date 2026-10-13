import {
  loadSeedContext,
  configArg,
  defineAppCommand,
  logger,
  arg,
} from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { z } from "zod";
import { allDatasetsArg, assertDatasetSelection, selectDatasets } from "./datasets";
import type { DatasetSelection } from "./datasets";

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
    ...allDatasetsArg,
    dataset: arg(z.array(z.string()).default([]), {
      description:
        "Dataset whose files to fill instead of the base seed data: a directory under the seed data directory, or a name from the seedPlugin datasets option (repeatable)",
      completion: { type: "none" },
    }),
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
    assertDatasetSelection(args.dataset, args["all-datasets"]);
    if (args.path && (args.dataset.length > 0 || args["all-datasets"])) {
      throw new Error("--dataset and --all-datasets cannot be combined with a path.");
    }

    let targetPath: string;
    let datasets: DatasetSelection = { names: [], dirs: [] };
    if (args.path) {
      targetPath = path.resolve(process.cwd(), args.path);
    } else {
      const context = await loadSeedContext({ configPath: args.config });
      targetPath = path.join(context.distPath, "data");
      datasets = selectDatasets(context, args.dataset, args["all-datasets"]);
    }

    const targets =
      datasets.dirs.length > 0
        ? datasets.dirs.map((dir, index) => ({ path: dir, dataset: datasets.names[index] }))
        : [{ path: targetPath, dataset: undefined }];
    const filled = [];
    for (const target of targets) {
      if (target.dataset) {
        logger.info(`Filling dataset ${target.dataset}`);
      }
      const result = await fillSeedData({
        path: target.path,
        fields,
        ...(target.dataset ? { schemaDir: targetPath } : {}),
      });
      if (result.output) {
        logger.log(result.output);
      }
      filled.push(...result.filled);
    }
    if (args.json) {
      logger.out({
        path: targetPath,
        ...(datasets.names.length > 0 ? { datasets: datasets.names } : {}),
        filled,
      });
    }
  },
});
