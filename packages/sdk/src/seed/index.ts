/**
 * Seed integration module for generated seed code.
 *
 * Re-exports `lines-db` through a single import path
 * to avoid phantom dependency issues with pnpm, and provides
 * seed-specific utility functions used by the code generator.
 */

import { readdir, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  LinesDB,
  ErrorFormatter,
  fillFields,
  findSchemaFile,
  isSchemaFile,
  unwrap,
} from "lines-db";
// `pathe`, not `node:path`: the file paths reported back are printed and returned
// to the caller, and these stay separator-stable across platforms.
import { basename, dirname, join, normalize } from "pathe";
import { firstErrorLocation } from "./record-lines";
import type { JsonObject, JsonlParseError, RowFiller, ValidationErrorDetail } from "lines-db";

export { defineSchema } from "lines-db";
export { fillIdpUserPassword } from "./idp-user-password";
export type { ForeignKeyDefinition, IndexDefinition } from "lines-db";

/** Fields `fillSeedData` writes when the caller names none. */
const DEFAULT_FILL_FIELDS = ["id"];

type SeedHook = RowFiller;

type SeedDataTarget = {
  dataDir: string;
  tableName?: string;
};

type ValidateSeedDataOptions = {
  /** Resolved absolute path to a data directory or a .jsonl file */
  path: string;
  /**
   * Dataset directories whose rows are validated on top of the rows in `path`, which must then be
   * the data directory holding the schema files. A table's rows are those of every directory, in
   * this order, so foreign keys and duplicate ids are checked across them.
   */
  datasetDirs?: readonly string[];
  /** Validate only the rows of `datasetDirs`, leaving the rows in `path` out. Defaults to `false`. */
  excludeBase?: boolean;
  /** Show verbose error output */
  verbose?: boolean;
};

type ValidateSeedResult =
  | { valid: true; output: string }
  | {
      valid: false;
      output: string;
      error: string;
      /** Where the first reported error sits, for tooling that links to source. */
      location?: { file: string; line?: number };
    };

/**
 * A JSONL seed file that received values.
 */
type FilledSeedFile = {
  /** Name of the seeded table, matching the JSONL file name */
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
  /** Directory the schema files are looked up in. Defaults to the directory of the data. */
  schemaDir?: string;
};

type FillSeedDataResult = {
  output: string;
  filled: FilledSeedFile[];
};

async function hasSchemaFiles(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).some((entry) => isSchemaFile(entry));
  } catch {
    return false;
  }
}

/**
 * Point at `--dataset` for a directory without schema files of its own inside one that has them:
 * named as a path, it is checked on its own, not as a dataset on top of the seed data.
 * @param dataDir - Directory of the data the command was pointed at
 * @param command - The `tailor seed` command to suggest
 * @returns The hint as a warning, or none when the directory does not look like a dataset
 */
async function datasetHint(dataDir: string, command: "validate" | "fill"): Promise<string[]> {
  const parent = dirname(dataDir);
  if (parent === dataDir || (await hasSchemaFiles(dataDir)) || !(await hasSchemaFiles(parent))) {
    return [];
  }
  return [
    `${dataDir} has no schema files of its own. To ${command} it as a dataset with the schema files ` +
      `in ${parent}, run \`tailor seed ${command} --dataset ${basename(dataDir)}\`.`,
  ];
}

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

type ValidationConfig = {
  dataDir: string | string[];
  schemaDir?: string;
  tableName?: string;
  /** Warnings about how the path was resolved */
  warnings: string[];
};

async function resolveValidationConfig(
  options: ValidateSeedDataOptions,
): Promise<ValidationConfig> {
  const { path: resolvedPath, datasetDirs = [], excludeBase = false } = options;
  if (datasetDirs.length === 0) {
    if (excludeBase) {
      throw new Error("Leaving the base data out needs at least one dataset to validate.");
    }
    const { dataDir, tableName } = await resolveSeedDataTarget(resolvedPath);
    return { dataDir, tableName, warnings: await datasetHint(dataDir, "validate") };
  }
  if (!(await stat(resolvedPath)).isDirectory()) {
    throw new Error(
      `Invalid path: ${resolvedPath}. Datasets are validated against the schema files of a data directory, so the path must be a directory.`,
    );
  }
  const dataDirs = excludeBase ? [...datasetDirs] : [resolvedPath, ...datasetDirs];
  return {
    dataDir: dataDirs.length === 1 ? (dataDirs[0] as string) : dataDirs,
    schemaDir: resolvedPath,
    warnings: await findFilesWithoutSchema(datasetDirs, resolvedPath),
  };
}

async function findFilesWithoutSchema(
  dirs: readonly string[],
  schemaDir: string,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const dir of dirs) {
    for (const table of await listSeedTables(dir)) {
      if (!(await findSchemaFile(schemaDir, table))) {
        warnings.push(
          `${join(dir, `${table}.jsonl`)} has no schema file in ${schemaDir}, so its rows are not checked`,
        );
      }
    }
  }
  return warnings;
}

const MISSING_REFERENCED_TABLE =
  /^Foreign key reference to non-existent table '(.+)' in table '(.+)'$/;

async function listSeedTables(dataDir: string): Promise<string[]> {
  const entries = await readdir(dataDir);
  return entries
    .filter((entry) => entry.endsWith(".jsonl"))
    .map((entry) => basename(entry, ".jsonl"))
    .toSorted();
}

function formatWarnings(warnings: string[]): string[] {
  if (warnings.length === 0) {
    return [];
  }
  return [...warnings.map((warning) => `⚠ ${warning}`), ""];
}

function isJsonlParseError(error: Error): error is JsonlParseError {
  return error.name === "JsonlParseError";
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
 * Resolves the given path (directory or `.jsonl` file), validates the rows it
 * holds, and returns formatted output and error messages. With `datasetDirs`,
 * the rows of those directories are validated on top of the rows in `path`,
 * against the schema files in `path`.
 * @param options - Validation options including path, datasets, and verbose flag
 * @returns Validation result with output messages and optional error details
 */
export async function validateSeedData(
  options: ValidateSeedDataOptions,
): Promise<ValidateSeedResult> {
  const { verbose = false, excludeBase = false } = options;
  const { tableName, warnings, ...config } = await resolveValidationConfig(options);

  const db = LinesDB.create(config);
  let initialized;
  try {
    initialized = await db.initialize({ tableName, detailedValidate: true });
  } finally {
    unwrap(await db.close());
  }
  if (!initialized.ok && isJsonlParseError(initialized.error)) {
    const { file, line, message } = initialized.error;
    return {
      valid: false,
      output: "",
      error: [
        new ErrorFormatter({ verbose }).formatErrorHeader(1, file),
        "",
        `  Line ${line}: ${message}`,
        "",
      ].join("\n"),
      location: { file, line },
    };
  }
  if (excludeBase && !initialized.ok) {
    const missingTable = MISSING_REFERENCED_TABLE.exec(initialized.error.message);
    if (missingTable) {
      const [, referencedTable, table] = missingTable;
      throw new Error(
        `${table} has a foreign key to ${referencedTable}, but none of the selected datasets has ${referencedTable}.jsonl. ` +
          "Add the file to one of them, even an empty one, or validate them on top of the base seed data.",
        { cause: initialized.error },
      );
    }
  }
  const result = unwrap(initialized);

  const outputLines = formatWarnings([...warnings, ...result.warnings]);

  if (result.valid) {
    outputLines.push("✓ All records are valid");
    return { valid: true, output: outputLines.join("\n") };
  }

  return {
    valid: false,
    output: outputLines.join("\n"),
    error: formatValidationErrors(result.errors, verbose),
    location: await firstErrorLocation(result.errors),
  };
}

/**
 * Fill in the values a record gets on create for the JSONL seed data rows that
 * are missing them, so a row can be referenced by `id` or carry a timestamp
 * before it is ever seeded.
 *
 * The values come from the table's own create-time behavior — its `id`, its field
 * defaults, and its create hooks — applied to each row on its own. Nothing is
 * validated, so a row can be filled while the data around it is still
 * incomplete: that is what lets you get the ids you need in order to write the
 * rows that reference them. Run `validateSeedData` when the data is ready.
 *
 * Only the named fields are written, and only into a row that has no value for
 * them, so a value already in the file is never replaced. A line that gains
 * nothing is written back exactly as it was, byte for byte; a line that does get
 * a value is re-serialized with its keys in the order the table declares its
 * fields, so a filled-in `id` lands at the front. A field the table gives no
 * value to — one it does not declare, or one the platform assigns such as a
 * serial field — is skipped, so one field list covers a whole data directory.
 *
 * The values are read from the schema files generated next to the data, or in
 * `schemaDir` when it is given, and all
 * of them are read before anything is written: a file that predates the current
 * generator stops the run with nothing filled in anywhere. Likewise, a file that
 * another tool changed after the fill read it is not overwritten: the call
 * rejects with an error naming that file, and no file is written.
 * @param options - Fill options including path and fields
 * @returns Which files received which fields
 */
export async function fillSeedData(options: FillSeedDataOptions): Promise<FillSeedDataResult> {
  const { path: resolvedPath, fields = DEFAULT_FILL_FIELDS } = options;
  if (fields.length === 0) {
    throw new Error("No fields to fill. Name at least one field.");
  }
  const { dataDir, tableName } = await resolveSeedDataTarget(resolvedPath);
  const tables = tableName ? [tableName] : await listSeedTables(dataDir);

  const result = unwrap(
    await fillFields({
      path: resolvedPath,
      fields,
      schemaDir: options.schemaDir,
      loadFiller: (schemaModule, { schemaPath }) => {
        const hook = schemaModule.hook;
        if (typeof hook !== "function") {
          throw new Error(
            `${schemaPath} does not export \`hook\`. Run \`tailor generate\` to regenerate the seed schema files.`,
          );
        }
        return hook as SeedHook;
      },
    }),
  );
  const { tablesWithoutSchema, unproducedFields } = result;
  const filled = result.filled.map((entry) => ({ ...entry, file: normalize(entry.file) }));
  const unreadableLines = result.unreadableLines.map((entry) => ({
    ...entry,
    file: normalize(entry.file),
  }));

  const warnings = [
    ...(options.schemaDir ? [] : await datasetHint(dataDir, "fill")),
    ...tablesWithoutSchema.map(
      (table) => `No schema file for ${table}, so nothing can be filled in there`,
    ),
    ...unreadableLines.map(
      ({ file, lines }) =>
        `${file}: line(s) ${lines.join(", ")} are not JSON objects, so nothing was filled in there`,
    ),
  ];
  if (tables.length > 0 && unproducedFields.length > 0) {
    warnings.push(`No seed data produces a value for: ${unproducedFields.join(", ")}`);
  }

  const outputLines = formatWarnings(warnings);
  outputLines.push(
    filled.length === 0
      ? "\u2713 Nothing to fill"
      : filled
          .map(
            ({ file, fields: tableFields, count }) =>
              `\u2713 ${file}: filled ${tableFields.join(", ")} in ${count} row(s)`,
          )
          .join("\n"),
  );

  return { output: outputLines.join("\n"), filled };
}

type HookSeedRowsOptions = {
  /** Directory holding the generated schema files */
  schemaDir: string;
  /** Name of the seeded table, matching the schema file name */
  table: string;
  /** Rows as read from the JSONL files */
  rows: readonly Record<string, unknown>[];
};

/**
 * Run each row through the `hook` its generated schema file exports, so the values a row gets
 * from the schema (such as the `_User` password read from the environment) are the ones that
 * are seeded. Rows are returned as they are when the table has no schema file or the file
 * exports no `hook`.
 * @param options - Schema directory, table name and rows
 * @returns The rows after the hook
 */
export async function hookSeedRows(options: HookSeedRowsOptions): Promise<unknown[]> {
  const schemaPath = await findSchemaFile(options.schemaDir, options.table);
  if (!schemaPath) return [...options.rows];
  const schemaModule = await import(`${pathToFileURL(schemaPath).href}?t=${Date.now()}`);
  const hook = schemaModule.hook;
  if (typeof hook !== "function") return [...options.rows];
  return options.rows.map((row) => (hook as SeedHook)(structuredClone(row) as JsonObject));
}
