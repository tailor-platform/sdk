/**
 * Seed integration module for generated seed code.
 *
 * Re-exports `@toiroakr/lines-db` through a single import path
 * to avoid phantom dependency issues with pnpm, and provides
 * seed-specific utility functions used by the code generator.
 */

import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { LinesDB, ErrorFormatter } from "@toiroakr/lines-db";
import type { ValidationErrorDetail } from "@toiroakr/lines-db";

export { defineSchema } from "@toiroakr/lines-db";
export type { ForeignKeyDefinition, IndexDefinition } from "@toiroakr/lines-db";

type ValidateSeedDataOptions = {
  /** Resolved absolute path to a data directory or a .jsonl file */
  path: string;
  /** Show verbose error output */
  verbose?: boolean;
};

type ValidateSeedResult =
  | { valid: true; output: string }
  | { valid: false; output: string; error: string };

/**
 * Validate JSONL seed data against schema definitions.
 * Resolves the given path (directory or `.jsonl` file), runs LinesDB
 * validation, and returns formatted output and error messages.
 * @param options - Validation options including path and verbose flag
 * @returns Validation result with output messages and optional error details
 */
export async function validateSeedData(
  options: ValidateSeedDataOptions,
): Promise<ValidateSeedResult> {
  const { path: resolvedPath, verbose = false } = options;

  const stats = await stat(resolvedPath);
  let dataDir: string;
  let tableName: string | undefined;
  if (stats.isDirectory()) {
    dataDir = resolvedPath;
  } else if (stats.isFile() && resolvedPath.endsWith(".jsonl")) {
    dataDir = dirname(resolvedPath);
    tableName = basename(resolvedPath, ".jsonl");
  } else {
    throw new Error(`Invalid path: ${resolvedPath}. Must be a directory or .jsonl file.`);
  }

  const db = LinesDB.create({ dataDir });
  let result;
  try {
    result = await db.initialize({ tableName, detailedValidate: true });
  } finally {
    await db.close();
  }

  const outputLines: string[] = [];

  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      outputLines.push(`⚠ ${warning}`);
    }
    outputLines.push("");
  }

  if (result.valid) {
    outputLines.push("✓ All records are valid");
    return { valid: true, output: outputLines.join("\n") };
  }

  return {
    valid: false,
    output: outputLines.join("\n"),
    error: formatValidationErrors(result.errors, verbose),
  };
}

function formatValidationErrors(errors: ValidationErrorDetail[], verbose: boolean): string {
  const formatter = new ErrorFormatter({ verbose });
  const errorLines: string[] = [];
  const errorsByFile = new Map<string, ValidationErrorDetail[]>();
  for (const error of errors) {
    const fileErrors = errorsByFile.get(error.file) || [];
    fileErrors.push(error);
    errorsByFile.set(error.file, fileErrors);
  }
  for (const [file, fileErrors] of errorsByFile) {
    errorLines.push(formatter.formatErrorHeader(fileErrors.length, file));
    errorLines.push("");
    const validationErrors = fileErrors.filter(
      (e) => e.type !== "foreignKey" || !e.foreignKeyError,
    );
    const foreignKeyErrors = fileErrors.filter((e) => e.type === "foreignKey" && e.foreignKeyError);
    if (validationErrors.length > 0) {
      errorLines.push(
        formatter.formatValidationErrors(
          validationErrors.map((e) => ({
            file: e.file,
            rowIndex: e.rowIndex,
            issues: e.issues,
          })),
        ),
      );
    }
    for (const fkError of foreignKeyErrors) {
      if (fkError.foreignKeyError) {
        errorLines.push(
          formatter.formatForeignKeyError({
            file: fkError.file,
            rowIndex: fkError.rowIndex,
            column: fkError.foreignKeyError.column,
            value: fkError.foreignKeyError.value,
            referencedTable: fkError.foreignKeyError.referencedTable,
            referencedColumn: fkError.foreignKeyError.referencedColumn,
          }),
        );
      }
    }
    errorLines.push("");
  }

  return errorLines.join("\n");
}

type BackfillSeedIdsOptions = {
  /** Resolved absolute path to a seed data directory */
  path: string;
  /** Show verbose error output when validation fails */
  verbose?: boolean;
};

type BackfillSeedIdsResult = {
  /** Number of rows that received an `id`, keyed by table name */
  backfilled: Record<string, number>;
  /** Human-readable summary of the backfill */
  output: string;
};

/**
 * Backfill missing `id` values into JSONL seed data.
 * Loads the data directory through the generated schemas — whose hooks mint
 * an `id` for rows that lack one — and writes only the `id` field back to
 * the files. Every other field keeps the value its line already had, so
 * hook-computed values and omitted optional fields are untouched, and tables
 * without an `id` field (such as `_User`) are left as they are.
 * @param options - Backfill options including path and verbose flag
 * @returns Per-table counts of rows that received an `id`
 */
export async function backfillSeedIds(
  options: BackfillSeedIdsOptions,
): Promise<BackfillSeedIdsResult> {
  const { path: dataDir, verbose = false } = options;

  const stats = await stat(dataDir);
  if (!stats.isDirectory()) {
    throw new Error(`Invalid path: ${dataDir}. Must be a directory.`);
  }

  const db = LinesDB.create({ dataDir, writeBackFields: ["id"] });
  try {
    const result = await db.initialize({ detailedValidate: true });
    if (!result.valid) {
      // Syncing after a failed load would drop the failed rows from their files
      throw new Error(
        `Seed data failed validation; fix the errors and re-run.\n\n${formatValidationErrors(result.errors, verbose)}`,
      );
    }

    const backfilled: Record<string, number> = {};
    for (const table of db.getTableNames()) {
      const schema = db.getSchema(table);
      if (!schema?.columns.some((column) => column.name === "id")) {
        continue;
      }
      const missing = await countRowsMissingId(join(dataDir, `${table}.jsonl`));
      if (missing > 0) {
        backfilled[table] = missing;
      }
    }

    const entries = Object.entries(backfilled);
    if (entries.length === 0) {
      return { backfilled, output: "✓ All rows already have an id" };
    }

    await db.sync();

    const outputLines = entries.map(
      ([table, count]) => `✓ ${table}: ${count} ${count === 1 ? "id" : "ids"} backfilled`,
    );
    return { backfilled, output: outputLines.join("\n") };
  } finally {
    await db.close();
  }
}

async function countRowsMissingId(jsonlPath: string): Promise<number> {
  const content = await readFile(jsonlPath, "utf-8");

  let missing = 0;
  for (const line of content.split("\n")) {
    if (line.trim() === "") continue;
    const row: unknown = JSON.parse(line);
    if (row && typeof row === "object" && (row as Record<string, unknown>).id == null) {
      missing++;
    }
  }
  return missing;
}
