import * as fs from "node:fs";
import * as path from "pathe";
import { logBetaWarning } from "#/cli/shared/beta";
import { logger, styles } from "#/cli/shared/logger";
import { LOCK_VERSION, readLock, writeLock } from "./lock";

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

function pathEntryExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function findExistingConfig(outputDir: string): string | null {
  for (const file of RENOVATE_CONFIG_FILES) {
    if (pathEntryExists(path.join(outputDir, file))) return file;
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
  if (
    typeof packageJson === "object" &&
    packageJson !== null &&
    Object.hasOwn(packageJson, "renovate")
  ) {
    return "package.json#renovate";
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

  const lock = readLock(options.outputDir);
  const registration = lock?.setups[0];
  const outputPath = path.join(options.outputDir, RENOVATE_CONFIG_FILE);
  if (registration && fs.existsSync(outputPath)) {
    logger.info(`Renovate is already set up at ${styles.path(RENOVATE_CONFIG_FILE)}.`);
    return;
  }

  const existingConfig = findExistingConfig(options.outputDir);
  if (existingConfig !== null) {
    throw new Error(
      `Renovate config already exists at "${existingConfig}". No files were changed. ` +
        `Add "${RENOVATE_PRESET}" to its extends array.`,
    );
  }

  fs.writeFileSync(outputPath, renderRenovateConfig(), "utf-8");
  const setups = [{ kind: "renovate" as const, file: RENOVATE_CONFIG_FILE }];
  writeLock(options.outputDir, {
    version: LOCK_VERSION,
    targets: lock?.targets ?? [],
    setups,
  });

  logger.success(`Generated ${styles.path(RENOVATE_CONFIG_FILE)}`);
  logger.success("Recorded Renovate setup in .github/tailor.lock");
}
