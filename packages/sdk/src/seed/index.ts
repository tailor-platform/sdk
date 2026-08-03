/**
 * Seed integration module for generated seed code.
 *
 * Re-exports `@toiroakr/lines-db` through a single import path
 * to avoid phantom dependency issues with pnpm, and provides
 * seed-specific utility functions used by the code generator.
 */

import { stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { LinesDB, ErrorFormatter, JsonlReader, JsonlWriter } from "@toiroakr/lines-db";
import type { JsonObject, ValidationErrorDetail } from "@toiroakr/lines-db";

export { defineSchema } from "@toiroakr/lines-db";
export type { ForeignKeyDefinition, IndexDefinition } from "@toiroakr/lines-db";

/** Fields `fillSeedData` writes when the caller names none. */
const DEFAULT_FILL_FIELDS = ["id"];

type SeedDataTarget = {
  dataDir: string;
  tableName?: string;
};

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
 * A JSONL seed file that received values.
 */
type FilledSeedFile = {
  /** Name of the seeded type, matching the JSONL file name */
  table: string;
  /** Absolute path to the updated JSONL file */
  file: string;
  /** Fields that were written back to the file */
  fields: string[];
  /** How many rows were missing at least one of those fields */
  count: number;
};

type FillSeedDataOptions = {
  /** Resolved absolute path to a data directory or a .jsonl file */
  path: string;
  /** Fields to fill. Defaults to `id`. */
  fields?: readonly string[];
  /** Show verbose error output */
  verbose?: boolean;
};

type FillSeedDataResult =
  | { valid: true; output: string; filled: FilledSeedFile[] }
  | { valid: false; output: string; error: string };

async function resolveSeedDataTarget(resolvedPath: string): Promise<SeedDataTarget> {
  const stats = await stat(resolvedPath);
  if (stats.isDirectory()) {
    return { dataDir: resolvedPath };
  }
  if (stats.isFile() && resolvedPath.endsWith(".jsonl")) {
    return { dataDir: dirname(resolvedPath), tableName: basename(resolvedPath, ".jsonl") };
  }
  throw new Error(`Invalid path: ${resolvedPath}. Must be a directory or .jsonl file.`);
}

function formatWarnings(warnings: string[]): string[] {
  if (warnings.length === 0) {
    return [];
  }
  return [...warnings.map((warning) => `⚠ ${warning}`), ""];
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
  const { dataDir, tableName } = await resolveSeedDataTarget(resolvedPath);

  const db = LinesDB.create({ dataDir });
  let result;
  try {
    result = await db.initialize({ tableName, detailedValidate: true });
  } finally {
    await db.close();
  }

  const outputLines = formatWarnings(result.warnings);

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

function isMissing(row: JsonObject, field: string): boolean {
  const value = row[field];
  return value === undefined || value === null;
}

async function sortRowKeys(file: string, fieldOrder: string[]): Promise<void> {
  const rows = await JsonlReader.read(file);
  await JsonlWriter.write(
    file,
    rows.map((row) => {
      const sorted: JsonObject = {};
      for (const field of fieldOrder) {
        const value = row[field];
        if (value !== undefined) {
          sorted[field] = value;
        }
      }
      for (const [key, value] of Object.entries(row)) {
        if (!(key in sorted)) {
          sorted[key] = value;
        }
      }
      return sorted;
    }),
  );
}

/**
 * Write the values a record gets on create into JSONL seed data rows that are
 * missing them, so a row can be referenced by `id` or carry a timestamp before
 * it is ever seeded.
 *
 * Resolves the given path (directory or `.jsonl` file) and validates it first:
 * invalid data is reported and left untouched. Only the named fields are
 * written, so every other value each line already held stays exactly as it was,
 * and lines keep the order the file lists them in. A file is rewritten only
 * when it is missing one of the fields, and a field a type does not have is
 * skipped for that type — so one field list covers a whole data directory.
 *
 * A rewritten file gets its keys ordered the way the type declares its fields,
 * so a filled-in field lands where the type puts it rather than at the end of
 * the line. Keys the type does not declare follow the declared ones.
 *
 * A field whose value comes from the type's `id`, a field default, or a create
 * hook that returns its input is only filled in where it is missing. A field
 * whose create hook ignores its input is recomputed for every row of a file
 * that gets rewritten.
 * @param options - Fill options including path, fields, and verbose flag
 * @returns Which files received which fields, or validation error details
 */
export async function fillSeedData(options: FillSeedDataOptions): Promise<FillSeedDataResult> {
  const { path: resolvedPath, fields = DEFAULT_FILL_FIELDS, verbose = false } = options;
  if (fields.length === 0) {
    throw new Error("No fields to fill. Name at least one field.");
  }
  const { dataDir, tableName } = await resolveSeedDataTarget(resolvedPath);

  const db = LinesDB.create({ dataDir });
  try {
    const result = await db.initialize({ tableName, detailedValidate: true });

    if (!result.valid) {
      return {
        valid: false,
        output: formatWarnings(result.warnings).join("\n"),
        error: formatValidationErrors(result.errors, verbose),
      };
    }

    // Decide every file's write-back before writing any of it, so a field no
    // seeded type produces is reported against the whole run.
    const plans: { filled: FilledSeedFile; fieldOrder: string[] }[] = [];
    const producedFields = new Set<string>();
    let inspectedTables = 0;
    for (const table of tableName ? [tableName] : db.getTableNames()) {
      const columns = db.getSchema(table)?.columns;
      if (!columns) {
        continue;
      }
      inspectedTables += 1;
      const tableFields = fields.filter((field) => columns.some((column) => column.name === field));
      for (const field of tableFields) {
        producedFields.add(field);
      }
      const file = join(dataDir, `${table}.jsonl`);
      const rows = await JsonlReader.read(file);
      const missingFields = tableFields.filter((field) =>
        rows.some((row) => isMissing(row, field)),
      );
      if (missingFields.length === 0) {
        continue;
      }
      plans.push({
        filled: {
          table,
          file,
          fields: missingFields,
          count: rows.filter((row) => missingFields.some((field) => isMissing(row, field))).length,
        },
        fieldOrder: columns.map((column) => column.name),
      });
    }

    const warnings = [...result.warnings];
    const unproducedFields = fields.filter((field) => !producedFields.has(field));
    if (inspectedTables > 0 && unproducedFields.length > 0) {
      warnings.push(`No seed data produces a value for: ${unproducedFields.join(", ")}`);
    }

    for (const { filled, fieldOrder } of plans) {
      await db.sync(filled.table, { fields: filled.fields });
      await sortRowKeys(filled.file, fieldOrder);
    }

    const filled = plans.map((plan) => plan.filled);
    const outputLines = formatWarnings(warnings);
    outputLines.push(
      filled.length === 0
        ? "✓ Nothing to fill"
        : filled
            .map(
              ({ file, fields: tableFields, count }) =>
                `✓ ${file}: filled ${tableFields.join(", ")} in ${count} row(s)`,
            )
            .join("\n"),
    );

    return { valid: true, output: outputLines.join("\n"), filled };
  } finally {
    await db.close();
  }
}
