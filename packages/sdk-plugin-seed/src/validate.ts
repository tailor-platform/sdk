import {
  arg,
  configArg,
  defineAppCommand,
  loadSeedContext,
  logger,
  withSourceLocation,
} from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { z } from "zod";
import {
  allDatasetsArg,
  assertDatasetSelection,
  datasetArg,
  noBaseArg,
  selectDatasets,
} from "./datasets";
import { assertNoSharedTableFileUnderItsOwnName, entityNameOf } from "./entity-names";
import { assertSeedDataDirectory, loadSeedData } from "./jsonl";
import type { DatasetSelection } from "./datasets";

export const seedValidateCommand = defineAppCommand({
  name: "validate",
  description: "Validate JSONL seed data against generated schema definitions.",
  notes:
    "With --dataset, the rows of each dataset are validated on top of the base seed data, so " +
    "foreign keys resolve across them and an id defined in two of them is reported. " +
    "With --upsert, TailorDB rows must also supply an id and the required fields checked by seed apply --upsert. " +
    "--upsert uses the configured seed data and cannot be combined with a path.",
  args: z.strictObject({
    ...configArg,
    ...datasetArg,
    ...allDatasetsArg,
    ...noBaseArg,
    upsert: arg(z.boolean().default(false), {
      description: "Also check the id and required fields needed by seed apply --upsert",
    }),
    path: arg(z.string().optional(), {
      positional: true,
      description:
        "File or directory to validate (default: the data directory under the seedPlugin distPath)",
      completion: { type: "file", extensions: ["jsonl"] },
    }),
  }),
  run: async (args) => {
    const { validateSeedData } = await import("./seed-data");

    assertDatasetSelection(args.dataset, args["all-datasets"]);
    if (args.path && (args.dataset.length > 0 || args["all-datasets"] || args["no-base"])) {
      throw new Error("--dataset, --all-datasets and --no-base cannot be combined with a path.");
    }
    if (args.path && args.upsert) {
      throw new Error("--upsert cannot be combined with a path. Use the configured seed data.");
    }
    if (args["no-base"] && args.dataset.length === 0 && !args["all-datasets"]) {
      throw new Error("--no-base needs at least one --dataset or --all-datasets to validate.");
    }

    let targetPath: string;
    let datasets: DatasetSelection = { names: [], dirs: [] };
    if (args.path) {
      targetPath = path.resolve(process.cwd(), args.path);
    } else {
      const context = await loadSeedContext({
        configPath: args.config,
        allowSharedTableNames: true,
      });
      targetPath = path.join(context.distPath, "data");
      datasets = selectDatasets(context, args.dataset, args["all-datasets"]);
      assertNoSharedTableFileUnderItsOwnName(context, targetPath);
      if (args.upsert) {
        assertSeedDataDirectory(targetPath);
        const dataDirs = [...(args["no-base"] ? [] : [targetPath]), ...datasets.dirs];
        for (const namespace of context.namespaces) {
          loadSeedData(
            dataDirs,
            namespace.types.map((type) => entityNameOf(namespace, type)),
            {
              requireId: true,
              requiredFieldsByType: Object.fromEntries(
                Object.entries(namespace.requiredFields).map(([type, fields]) => [
                  entityNameOf(namespace, type),
                  fields,
                ]),
              ),
              warnAboutStrayWhitespace: false,
            },
          );
        }
      }
    }

    const result = await validateSeedData({
      path: targetPath,
      datasetDirs: datasets.dirs,
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
        ...(datasets.names.length > 0 ? { datasets: datasets.names } : {}),
      });
    }
    if (!result.valid) {
      // The report already carries its own markers, and `format()` is what keeps
      // the CLI from printing an error marker in front of them.
      const error = new Error(result.error) as Error & { format: () => string };
      error.format = () => result.error;
      throw result.location ? withSourceLocation(error, result.location) : error;
    }
  },
});
