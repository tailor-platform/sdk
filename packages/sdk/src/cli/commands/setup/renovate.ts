import * as fs from "node:fs";
import * as path from "pathe";
import { logBetaWarning } from "#/cli/shared/beta";
import { logger, styles } from "#/cli/shared/logger";

export const RENOVATE_CONFIG_FILE = "renovate.json";
export const RENOVATE_PRESET = "github>tailor-inc/renovate-config";

const RENOVATE_CONFIG_FILES = [
  RENOVATE_CONFIG_FILE,
  "renovate.jsonc",
  "renovate.json5",
  ".github/renovate.json",
  ".github/renovate.jsonc",
  ".github/renovate.json5",
  ".gitlab/renovate.json",
  ".gitlab/renovate.jsonc",
  ".gitlab/renovate.json5",
  ".renovaterc",
  ".renovaterc.json",
  ".renovaterc.jsonc",
  ".renovaterc.json5",
] as const;

export type SetupRenovateOptions = {
  outputDir: string;
};

function getPathEntry(filePath: string): fs.Stats | null {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function pathEntryExists(filePath: string): boolean {
  return getPathEntry(filePath) !== null;
}

type ExistingConfig = {
  /** Location shown to the user; not always a readable JSON file path. */
  location: string;
  /** True when the config's `extends` already references the shared preset. */
  extendsPreset: boolean;
};

function extendsPreset(config: unknown): boolean {
  if (typeof config !== "object" || config === null || !("extends" in config)) return false;
  const value = config.extends;
  return Array.isArray(value) && value.includes(RENOVATE_PRESET);
}

function readJsonConfig(filePath: string): unknown {
  const entry = getPathEntry(filePath);
  if (entry === null || !entry.isFile()) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function findExistingConfig(outputDir: string): ExistingConfig | null {
  for (const file of RENOVATE_CONFIG_FILES) {
    const filePath = path.join(outputDir, file);
    if (!pathEntryExists(filePath)) continue;
    return { location: file, extendsPreset: extendsPreset(readJsonConfig(filePath)) };
  }

  const packageJsonPath = path.join(outputDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) return null;
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  } catch (cause) {
    throw new Error("package.json is not valid JSON; could not inspect its Renovate config.", {
      cause,
    });
  }
  if (typeof packageJson === "object" && packageJson !== null && "renovate" in packageJson) {
    return {
      location: "package.json#renovate",
      extendsPreset: extendsPreset(packageJson.renovate),
    };
  }
  return null;
}

function renderRenovateConfig(): string {
  return `${JSON.stringify(
    {
      $schema: "https://docs.renovatebot.com/renovate-schema.json",
      extends: [RENOVATE_PRESET],
    },
    null,
    2,
  )}\n`;
}

/**
 * Generate a repository-level Renovate config that extends Tailor's shared preset.
 * @param options - Renovate setup options
 */
export async function setupRenovate(options: SetupRenovateOptions): Promise<void> {
  logBetaWarning("setup");

  const existingConfig = findExistingConfig(options.outputDir);
  if (existingConfig !== null) {
    if (existingConfig.extendsPreset) {
      logger.info(`Renovate is already set up at ${styles.path(existingConfig.location)}.`);
      return;
    }
    throw new Error(
      `Renovate config already exists at "${existingConfig.location}". No files were changed. ` +
        `Add "${RENOVATE_PRESET}" to its extends array.`,
    );
  }

  const outputPath = path.join(options.outputDir, RENOVATE_CONFIG_FILE);
  fs.writeFileSync(outputPath, renderRenovateConfig(), "utf-8");

  logger.success(`Generated ${styles.path(RENOVATE_CONFIG_FILE)}`);
}
