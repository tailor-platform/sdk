import * as sdkCli from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { z } from "zod";
import { datasetArg, noBaseArg, selectDatasets } from "./datasets";

const { loadSeedContext, configArg, defineAppCommand, logger, arg } = sdkCli;

// `withSourceLocation` reached the CLI surface in a release this plugin's peer
// range still opens below, so an older SDK resolves without it.
function attachSourceLocation(error: Error, location: sdkCli.ErrorSourceLocation): Error {
  const { withSourceLocation } = sdkCli as Partial<typeof sdkCli>;
  return typeof withSourceLocation === "function" ? withSourceLocation(error, location) : error;
}

export const seedValidateCommand = defineAppCommand({
  name: "validate",
  description: "Validate JSONL seed data against generated schema definitions.",
  notes:
    "With --dataset, the rows of each dataset are validated on top of the base seed data, so " +
    "foreign keys resolve across them and an id defined in two of them is reported. A path to a " +
    "dataset directory, or to a file in one, is validated on top of the base seed data as well.",
  args: z.strictObject({
    ...configArg,
    ...datasetArg,
    ...noBaseArg,
    path: arg(z.string().optional(), {
      positional: true,
      description:
        "File or directory to validate (default: the data directory under the seedPlugin distPath)",
      completion: { type: "file", extensions: ["jsonl"] },
    }),
  }),
  run: async (args) => {
    const { validateSeedData } = await import("@tailor-platform/sdk/seed");

    if (args.path && (args.dataset.length > 0 || args["no-base"])) {
      throw new Error("--dataset and --no-base cannot be combined with a path.");
    }
    if (args["no-base"] && args.dataset.length === 0) {
      throw new Error("--no-base needs at least one --dataset to validate.");
    }

    let targetPath: string;
    let datasets: string[] = [];
    let datasetDirs: string[] = [];
    if (args.path) {
      targetPath = path.resolve(process.cwd(), args.path);
    } else {
      const context = await loadSeedContext({ configPath: args.config });
      targetPath = path.join(context.distPath, "data");
      ({ names: datasets, dirs: datasetDirs } = selectDatasets(context, args.dataset));
    }

    const result = await validateSeedData({
      path: targetPath,
      datasetDirs,
      excludeBase: args["no-base"],
      verbose: args.verbose,
    });
    if (result.output) {
      logger.log(result.output);
    }
    if (args.json) {
      logger.out({
        valid: result.valid,
        path: targetPath,
        ...(datasets.length > 0 ? { datasets } : {}),
      });
    }
    if (!result.valid) {
      // The report already carries its own markers, and `format()` is what keeps
      // the CLI from printing an error marker in front of them.
      const error = new Error(result.error) as Error & { format: () => string };
      error.format = () => result.error;
      throw result.location ? attachSourceLocation(error, result.location) : error;
    }
  },
});
