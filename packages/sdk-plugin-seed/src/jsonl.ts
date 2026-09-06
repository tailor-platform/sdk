import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import * as path from "pathe";
import type { SeedData } from "@tailor-platform/sdk/cli";

export function assertSeedDataDirectory(dataDir: string): void {
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(dataDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new Error(
        `Seed data directory not found: ${dataDir}. Run \`tailor generate\` before applying seed data.`,
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
 * Options for {@link loadSeedData}.
 */
export interface LoadSeedDataOptions {
  /** Reject rows without an `id` (enforced with `--upsert`, which matches existing rows by id). */
  requireId?: boolean;
  /** Field names a row must supply per entity, enforced alongside `requireId`. */
  requiredFieldsByType?: Record<string, string[]>;
}

/**
 * Load seed rows from `<dataDir>/<typeName>.jsonl` for each entity. Missing
 * files load as empty lists.
 * @param dataDir - Directory containing the JSONL files
 * @param typeNames - Entity names to load
 * @param options - Row validation options
 * @returns Seed rows per entity
 */
export function loadSeedData(
  dataDir: string,
  typeNames: string[],
  options: LoadSeedDataOptions = {},
): SeedData {
  const { requireId = false, requiredFieldsByType = {} } = options;
  const data: SeedData = {};
  for (const typeName of typeNames) {
    const jsonlPath = path.join(dataDir, `${typeName}.jsonl`);
    let content: string;
    try {
      content = readFileSync(jsonlPath, "utf-8").trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        data[typeName] = [];
        continue;
      }
      throw error;
    }
    data[typeName] = content
      ? content.split("\n").map((line, index) => {
          let value: unknown;
          try {
            value = JSON.parse(line);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Invalid JSON in ${jsonlPath} at line ${index + 1}: ${message}`, {
              cause: error,
            });
          }
          if (value === null || typeof value !== "object" || Array.isArray(value)) {
            throw new Error(
              `Invalid seed row in ${jsonlPath} at line ${index + 1}: expected a JSON object`,
            );
          }
          const record = value as Record<string, unknown>;
          if (requireId && (record.id === undefined || record.id === null)) {
            throw new Error(
              `${jsonlPath}:${index + 1}: \`id\` is required with --upsert. ` +
                "Run `tailor seed fill` to write an id into every row that does not have one.",
            );
          }
          const missingRequiredField = (requiredFieldsByType[typeName] ?? []).find(
            (field) => record[field] === undefined || record[field] === null,
          );
          if (missingRequiredField) {
            throw new Error(
              `${jsonlPath}:${index + 1}: field \`${missingRequiredField}\` is required with --upsert`,
            );
          }
          return record as SeedData[string][number];
        })
      : [];
  }
  return data;
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
 * Names of the entities that already have a JSONL file in the data directory.
 * @param dataDir - Directory the files live in
 * @param typeNames - Entity names to check
 * @returns The subset of `typeNames` whose file exists
 */
export function existingSeedDataFiles(dataDir: string, typeNames: string[]): string[] {
  return typeNames.filter((typeName) => existsSync(path.join(dataDir, `${typeName}.jsonl`)));
}
