import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { withSourceLocation } from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { jsonlRecordLines } from "./record-lines";
import type { ErrorSourceLocation, SeedData } from "@tailor-platform/sdk/cli";

type AssertSeedDataDirectoryOptions = {
  /** Point at `tailor generate` when the directory is missing. Defaults to true. */
  suggestGenerate?: boolean;
};

export function assertSeedDataDirectory(
  dataDir: string,
  options: AssertSeedDataDirectoryOptions = {},
): void {
  const { suggestGenerate = true } = options;
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(dataDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new Error(
        `Seed data directory not found: ${dataDir}.${
          suggestGenerate ? " Run `tailor generate` to create it." : ""
        }`,
        { cause: error },
      );
    }
    throw error;
  }

  if (!stats.isDirectory()) {
    throw new Error(`Seed data path is not a directory: ${dataDir}`);
  }
}

/**
 * Options for {@link loadSeedData} and {@link loadLocatedSeedRows}.
 */
export interface LoadSeedDataOptions {
  /** Reject rows without an `id` (enforced with `--upsert`, which matches existing rows by id). */
  requireId?: boolean;
  /** Field names a row must supply per entity, enforced alongside `requireId`. */
  requiredFieldsByType?: Record<string, string[]>;
  /**
   * Field that identifies a row. With several data directories, a value
   * defined in more than one of them is rejected. Defaults to `id`.
   */
  keyField?: string;
}

/**
 * Load seed rows from `<dataDir>/<typeName>.jsonl` for each entity, reading
 * each data directory in order and concatenating its rows. Missing files load
 * as empty lists.
 * @param dataDirs - Directory, or directories in order, containing the JSONL files
 * @param typeNames - Entity names to load
 * @param options - Row validation options
 * @returns Seed rows per entity
 */
export function loadSeedData(
  dataDirs: string | readonly string[],
  typeNames: string[],
  options: LoadSeedDataOptions = {},
): SeedData {
  const dirs = typeof dataDirs === "string" ? [dataDirs] : dataDirs;
  const data: SeedData = {};
  for (const typeName of typeNames) {
    data[typeName] = loadLocatedSeedRows(dirs, typeName, options).map(({ row }) => row);
  }
  return data;
}

/**
 * A seed row with the file and line it was read from.
 */
export interface LocatedSeedRow {
  row: SeedData[string][number];
  location: Required<ErrorSourceLocation>;
}

/**
 * Format where a seed row was read from, as error messages name it.
 * @param location - File and line the row was read from
 * @returns `<file>:<line>`, with the file relative to the working directory
 */
export function relativeRowLocation(location: LocatedSeedRow["location"]): string {
  return `${path.relative(process.cwd(), location.file)}:${location.line}`;
}

/**
 * Load one entity's seed rows like {@link loadSeedData}, keeping where each
 * row was read from.
 * @param dataDirs - Directories, in order, containing the JSONL files
 * @param typeName - Entity name to load
 * @param options - Row validation options
 * @returns Rows with their absolute file and 1-based physical line
 */
export function loadLocatedSeedRows(
  dataDirs: readonly string[],
  typeName: string,
  options: LoadSeedDataOptions = {},
): LocatedSeedRow[] {
  const { keyField = "id" } = options;
  const rows: LocatedSeedRow[] = [];
  const firstDefinitions = new Map<string, LocatedSeedRow["location"]>();
  for (const dataDir of dataDirs) {
    const jsonlPath = path.join(dataDir, `${typeName}.jsonl`);
    for (const { row, line } of readSeedRows(jsonlPath, typeName, options)) {
      const location = { file: jsonlPath, line };
      const key = row[keyField];
      if (dataDirs.length > 1 && key !== undefined && key !== null) {
        const keyText = JSON.stringify(key);
        const first = firstDefinitions.get(keyText);
        if (!first) {
          firstDefinitions.set(keyText, location);
        } else if (first.file !== jsonlPath) {
          throw rowError(
            location,
            `${keyField} ${keyText} is already defined at ${relativeRowLocation(first)}. ` +
              "A row can be defined in only one of the data directories applied together.",
          );
        }
      }
      rows.push({ row, location });
    }
  }
  return rows;
}

function readSeedRows(
  jsonlPath: string,
  typeName: string,
  options: LoadSeedDataOptions,
): { row: SeedData[string][number]; line: number }[] {
  const { requireId = false, requiredFieldsByType = {} } = options;
  let content: string;
  try {
    content = readFileSync(jsonlPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return jsonlRecordLines(content).map(({ text, line }) => {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw rowError({ file: jsonlPath, line }, `Invalid JSON: ${message}`, { cause: error });
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw rowError({ file: jsonlPath, line }, "Invalid seed row: expected a JSON object");
    }
    const record = value as Record<string, unknown>;
    if (requireId && (record.id === undefined || record.id === null)) {
      throw rowError(
        { file: jsonlPath, line },
        "`id` is required with --upsert. " +
          "Run `tailor seed fill` to write an id into every row that does not have one.",
      );
    }
    const missingRequiredField = (requiredFieldsByType[typeName] ?? []).find(
      (field) => record[field] === undefined || record[field] === null,
    );
    if (missingRequiredField) {
      throw rowError(
        { file: jsonlPath, line },
        `field \`${missingRequiredField}\` is required with --upsert`,
      );
    }
    return { row: record as SeedData[string][number], line };
  });
}

function rowError(location: ErrorSourceLocation, message: string, options?: ErrorOptions): Error {
  return withSourceLocation(new Error(message, options), location);
}

/**
 * Write seed rows to `<dataDir>/<typeName>.jsonl`, one JSON object per line,
 * creating the directory when it does not exist. An entity with no rows still
 * gets a file, so a dump of an empty table reads back as empty rather than
 * missing.
 * @param dataDir - Directory to write the JSONL file into
 * @param typeName - Entity name the rows belong to
 * @param rows - Rows to write
 * @returns Path of the written file
 */
export function writeSeedData(dataDir: string, typeName: string, rows: SeedData[string]): string {
  mkdirSync(dataDir, { recursive: true });
  const jsonlPath = path.join(dataDir, `${typeName}.jsonl`);
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(jsonlPath, content === "" ? "" : `${content}\n`, "utf-8");
  return jsonlPath;
}

/**
 * Start a streamed write for one entity: creates a hidden temp file next to
 * the entity's JSONL file, so rows can be appended a page at a time instead
 * of held in memory for the whole table. The real `<typeName>.jsonl` is left
 * untouched until {@link commitSeedDataWrite}, so a table that fails partway
 * through never corrupts or truncates the file from a previous run. The temp
 * file name includes a random suffix so concurrent dumps into the same
 * directory do not collide on it.
 * @param dataDir - Directory the entity's JSONL file lives in
 * @param typeName - Entity name the rows belong to
 * @returns Path of the temp file to append rows to
 */
export function beginSeedDataWrite(dataDir: string, typeName: string): string {
  mkdirSync(dataDir, { recursive: true });
  const suffix = randomBytes(4).toString("hex");
  const tmpPath = path.join(dataDir, `.${typeName}.jsonl.${suffix}.tmp`);
  writeFileSync(tmpPath, "", "utf-8");
  return tmpPath;
}

/**
 * Append a page of rows to a temp file opened with {@link beginSeedDataWrite}.
 * @param tmpPath - Temp file path returned by `beginSeedDataWrite`
 * @param rows - Rows to append, in order
 */
export function appendSeedDataRows(tmpPath: string, rows: SeedData[string]): void {
  if (rows.length === 0) return;
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  appendFileSync(tmpPath, `${content}\n`, "utf-8");
}

/**
 * Finish a streamed write: replace `<typeName>.jsonl` with the temp file's
 * contents, now that every row for the table has been written successfully.
 *
 * Without `force`, this must not overwrite an existing file. The dump
 * command's own `existingSeedDataFiles` preflight check cannot see a second
 * dump that starts after it and reaches this point first, so the check is
 * repeated here at commit time via `linkSync`: unlike `renameSync`, it fails
 * atomically with `EEXIST` when the destination already exists instead of
 * silently replacing it, closing the race for the one write that actually
 * matters. With `force`, the destination is expected to exist and is always
 * replaced with `renameSync`.
 * @param dataDir - Directory the entity's JSONL file lives in
 * @param typeName - Entity name the rows belong to
 * @param tmpPath - Temp file path returned by `beginSeedDataWrite`
 * @param force - Overwrite an existing `<typeName>.jsonl` instead of failing
 * @returns Path of the entity's JSONL file
 */
export function commitSeedDataWrite(
  dataDir: string,
  typeName: string,
  tmpPath: string,
  force: boolean,
): string {
  const jsonlPath = path.join(dataDir, `${typeName}.jsonl`);
  if (force) {
    renameSync(tmpPath, jsonlPath);
    return jsonlPath;
  }
  try {
    linkSync(tmpPath, jsonlPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `${jsonlPath} already exists. Pass --force to overwrite it, or --out to write elsewhere.`,
        { cause: error },
      );
    }
    throw error;
  }
  unlinkSync(tmpPath);
  return jsonlPath;
}

/**
 * Abandon a streamed write after a failure, removing the temp file so it
 * never gets mistaken for real seed data. The entity's actual JSONL file
 * (if any, from a previous run) is left exactly as it was.
 * @param tmpPath - Temp file path returned by `beginSeedDataWrite`
 */
export function discardSeedDataWrite(tmpPath: string): void {
  try {
    unlinkSync(tmpPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Names of the entities that already have a JSONL file in the data directory.
 * @param dataDir - Directory the files live in
 * @param typeNames - Entity names to check
 * @returns The subset of `typeNames` whose file exists
 */
export function existingSeedDataFiles(dataDir: string, typeNames: string[]): string[] {
  return typeNames.filter((typeName) => existsSync(path.join(dataDir, `${typeName}.jsonl`)));
}
