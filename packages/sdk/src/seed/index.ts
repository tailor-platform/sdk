/**
 * Seed integration module for generated seed code.
 *
 * Re-exports `@toiroakr/lines-db` through a single import path
 * to avoid phantom dependency issues with pnpm, and provides
 * seed-specific utility functions used by the code generator.
 */

import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { LinesDB, ErrorFormatter, fillFields, unwrap } from "@toiroakr/lines-db";
// `pathe`, not `node:path`: the file paths reported back are printed and returned
// to the caller, and these stay separator-stable across platforms.
import { basename, dirname, join, normalize } from "pathe";
import { readPackageJSON, resolvePackageJSON } from "pkg-types";
import { isNativeTypeScriptRuntime } from "#/cli/shared/runtime";
import { firstErrorLocation } from "./record-lines";
import type { JsonlParseError, RowFiller, ValidationErrorDetail } from "@toiroakr/lines-db";

export { defineSchema } from "@toiroakr/lines-db";
export type { ForeignKeyDefinition, IndexDefinition } from "@toiroakr/lines-db";

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
};

type FillSeedDataResult = {
  output: string;
  filled: FilledSeedFile[];
};

type SeedStudioOptions = {
  /** Resolved absolute path to the seed data directory */
  dataDir: string;
  /** Port to serve the studio on; `0` picks a free one. Defaults to 4848. */
  port?: number;
  /** Open the studio in the default browser */
  open?: boolean;
};

/**
 * A running seed studio.
 */
type SeedStudio = {
  /** Address the studio serves on */
  url: string;
  /** Settles when the studio stops: resolves after `stop()`, and rejects when it stops on its own with an error */
  closed: Promise<void>;
  /** Stop the studio, resolving once it has stopped */
  stop: () => Promise<void>;
};

// Computed here rather than in a helper so the URL stays relative to this entry
// file wherever the bundler places shared code.
const TS_HOOK_REGISTER_URL = new URL("../cli/ts-hook-register.mjs", import.meta.url);

/** How long `stop()` lets the studio finish stopping on a signal it already got before sending one. */
const STUDIO_STOP_GRACE_MS = 2000;

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
  const result = unwrap(initialized);

  const outputLines = formatWarnings(result.warnings);

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
 * The values are read from the schema files generated next to the data, and all
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

async function resolveLinesDbCli(): Promise<string> {
  const packageJsonPath = await resolvePackageJSON(
    fileURLToPath(import.meta.resolve("@toiroakr/lines-db")),
  );
  const { bin } = await readPackageJSON(packageJsonPath);
  const cli = typeof bin === "string" ? bin : bin?.["lines-db"];
  if (!cli) {
    throw new Error(`${packageJsonPath} declares no lines-db executable.`);
  }
  return join(dirname(packageJsonPath), cli);
}

/**
 * Start lines-db studio, a local web UI for browsing and editing seed rows, on
 * a seed data directory.
 *
 * Edits are saved through the schema files generated next to the data, so a
 * value they reject is not written. A save writes the fields the user entered
 * and a generated primary key, and leaves the other values the table fills in
 * on create, such as `createdAt`, out of the file.
 *
 * The studio's messages go to stderr. It keeps running until `stop()` is
 * called or it stops on its own; a signal that reaches it, such as Ctrl+C in
 * a terminal, stops it too.
 * @param options - Studio options including the data directory
 * @returns The running studio, once it serves
 */
export async function startSeedStudio(options: SeedStudioOptions): Promise<SeedStudio> {
  const { dataDir, port, open = false } = options;
  if (!(await stat(dataDir)).isDirectory()) {
    throw new Error(`${dataDir} is not a directory.`);
  }
  const cli = await resolveLinesDbCli();
  const nodeArgs = isNativeTypeScriptRuntime()
    ? []
    : ["--import", TS_HOOK_REGISTER_URL.href, "--disable-warning=DEP0205", "--enable-source-maps"];
  const child = spawn(
    process.execPath,
    [
      ...nodeArgs,
      cli,
      "studio",
      dataDir,
      "--write-filled-values",
      "primaryKey",
      ...(port === undefined ? [] : ["--port", String(port)]),
      ...(open ? ["--open"] : []),
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );

  let stopRequested = false;
  const exited = new Promise<string | undefined>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve(code === 0 ? undefined : signal ? `signal ${signal}` : `exit code ${String(code)}`);
    });
  });
  const closed = exited.then((failure) => {
    if (failure && !stopRequested) {
      throw new Error(`The studio stopped with ${failure}.`);
    }
  });
  closed.catch(() => {});

  const url = await new Promise<string>((resolve, reject) => {
    createInterface({ input: child.stdout }).on("line", (line) => {
      process.stderr.write(`${line}\n`);
      const found = /https?:\/\/\S+/.exec(stripVTControlCharacters(line));
      if (found) resolve(found[0]);
    });
    exited.then(
      (failure) =>
        reject(new Error(`The studio stopped with ${failure ?? "exit code 0"} before serving.`)),
      reject,
    );
  });

  const stop = async (): Promise<void> => {
    stopRequested = true;
    if (child.exitCode === null && child.signalCode === null) {
      const exitedInTime = await Promise.race([
        exited.then(() => true),
        delay(STUDIO_STOP_GRACE_MS, false, { ref: false }),
      ]);
      if (!exitedInTime) child.kill("SIGTERM");
    }
    await exited.catch(() => {});
  };

  return { url, closed, stop };
}
