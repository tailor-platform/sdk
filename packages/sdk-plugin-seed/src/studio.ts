import {
  loadSeedContext,
  configArg,
  defineAppCommand,
  logger,
  arg,
} from "@tailor-platform/sdk/cli";
import open from "open";
import * as path from "pathe";
import { z } from "zod";
import {
  allDatasetsArg,
  assertDatasetSelection,
  datasetArg,
  noBaseArg,
  selectDatasets,
} from "./datasets";
import { assertSeedDataDirectory } from "./jsonl";
import type { DatasetSelection } from "./datasets";

export const seedStudioCommand = defineAppCommand({
  name: "studio",
  description: "Browse and edit JSONL seed data in the browser.",
  notes:
    "Starts a local web UI that lists the seed tables and edits them as a grid or a row form. " +
    "Changes stay pending until saved, and a value the table's schema rejects is not written, so " +
    "the saved files pass `tailor seed validate`. A save writes only the primary key the schema " +
    "generates, leaving values such as createdAt to be filled on create; --write-filled-values all " +
    "writes every filled value. " +
    "With --dataset, the rows of each dataset are shown on top of the base seed data and edits go " +
    "back to the file each row came from. The studio runs until it is stopped with Ctrl+C.",
  args: z.strictObject({
    ...configArg,
    ...datasetArg,
    ...allDatasetsArg,
    ...noBaseArg,
    port: arg(z.coerce.number().int().min(0).max(65535).default(4848), {
      alias: "p",
      description: "Port to listen on (0 picks a free one)",
    }),
    open: arg(z.boolean().default(false), {
      description: "Open the studio in the default browser",
    }),
    "write-filled-values": arg(z.enum(["all", "primaryKey"]).default("primaryKey"), {
      description:
        "Values the schema fills in that a save writes: all of them, or only a generated primary key",
      completion: { type: "none" },
    }),
    path: arg(z.string().optional(), {
      positional: true,
      description:
        "Directory of JSONL files to open (default: the data directory under the seedPlugin distPath)",
      completion: { type: "directory" },
    }),
  }),
  run: async (args) => {
    assertDatasetSelection(args.dataset, args["all-datasets"]);
    if (args.path && (args.dataset.length > 0 || args["all-datasets"] || args["no-base"])) {
      throw new Error("--dataset, --all-datasets and --no-base cannot be combined with a path.");
    }
    if (args["no-base"] && args.dataset.length === 0 && !args["all-datasets"]) {
      throw new Error("--no-base needs at least one --dataset or --all-datasets to open.");
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
    assertSeedDataDirectory(targetPath);

    const dataDirs = [...(args["no-base"] ? [] : [targetPath]), ...datasets.dirs];
    const { startStudioServer } = await import("@lines-db/studio");
    const studio = await startStudioServer({
      dataDir: dataDirs.length === 1 ? dataDirs[0] : dataDirs,
      ...(datasets.dirs.length > 0 ? { schemaDir: targetPath } : {}),
      port: args.port,
      writeFilledValues: args["write-filled-values"],
    }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      throw new Error(
        `Port ${args.port} is already in use. Pass --port <number> to use another one (0 picks a free port).`,
        { cause: error },
      );
    });

    if (args.json) {
      logger.out({
        url: studio.url,
        dataDir: targetPath,
        ...(datasets.names.length > 0 ? { datasets: datasets.names } : {}),
      });
    }
    logger.info(`Seed studio is running at ${studio.url}. Press Ctrl+C to stop.`);
    if (args.open) {
      try {
        await open(studio.url);
      } catch {
        logger.warn("Failed to open browser automatically. Please open the URL above manually.");
      }
    }
    await new Promise<void>((resolve) => {
      const stop = () => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        resolve();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
    await studio.close();
  },
});
