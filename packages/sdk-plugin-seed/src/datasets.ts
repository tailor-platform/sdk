import { readdirSync, realpathSync, statSync } from "node:fs";
import { arg } from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { z } from "zod";
import { seedableEntities } from "./entities";
import { assertSeedDataDirectory } from "./jsonl";
import type { SeedContext } from "@tailor-platform/sdk/cli";

const DATASET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const datasetArg = {
  dataset: arg(z.array(z.string()).default([]), {
    description:
      "Dataset to use on top of the base seed data: a directory under the seed data directory, or a name from the seedPlugin datasets option (repeatable, applied in order)",
    completion: { type: "none" },
  }),
};

export const noBaseArg = {
  "no-base": arg(z.boolean().default(false), {
    description: "Leave out the base seed data, using only the selected datasets",
  }),
};

/**
 * Datasets selected for a run, in the order their rows apply.
 */
export interface DatasetSelection {
  /** Dataset directory names */
  names: string[];
  /** Absolute dataset directory paths, matching `names` */
  dirs: string[];
}

function assertDatasetName(name: string): void {
  if (!DATASET_NAME_PATTERN.test(name)) {
    throw new Error(
      `"${name}" is not a valid dataset name. ` +
        "Use letters, digits, `-` and `_`, starting with a letter or digit.",
    );
  }
}

function datasetCombinations(context: SeedContext): Record<string, readonly string[]> {
  // An @tailor-platform/sdk older than this plugin's peer range loads no `datasets`.
  const { datasets } = context as Partial<SeedContext>;
  if (!datasets) {
    throw new Error(
      "The installed @tailor-platform/sdk does not support seed datasets. " +
        "Update it to the version @tailor-platform/sdk-plugin-seed requires.",
    );
  }
  return datasets;
}

function isDirectory(entryPath: string): boolean {
  try {
    return statSync(entryPath).isDirectory();
  } catch {
    return false;
  }
}

function listDatasetDirectories(dataDir: string): string[] {
  assertSeedDataDirectory(dataDir);
  return readdirSync(dataDir)
    .filter((entry) => DATASET_NAME_PATTERN.test(entry))
    .filter((entry) => isDirectory(path.join(dataDir, entry)))
    .toSorted();
}

function seededTables(context: SeedContext): Set<string> {
  return new Set(
    seedableEntities(
      context.namespaces.flatMap((namespace) => namespace.types),
      context.idpUser !== null,
    ),
  );
}

function assertDatasetTables(dirs: readonly string[], tables: Set<string>): void {
  const unknown = dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((entry) => entry.endsWith(".jsonl") && !tables.has(path.basename(entry, ".jsonl")))
      .map((entry) => path.join(dir, entry)),
  );
  if (unknown.length > 0) {
    throw new Error(
      `${unknown.map((file) => `${file} does not match a seeded table.`).join("\n")} ` +
        "A dataset file is named after the table it seeds, like the files in the seed data directory.",
    );
  }
}

/**
 * Resolve the `--dataset` names of a run to dataset directories under
 * `<distPath>/data/`. A name configured in the seedPlugin `datasets` option
 * stands for the directories it lists; any other name is a directory itself.
 * A directory named more than once is read once, where it is first named.
 * @param context - Seed context of the project
 * @param requested - Dataset names in the order they were given
 * @returns The selected dataset directories
 */
export function selectDatasets(
  context: SeedContext,
  requested: readonly string[],
): DatasetSelection {
  if (requested.length === 0) {
    return { names: [], dirs: [] };
  }
  const combinations = datasetCombinations(context);
  const dataDir = path.join(context.distPath, "data");
  const directories = listDatasetDirectories(dataDir);
  const collision = Object.keys(combinations).find((name) => directories.includes(name));
  if (collision) {
    throw new Error(
      `"${collision}" names both a dataset in seedPlugin options and the directory ` +
        `${path.join(dataDir, collision)}. Rename one of them.`,
    );
  }

  const names = requested.flatMap((name) => {
    assertDatasetName(name);
    const combination = Object.hasOwn(combinations, name) ? combinations[name] : undefined;
    if (!combination) {
      if (directories.includes(name)) {
        return [name];
      }
      throw new Error(
        `Unknown dataset "${name}". ` +
          `Datasets in seedPlugin options: ${Object.keys(combinations).join(", ") || "(none)"}. ` +
          `Dataset directories in ${dataDir}: ${directories.join(", ") || "(none)"}.`,
      );
    }
    for (const entry of combination) {
      if (!directories.includes(entry)) {
        throw new Error(
          `Dataset "${name}" in seedPlugin options lists "${entry}", ` +
            `but ${path.join(dataDir, entry)} is not a directory.`,
        );
      }
    }
    return [...combination];
  });

  const selection: DatasetSelection = { names: [], dirs: [] };
  const seen = new Set<string>();
  for (const name of names) {
    const dir = path.join(dataDir, name);
    const realDir = realpathSync(dir);
    if (seen.has(realDir)) continue;
    seen.add(realDir);
    selection.names.push(name);
    selection.dirs.push(dir);
  }
  assertDatasetTables(selection.dirs, seededTables(context));
  return selection;
}

/**
 * Directory `tailor seed dump --dataset <name>` writes into, which need not
 * exist yet.
 * @param context - Seed context of the project
 * @param name - Dataset directory name
 * @returns Absolute path of the dataset directory
 */
export function datasetDumpDirectory(context: SeedContext, name: string): string {
  assertDatasetName(name);
  if (Object.hasOwn(datasetCombinations(context), name)) {
    throw new Error(
      `"${name}" names a dataset in seedPlugin options, which may list several directories. ` +
        "Dump into a dataset directory name instead.",
    );
  }
  return path.join(context.distPath, "data", name);
}
