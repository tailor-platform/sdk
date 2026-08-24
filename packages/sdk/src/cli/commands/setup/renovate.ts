import * as fs from "node:fs";
import {
  JsonArrayNode,
  JsonLexer,
  JsonObjectNode,
  JsonParser,
  JsonTokenType,
  reservedIdentifiers,
} from "@croct/json5-parser";
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
  /** JSONC or JSON5 represented as a lossless syntax tree. */
  | { kind: "appendable-json5"; location: string; filePath: string; config: Json5Config }
  /** Invalid config, or not a regular file; the `extends` array is unknown. */
  | { kind: "unreadable"; location: string; format: "JSON" | "JSON5" };

type Json5Config = {
  node: JsonObjectNode;
  reservedPropertyNames: ReadonlyMap<string, string>;
};

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
  if (config === null) return { kind: "unreadable", location, format: "JSON" };
  if (extendsPreset(config)) return { kind: "extends-preset", location };
  return { kind: "appendable", location, filePath, config };
}

const INSIGNIFICANT_JSON5_TOKENS = new Set([
  JsonTokenType.WHITESPACE,
  JsonTokenType.NEWLINE,
  JsonTokenType.LINE_COMMENT,
  JsonTokenType.BLOCK_COMMENT,
]);

const UNSUPPORTED_JSON5_PROPERTY_NAMES = new Set([...reservedIdentifiers, "Infinity", "NaN"]);

function normalizeReservedPropertyNames(source: string): {
  source: string;
  propertyNames: ReadonlyMap<string, string>;
} {
  const tokens = JsonLexer.tokenize(source);
  const tokenValues = new Set(tokens.map((token) => token.value));
  const propertyNames = new Map<string, string>();

  const normalized = tokens.map((token, index) => {
    if (!UNSUPPORTED_JSON5_PROPERTY_NAMES.has(token.value)) return token.value;
    let nextIndex = index + 1;
    let nextToken = tokens[nextIndex];
    while (nextToken !== undefined && INSIGNIFICANT_JSON5_TOKENS.has(nextToken.type)) {
      nextIndex++;
      nextToken = tokens[nextIndex];
    }
    if (tokens[nextIndex]?.type !== JsonTokenType.COLON) return token.value;

    let placeholder = propertyNames.get(token.value);
    if (placeholder === undefined) {
      placeholder = `$tailor_${token.value}`;
      while (tokenValues.has(placeholder)) placeholder += "_";
      tokenValues.add(placeholder);
      propertyNames.set(token.value, placeholder);
    }
    return placeholder;
  });

  return { source: normalized.join(""), propertyNames };
}

function restoreReservedPropertyNames(
  source: string,
  propertyNames: ReadonlyMap<string, string>,
): string {
  if (propertyNames.size === 0) return source;
  const originals = new Map([...propertyNames].map(([name, placeholder]) => [placeholder, name]));
  return JsonLexer.tokenize(source)
    .map((token) => originals.get(token.value) ?? token.value)
    .join("");
}

function readJson5Config(filePath: string): Json5Config | null {
  const entry = getPathEntry(filePath);
  if (entry === null || !entry.isFile()) return null;
  try {
    // The parser rejects some valid unquoted JSON5 property names.
    const normalized = normalizeReservedPropertyNames(fs.readFileSync(filePath, "utf-8"));
    return {
      node: JsonParser.parse(normalized.source, JsonObjectNode),
      reservedPropertyNames: normalized.propertyNames,
    };
  } catch {
    return null;
  }
}

function classifyJson5Config(
  location: string,
  filePath: string,
  config: Json5Config | null,
): ExistingConfig {
  if (config === null) return { kind: "unreadable", location, format: "JSON5" };
  const extendsKey = config.reservedPropertyNames.get("extends") ?? "extends";
  if (extendsPreset({ extends: config.node.toJSON()[extendsKey] })) {
    return { kind: "extends-preset", location };
  }
  return { kind: "appendable-json5", location, filePath, config };
}

function isJson5Config(location: string): boolean {
  return location.endsWith(".jsonc") || location.endsWith(".json5");
}

function findExistingConfig(outputDir: string): ExistingConfig | null {
  for (const file of RENOVATE_CONFIG_FILES) {
    const filePath = path.join(outputDir, file);
    if (!pathEntryExists(filePath)) continue;
    if (isJson5Config(file)) {
      return classifyJson5Config(file, filePath, readJson5Config(filePath));
    }
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
  const config = { ...existing.config, extends: [...(current ?? []), RENOVATE_PRESET] };

  const root =
    existing.location === "package.json#renovate"
      ? { ...(JSON.parse(source) as Record<string, unknown>), renovate: config }
      : config;

  const trailingNewline = source.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(
    existing.filePath,
    `${JSON.stringify(root, null, detectIndent(source))}${trailingNewline}`,
    "utf-8",
  );
}

function appendJson5Preset(existing: Extract<ExistingConfig, { kind: "appendable-json5" }>): void {
  const extendsKey = existing.config.reservedPropertyNames.get("extends") ?? "extends";
  const current = existing.config.node.toJSON()[extendsKey];
  if (current !== undefined && !Array.isArray(current)) {
    throw new Error(
      `Renovate config at "${existing.location}" has a non-array "extends". No files were changed. ` +
        `Add "${RENOVATE_PRESET}" to it manually.`,
    );
  }

  if (current === undefined) {
    existing.config.node.set("extends", [RENOVATE_PRESET]);
  } else {
    existing.config.node.get(extendsKey, JsonArrayNode).push(RENOVATE_PRESET);
  }
  fs.writeFileSync(
    existing.filePath,
    restoreReservedPropertyNames(
      existing.config.node.toString(),
      existing.config.reservedPropertyNames,
    ),
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
        `Found a Renovate config at "${existingConfig.location}" but could not parse it as ${existingConfig.format}. ` +
          `No files were changed. ` +
          `Check its extends array for "${RENOVATE_PRESET}" manually.`,
      );
    }
    if (existingConfig.kind === "appendable-json5") {
      appendJson5Preset(existingConfig);
      logger.success(`Added the Tailor preset to ${styles.path(existingConfig.location)}`);
      return;
    }
    appendPreset(existingConfig);
    logger.success(`Added the Tailor preset to ${styles.path(existingConfig.location)}`);
    return;
  }

  const outputPath = path.join(options.outputDir, RENOVATE_CONFIG_FILE);
  fs.writeFileSync(outputPath, renderRenovateConfig(), "utf-8");

  logger.success(`Generated ${styles.path(RENOVATE_CONFIG_FILE)}`);
}
