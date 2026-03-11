/**
 * Seed integration module for generated seed code.
 *
 * Re-exports `@toiroakr/lines-db` through a single import path
 * to avoid phantom dependency issues with pnpm, and provides
 * seed-specific utility functions used by the code generator.
 */

import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { LinesDB, ErrorFormatter } from "@toiroakr/lines-db";

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

  const formatter = new ErrorFormatter({ verbose });
  const errorLines: string[] = [];
  const errorsByFile = new Map<string, typeof result.errors>();
  for (const error of result.errors) {
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

  return { valid: false, output: outputLines.join("\n"), error: errorLines.join("\n") };
}
