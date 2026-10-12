import * as fs from "node:fs";
import { loadConfig } from "@tailor-platform/sdk/cli";
import * as path from "pathe";

/** The seedPlugin settings a seeding workflow depends on. */
export type SeedSettings = {
  machineUserName?: string;
  /** Names of the dataset combinations in the seedPlugin `datasets` option. */
  datasets: Record<string, unknown>;
  /** Absolute path of `<distPath>/data`, resolved against the app directory. */
  dataDir: string;
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
  const distPath = typeof options.distPath === "string" ? options.distPath : "";
  return {
    machineUserName:
      typeof options.machineUserName === "string" ? options.machineUserName : undefined,
    datasets:
      typeof options.datasets === "object" && options.datasets !== null
        ? (options.datasets as Record<string, unknown>)
        : {},
    dataDir: path.resolve(path.dirname(configPath), distPath, "data"),
  };
}

function isDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
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
  const unknown = datasets.find(
    (dataset) =>
      !Object.hasOwn(settings.datasets, dataset) &&
      !isDirectory(path.join(settings.dataDir, dataset)),
  );
  if (unknown === undefined) return undefined;
  return (
    `Unknown seed dataset "${unknown}". ` +
    `Datasets in seedPlugin options: ${Object.keys(settings.datasets).join(", ") || "(none)"}. ` +
    `It is not a directory in ${settings.dataDir} either.`
  );
}
