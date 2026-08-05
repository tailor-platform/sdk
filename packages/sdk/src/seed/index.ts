/**
 * Seed integration module for generated seed code.
 *
 * Re-exports `@toiroakr/lines-db` through a single import path
 * to avoid phantom dependency issues with pnpm, and provides
 * seed-specific utility functions used by the code generator.
 */

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { LinesDB, ErrorFormatter, findSchemaFile } from "@toiroakr/lines-db";
// `pathe`, not `node:path`: the file paths reported back are printed and returned
// to the caller, and these stay separator-stable across platforms.
import { basename, dirname, join } from "pathe";
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
};

type FillSeedDataResult = {
  output: string;
  filled: FilledSeedFile[];
};

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
 * holds, and returns formatted output and error messages.
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

// A row's own value for a field, or undefined when the row has none.
function ownValue(row: Record<string, unknown>, field: string): unknown {
  return Object.hasOwn(row, field) ? row[field] : undefined;
}

// Not `row[field] = value`: a field named `__proto__` goes through the inherited
// setter, which leaves no own property for the serializer to read back.
function setField(row: JsonObject, field: string, value: JsonObject[string]): void {
  Object.defineProperty(row, field, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  // A nested field the row never had comes back as an object whose keys carry no
  // value of their own, and writing that into the line fills nothing in.
  return Object.values(value).every(isBlank);
}

/** A JSONL line, kept as text so an untouched line is written back verbatim. */
type SeedLine = {
  text: string;
  /** Line separator the file used after this line, kept so CRLF survives. */
  eol: string;
  row: JsonObject | undefined;
};

function splitLines(content: string): SeedLine[] {
  if (content === "") {
    return [];
  }
  return content.split("\n").map((raw, index, all) => {
    const eol = index === all.length - 1 ? "" : "\n";
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const carriage = raw.endsWith("\r") ? "\r" : "";
    let row: JsonObject | undefined;
    if (text.trim() !== "") {
      try {
        const parsed: unknown = JSON.parse(text);
        row =
          parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as JsonObject)
            : undefined;
      } catch {
        row = undefined;
      }
    }
    return { text, eol: `${carriage}${eol}`, row };
  });
}

// Keys go in the order the hook produced them, which is the order the type
// declares its fields. Keys the type does not declare follow the declared ones.
function serializeRow(row: JsonObject, fieldOrder: string[]): string {
  const rank = new Map(fieldOrder.map((field, index) => [field, index]));
  const rankOf = (key: string): number => rank.get(key) ?? fieldOrder.length;
  return JSON.stringify(
    Object.fromEntries(Object.entries(row).toSorted(([a], [b]) => rankOf(a) - rankOf(b))),
  );
}

type SeedHook = (row: unknown) => Record<string, unknown>;

async function loadSeedHook(dataDir: string, table: string): Promise<SeedHook | undefined> {
  const schemaPath = await findSchemaFile(dataDir, table);
  if (!schemaPath) {
    return undefined;
  }
  const loaded: unknown = await import(pathToFileURL(schemaPath).href);
  const hook = (loaded as { hook?: unknown }).hook;
  if (typeof hook !== "function") {
    throw new Error(
      `${schemaPath} does not export \`hook\`. Run \`tailor generate\` to regenerate the seed schema files.`,
    );
  }
  return hook as SeedHook;
}

/**
 * Fill in the values a record gets on create for the JSONL seed data rows that
 * are missing them, so a row can be referenced by `id` or carry a timestamp
 * before it is ever seeded.
 *
 * The values come from the type's own create-time behavior — its `id`, its field
 * defaults, and its create hooks — applied to each row on its own. Nothing is
 * validated, so a row can be filled while the data around it is still
 * incomplete: that is what lets you get the ids you need in order to write the
 * rows that reference them. Run `validateSeedData` when the data is ready.
 *
 * Only the named fields are written, and only into a row that has no value for
 * them, so a value already in the file is never replaced. A line that gains
 * nothing is written back exactly as it was, byte for byte; a line that does get
 * a value is re-serialized with its keys in the order the type declares its
 * fields, so a filled-in `id` lands at the front. A field the type gives no
 * value to — one it does not declare, or one the platform assigns such as a
 * serial field — is skipped, so one field list covers a whole data directory.
 *
 * The values are read from the schema files generated next to the data, and all
 * of them are read before anything is written: a file that predates the current
 * generator stops the run with nothing filled in anywhere.
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

  const warnings: string[] = [];
  const filled: FilledSeedFile[] = [];
  const producedFields = new Set<string>();

  // Every hook loads before anything is written, so a schema file that predates
  // `tailor generate` stops the run instead of leaving half the files filled.
  const hooks: { table: string; hook: SeedHook }[] = [];
  for (const table of tables) {
    const hook = await loadSeedHook(dataDir, table);
    if (!hook) {
      warnings.push(`No schema file for ${table}, so nothing can be filled in there`);
      continue;
    }
    hooks.push({ table, hook });
  }

  // Every line is decided before any file is written, so a hook that throws on
  // one table cannot leave another one already rewritten.
  const writes: { file: string; content: string }[] = [];
  for (const { table, hook } of hooks) {
    const file = join(dataDir, `${table}.jsonl`);
    const lines = splitLines(await readFile(file, "utf-8"));

    const written = new Set<string>();
    const unreadable: number[] = [];
    let count = 0;
    let fieldOrder: string[] = [];
    for (const [index, line] of lines.entries()) {
      const row = line.row;
      if (!row) {
        if (line.text.trim() !== "") {
          unreadable.push(index + 1);
        }
        continue;
      }
      const hooked = hook(row);
      fieldOrder = Object.keys(hooked);
      const gained = fields.filter((field) => {
        const value = ownValue(hooked, field);
        if (isBlank(value)) {
          return false;
        }
        producedFields.add(field);
        return isBlank(ownValue(row, field));
      });
      if (gained.length === 0) {
        continue;
      }
      for (const field of gained) {
        setField(row, field, hooked[field] as JsonObject[string]);
        written.add(field);
      }
      line.text = serializeRow(row, fieldOrder);
      count += 1;
    }

    if (unreadable.length > 0) {
      warnings.push(
        `${file}: line(s) ${unreadable.join(", ")} are not JSON objects, so nothing was filled in there`,
      );
    }

    if (count === 0) {
      continue;
    }
    writes.push({ file, content: lines.map((line) => `${line.text}${line.eol}`).join("") });
    filled.push({ table, file, fields: [...written], count });
  }

  for (const { file, content } of writes) {
    await writeFile(file, content);
  }

  const unproducedFields = fields.filter((field) => !producedFields.has(field));
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
