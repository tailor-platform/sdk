import * as fs from "node:fs";
import { loadConfig } from "@tailor-platform/sdk/cli";
import * as path from "pathe";

/** The seedPlugin settings a seeding workflow depends on. */
export type SeedSettings = {
  machineUserName?: string;
  /** Names of the dataset combinations in the seedPlugin `datasets` option. */
  datasets: Record<string, unknown>;
  /** Absolute path of `<distPath>/data`, resolved against the app directory; unset without distPath. */
  dataDir?: string;
};

/** Dataset names `--seed-dataset` accepts; they need no shell quoting in the generated step. */
export const SEED_DATASET_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Read the seedPlugin settings of an app's config.
 * @param configPath - Absolute path to the app's tailor.config.ts
 * @returns The settings, or null when the config does not use seedPlugin
 */
export async function defaultLoadSeedSettings(configPath: string): Promise<SeedSettings | null> {
  const { plugins } = await loadConfig(configPath);
  const seedPlugin = plugins.find((p) => p.id === "@tailor-platform/seed");
  if (!seedPlugin) return null;
  const options = (seedPlugin.pluginConfig ?? {}) as {
    distPath?: unknown;
    machineUserName?: unknown;
    datasets?: unknown;
  };
  return {
    machineUserName:
      typeof options.machineUserName === "string" ? options.machineUserName : undefined,
    datasets:
      typeof options.datasets === "object" && options.datasets !== null
        ? (options.datasets as Record<string, unknown>)
        : {},
    dataDir:
      typeof options.distPath === "string" && options.distPath !== ""
        ? path.resolve(path.dirname(configPath), options.distPath, "data")
        : undefined,
  };
}

function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

// Exact names, as `tailor seed` matches them, so a case-insensitive file system cannot pass a misspelling.
function datasetDirectories(dataDir: string): Set<string> {
  try {
    return new Set(
      fs.readdirSync(dataDir).filter((entry) => isDirectory(path.join(dataDir, entry))),
    );
  } catch {
    return new Set();
  }
}

/**
 * Explain why a workflow cannot seed with these settings.
 * @param datasets - The `--seed-dataset` names
 * @param settings - The app's seedPlugin settings, or null without seedPlugin
 * @returns The reason, or undefined when seeding can run
 */
export function seedSettingsProblem(
  datasets: readonly string[],
  settings: SeedSettings | null,
): string | undefined {
  if (!settings) {
    return "--seed needs seedPlugin from @tailor-platform/sdk/plugin/seed in tailor.config.ts.";
  }
  if (!settings.machineUserName) {
    return (
      "--seed needs the machineUserName option of seedPlugin to know which machine user " +
      "seeds the workspace."
    );
  }
  const { dataDir } = settings;
  if (dataDir === undefined) {
    return "--seed needs the distPath option of seedPlugin to find the seed data.";
  }
  const directories = datasetDirectories(dataDir);
  for (const dataset of datasets) {
    if (!Object.hasOwn(settings.datasets, dataset)) {
      if (directories.has(dataset)) continue;
      return (
        `Unknown seed dataset "${dataset}". ` +
        `Datasets in seedPlugin options: ${Object.keys(settings.datasets).join(", ") || "(none)"}. ` +
        `It is not a directory in ${dataDir} either.`
      );
    }
    const entries = settings.datasets[dataset];
    const missing = (Array.isArray(entries) ? entries : []).find(
      (entry) => typeof entry !== "string" || !directories.has(entry),
    );
    if (missing !== undefined) {
      return (
        `Dataset "${dataset}" in seedPlugin options lists "${String(missing)}", ` +
        `but ${path.join(dataDir, String(missing))} is not a directory.`
      );
    }
  }
  return undefined;
}
