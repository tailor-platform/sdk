import * as fs from "node:fs";
import {
  JsonArrayNode,
  JsonLexer,
  JsonObjectNode,
  JsonParser,
  JsonTokenType,
  type JsonValueNode,
  reservedIdentifiers,
} from "@croct/json5-parser";
import JSON5 from "json5";
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
  | {
      kind: "appendable-lossless-json";
      location: string;
      filePath: string;
      config: LosslessJsonConfig;
    }
  /** Invalid config, or not a regular file; the `extends` array is unknown. */
  | { kind: "unreadable"; location: string; format: "JSON" | "JSONC" | "JSON5" };

type LosslessJsonConfig = {
  node: JsonObjectNode;
  parsed: object;
  tokenReplacements: ReadonlyMap<string, string>;
  valueReplacements: ReadonlyMap<string, string>;
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

function findNextSignificantToken(tokens: ReturnType<typeof JsonLexer.tokenize>, index: number) {
  let nextIndex = index + 1;
  let token = tokens[nextIndex];
  while (token !== undefined && INSIGNIFICANT_JSON5_TOKENS.has(token.type)) {
    nextIndex++;
    token = tokens[nextIndex];
  }
  return token;
}

function toConfigObject(value: unknown): object {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value;
  throw new Error("Expected a JSON object.");
}

function parseJsonc(source: string): object {
  const tokens = JsonLexer.tokenize(source);
  const json = tokens
    .map((token, index) => {
      if (token.type === JsonTokenType.LINE_COMMENT || token.type === JsonTokenType.BLOCK_COMMENT) {
        return " ";
      }
      if (token.type === JsonTokenType.COMMA) {
        const next = findNextSignificantToken(tokens, index);
        if (
          next?.type === JsonTokenType.BRACE_RIGHT ||
          next?.type === JsonTokenType.BRACKET_RIGHT
        ) {
          return "";
        }
      }
      return token.value;
    })
    .join("");
  const parsed: unknown = JSON.parse(json);
  return toConfigObject(parsed);
}

function hasDuplicateJsonProperties(node: JsonValueNode): boolean {
  if (node instanceof JsonArrayNode) {
    return node.elements.some(hasDuplicateJsonProperties);
  }
  if (!(node instanceof JsonObjectNode)) return false;

  const names = new Set<string>();
  for (const property of node.properties) {
    const name = property.key.toJSON();
    if (names.has(name) || hasDuplicateJsonProperties(property.value)) return true;
    names.add(name);
  }
  return false;
}

function normalizeJson5(source: string): {
  source: string;
  tokenReplacements: ReadonlyMap<string, string>;
  valueReplacements: ReadonlyMap<string, string>;
} {
  const tokens = JsonLexer.tokenize(source);
  const tokenReplacements = new Map<string, string>();
  const valueReplacements = new Map<string, string>();
  const placeholders = new Set<string>();
  let stringIndex = 0;

  const createPlaceholder = (prefix: string): string => {
    let placeholder = prefix;
    while (source.includes(placeholder) || placeholders.has(placeholder)) placeholder += "_";
    placeholders.add(placeholder);
    return placeholder;
  };

  const normalized = tokens.map((token, index) => {
    if (token.type === JsonTokenType.STRING) {
      try {
        JsonParser.parse(token.value);
      } catch {
        const value: unknown = JSON5.parse(token.value);
        if (typeof value !== "string") throw new Error("Expected a JSON5 string.");
        const placeholder = createPlaceholder(`$tailor_string_${stringIndex++}`);
        const quote = token.value.startsWith("'") ? "'" : '"';
        const normalizedToken = `${quote}${placeholder}${quote}`;
        tokenReplacements.set(normalizedToken, token.value);
        valueReplacements.set(placeholder, value);
        return normalizedToken;
      }
    }
    if (
      UNSUPPORTED_JSON5_PROPERTY_NAMES.has(token.value) &&
      findNextSignificantToken(tokens, index)?.type === JsonTokenType.COLON
    ) {
      const placeholder = createPlaceholder(`$tailor_property_${token.value}`);
      tokenReplacements.set(placeholder, token.value);
      valueReplacements.set(placeholder, token.value);
      return placeholder;
    }
    return token.value;
  });

  return {
    source: normalized.join(""),
    tokenReplacements,
    valueReplacements,
  };
}

function restoreJson5Tokens(
  source: string,
  tokenReplacements: ReadonlyMap<string, string>,
): string {
  if (tokenReplacements.size === 0) return source;
  return JsonLexer.tokenize(source)
    .map((token) => tokenReplacements.get(token.value) ?? token.value)
    .join("");
}

function readLosslessJsonConfig(
  filePath: string,
  format: "JSONC" | "JSON5",
): LosslessJsonConfig | null {
  const entry = getPathEntry(filePath);
  if (entry === null || !entry.isFile()) return null;
  try {
    const source = fs.readFileSync(filePath, "utf-8");
    const parsed: unknown = format === "JSONC" ? parseJsonc(source) : JSON5.parse(source);
    const normalized =
      format === "JSON5"
        ? normalizeJson5(source)
        : {
            source,
            tokenReplacements: new Map<string, string>(),
            valueReplacements: new Map<string, string>(),
          };
    const node = JsonParser.parse(normalized.source, JsonObjectNode);
    if (format === "JSONC" && hasDuplicateJsonProperties(node)) return null;
    return {
      node,
      parsed: toConfigObject(parsed),
      tokenReplacements: normalized.tokenReplacements,
      valueReplacements: normalized.valueReplacements,
    };
  } catch {
    return null;
  }
}

function classifyLosslessJsonConfig(
  location: string,
  filePath: string,
  format: "JSONC" | "JSON5",
  config: LosslessJsonConfig | null,
): ExistingConfig {
  if (config === null) return { kind: "unreadable", location, format };
  if (extendsPreset(config.parsed)) return { kind: "extends-preset", location };
  return { kind: "appendable-lossless-json", location, filePath, config };
}

function getLosslessJsonFormat(location: string): "JSONC" | "JSON5" | null {
  if (location.endsWith(".jsonc")) return "JSONC";
  if (location.endsWith(".json5")) return "JSON5";
  return null;
}

function findExistingConfig(outputDir: string): ExistingConfig | null {
  for (const file of RENOVATE_CONFIG_FILES) {
    const filePath = path.join(outputDir, file);
    if (!pathEntryExists(filePath)) continue;
    const format = getLosslessJsonFormat(file);
    if (format !== null) {
      return classifyLosslessJsonConfig(
        file,
        filePath,
        format,
        readLosslessJsonConfig(filePath, format),
      );
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

function findRootProperty(config: LosslessJsonConfig, name: string) {
  for (let index = config.node.properties.length - 1; index >= 0; index--) {
    const property = config.node.properties[index];
    if (property === undefined) continue;
    const key = property.key.toJSON();
    if ((config.valueReplacements.get(key) ?? key) === name) return property;
  }
  return undefined;
}

function appendLosslessJsonPreset(
  existing: Extract<ExistingConfig, { kind: "appendable-lossless-json" }>,
): void {
  const current = "extends" in existing.config.parsed ? existing.config.parsed.extends : undefined;
  if (current !== undefined && !Array.isArray(current)) {
    throw new Error(
      `Renovate config at "${existing.location}" has a non-array "extends". No files were changed. ` +
        `Add "${RENOVATE_PRESET}" to it manually.`,
    );
  }

  if (current === undefined) {
    existing.config.node.set("extends", [RENOVATE_PRESET]);
  } else {
    const property = findRootProperty(existing.config, "extends");
    if (!(property?.value instanceof JsonArrayNode)) {
      throw new Error(
        `Could not locate the "extends" array in Renovate config at "${existing.location}". ` +
          `No files were changed.`,
      );
    }
    property.value.push(RENOVATE_PRESET);
  }
  fs.writeFileSync(
    existing.filePath,
    restoreJson5Tokens(existing.config.node.toString(), existing.config.tokenReplacements),
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
    if (existingConfig.kind === "appendable-lossless-json") {
      appendLosslessJsonPreset(existingConfig);
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
