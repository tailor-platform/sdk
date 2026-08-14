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

type ExistingConfig =
  /** The config's `extends` already references the shared preset. */
  | { kind: "extends-preset"; location: string }
  /** Strict JSON, so the preset can be appended without losing comments. */
  | { kind: "appendable"; location: string; filePath: string; config: object }
  /** Not strict JSON, or not a regular file; the `extends` array is unknown. */
  | { kind: "unreadable"; location: string };

function extendsPreset(config: object): boolean {
  if (!("extends" in config)) return false;
  const value = config.extends;
  return Array.isArray(value) && value.includes(RENOVATE_PRESET);
}

function readJsonConfig(filePath: string): object | null {
  const entry = getPathEntry(filePath);
  if (entry === null || !entry.isFile()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
}

function classifyConfig(location: string, filePath: string, config: object | null): ExistingConfig {
  if (config === null) return { kind: "unreadable", location };
  if (extendsPreset(config)) return { kind: "extends-preset", location };
  return { kind: "appendable", location, filePath, config };
}

function findExistingConfig(outputDir: string): ExistingConfig | null {
  for (const file of RENOVATE_CONFIG_FILES) {
    const filePath = path.join(outputDir, file);
    if (!pathEntryExists(filePath)) continue;
    return classifyConfig(file, filePath, readJsonConfig(filePath));
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
    const renovate = packageJson.renovate;
    const config =
      typeof renovate === "object" && renovate !== null && !Array.isArray(renovate)
        ? renovate
        : null;
    return classifyConfig("package.json#renovate", packageJsonPath, config);
  }
  return null;
}

function detectIndent(source: string): number {
  return /^(?<indent>[ ]+)"/m.exec(source)?.groups?.indent?.length ?? 2;
}

function appendPreset(existing: Extract<ExistingConfig, { kind: "appendable" }>): void {
  const source = fs.readFileSync(existing.filePath, "utf-8");
  const current = "extends" in existing.config ? existing.config.extends : undefined;
  if (current !== undefined && !Array.isArray(current)) {
    throw new Error(
      `Renovate config at "${existing.location}" has a non-array "extends". No files were changed. ` +
        `Add "${RENOVATE_PRESET}" to it manually.`,
    );
  }
  const extendsArray = [...(current ?? []), RENOVATE_PRESET];

  const root = JSON.parse(source) as Record<string, unknown>;
  if (existing.location === "package.json#renovate") {
    root.renovate = { ...existing.config, extends: extendsArray };
  } else {
    Object.assign(root, { ...existing.config, extends: extendsArray });
  }

  const trailingNewline = source.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(
    existing.filePath,
    `${JSON.stringify(root, null, detectIndent(source))}${trailingNewline}`,
    "utf-8",
  );
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
    if (existingConfig.kind === "extends-preset") {
      logger.info(`Renovate is already set up at ${styles.path(existingConfig.location)}.`);
      return;
    }
    if (existingConfig.kind === "unreadable") {
      throw new Error(
        `Found a Renovate config at "${existingConfig.location}" but could not parse it as JSON. ` +
          `Comment-containing JSON5/JSONC configs are not supported yet. No files were changed. ` +
          `Check its extends array for "${RENOVATE_PRESET}" manually.`,
      );
    }
    appendPreset(existingConfig);
    logger.success(`Added the Tailor preset to ${styles.path(existingConfig.location)}`);
    return;
  }

  const outputPath = path.join(options.outputDir, RENOVATE_CONFIG_FILE);
  fs.writeFileSync(outputPath, renderRenovateConfig(), "utf-8");

  logger.success(`Generated ${styles.path(RENOVATE_CONFIG_FILE)}`);
}
