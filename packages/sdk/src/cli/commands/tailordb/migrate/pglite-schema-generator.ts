/**
 * PGlite schema for migration tests: the tables as the Pre-phase leaves them
 * while `migrate.ts` runs, rendered as a `CREATE TABLE` script module next to
 * `db.ts`.
 */

import * as fs from "node:fs/promises";
import {
  dropUnresolvableReferences,
  generatePgliteSchemaModule,
  type DDLTableConfig,
} from "#/utils/tailordb-ddl";
import { writeDbTypesFile } from "./db-types-generator";
import { DECIMAL_MIGRATION_FILE_VERSION, SCHEMA_SNAPSHOT_VERSION } from "./diff-calculator";
import { buildPreMigrationSnapshot } from "./pre-migration-schema";
import { getMigrationFilePath } from "./snapshot";
import type { EffectiveDateDefault } from "#/runtime/types";
import type { ColumnTypeOptions } from "#/utils/field-column-type";
import type { MigrationDiff } from "./diff-calculator";
import type { ExpandContractPlan } from "./expand-contract";
import type { SchemaSnapshot, TailorDBSnapshotType } from "./snapshot-types";

function toDDLTable(table: TailorDBSnapshotType): DDLTableConfig {
  return { name: table.name, fields: table.fields, indexes: table.indexes };
}

/**
 * The tables `migrate.ts` sees: the migration's target schema with the
 * Pre-phase relaxations applied, plus the tables the Pre-phase retains for
 * the script to read (removed tables, and renamed tables under their old name).
 * @param previousSnapshot - Schema before the migration
 * @param diff - The migration's diff
 * @returns Tables in creation order
 */
export function buildPreMigrationTables(
  previousSnapshot: SchemaSnapshot,
  diff: MigrationDiff,
): DDLTableConfig[] {
  return dropUnresolvableReferences(
    Object.values(buildPreMigrationSnapshot(previousSnapshot, diff).tables).map(toDDLTable),
  );
}

/**
 * Render the `db.pglite.ts` module for a migration.
 * @param previousSnapshot - Schema before the migration
 * @param diff - The migration's diff
 * @returns TypeScript source exporting the namespace's `CREATE TABLE` script
 */
export function generateMigrationPgliteSchema(
  previousSnapshot: SchemaSnapshot,
  diff: MigrationDiff,
): string {
  return generatePgliteSchemaModule(
    [
      {
        namespace: previousSnapshot.namespace,
        tables: buildPreMigrationTables(previousSnapshot, diff),
      },
    ],
    { generatedBy: "the migration system" },
  );
}

/**
 * Write `db.pglite.ts` for a migration.
 * @param previousSnapshot - Schema before the migration
 * @param diff - The migration's diff
 * @param migrationsDir - Migrations directory path
 * @param migrationNumber - Migration number
 * @returns Path to the written file
 */
export async function writePgliteSchemaFile(
  previousSnapshot: SchemaSnapshot,
  diff: MigrationDiff,
  migrationsDir: string,
  migrationNumber: number,
): Promise<string> {
  const filePath = getMigrationFilePath(migrationsDir, migrationNumber, "pgliteSchema");
  await fs.writeFile(filePath, generateMigrationPgliteSchema(previousSnapshot, diff));
  return filePath;
}

/** Inputs for {@link writeMigrationTypeFiles}. */
export interface WriteMigrationTypeFilesOptions extends ColumnTypeOptions {
  /** Schema before the migration */
  previousSnapshot: SchemaSnapshot;
  /** The migration's diff */
  diff: MigrationDiff;
  migrationsDir: string;
  migrationNumber: number;
  /** Field changes carried through temporary fields */
  expandPlans?: readonly ExpandContractPlan[] | undefined;
  /** Representation applied to `t` date fields that omit `as`; recorded in `diff.json`. */
  dateDefault?: EffectiveDateDefault | undefined;
}

/** Outcome of writing `db.pglite.ts`: the path, or why it was skipped. */
export interface PgliteSchemaFileResult {
  /** Undefined when the schema could not be expressed as DDL; see `pgliteSchemaError`. */
  pgliteSchemaPath?: string | undefined;
  /** Why `db.pglite.ts` was skipped */
  pgliteSchemaError?: string | undefined;
}

/** Files written by {@link writeMigrationTypeFiles}. */
export interface WriteMigrationTypeFilesResult extends PgliteSchemaFileResult {
  dbTypesPath: string;
}

/**
 * Write `db.pglite.ts`, reporting a schema the DDL generator cannot express
 * (an unknown field type, a serial format it cannot reproduce) instead of
 * failing the command that needs the other migration files.
 * @param previousSnapshot - Schema before the migration
 * @param diff - The migration's diff
 * @param migrationsDir - Migrations directory path
 * @param migrationNumber - Migration number
 * @returns The written path, or the reason it was skipped
 */
export async function tryWritePgliteSchemaFile(
  previousSnapshot: SchemaSnapshot,
  diff: MigrationDiff,
  migrationsDir: string,
  migrationNumber: number,
): Promise<PgliteSchemaFileResult> {
  try {
    return {
      pgliteSchemaPath: await writePgliteSchemaFile(
        previousSnapshot,
        diff,
        migrationsDir,
        migrationNumber,
      ),
    };
  } catch (error) {
    return { pgliteSchemaError: error instanceof Error ? error.message : String(error) };
  }
}

// Pins the runtime modes the script was written against, so a later config
// change does not alter a migration that a new workspace has yet to run.
async function recordRuntimeModes(
  diffPath: string,
  columnTypes: ColumnTypeOptions,
  dateDefault: EffectiveDateDefault,
): Promise<void> {
  const { temporal = false, decimal = false } = columnTypes;
  const raw = JSON.parse(await fs.readFile(diffPath, "utf-8")) as Record<string, unknown>;
  let changed = false;
  if (temporal) {
    raw.temporal = true;
    changed = true;
  } else if (Object.hasOwn(raw, "temporal")) {
    delete raw.temporal;
    changed = true;
  }
  if (decimal) {
    raw.decimal = true;
    changed = true;
  } else if (Object.hasOwn(raw, "decimal")) {
    delete raw.decimal;
    changed = true;
  }
  if (dateDefault !== "legacy") {
    raw.dateRepresentation = dateDefault;
    changed = true;
  } else if (Object.hasOwn(raw, "dateRepresentation")) {
    delete raw.dateRepresentation;
    changed = true;
  }
  // Each mode changes how the script runs, so an SDK that does not know the
  // mode must refuse the file instead of running the script with other values.
  // Only a decimal migration needs the newer format; the others stay readable by
  // SDKs that predate it.
  const recordedVersion = decimal ? DECIMAL_MIGRATION_FILE_VERSION : SCHEMA_SNAPSHOT_VERSION;
  if (
    (temporal || decimal || dateDefault !== "legacy") &&
    (typeof raw.version !== "number" || raw.version < recordedVersion)
  ) {
    raw.version = recordedVersion;
  }
  if (!changed) return;
  await fs.writeFile(diffPath, JSON.stringify(raw, null, 2));
}

/**
 * Write `db.ts` and `db.pglite.ts` for a migration, and record in its `diff.json`
 * whether `db.ts` uses Temporal or Decimal column types and which date representation
 * `t` fields default to, so the script later runs in those modes.
 * @param options - Snapshot, diff, and destination
 * @returns Paths of the written files
 */
export async function writeMigrationTypeFiles(
  options: WriteMigrationTypeFilesOptions,
): Promise<WriteMigrationTypeFilesResult> {
  const {
    previousSnapshot,
    diff,
    migrationsDir,
    migrationNumber,
    expandPlans = [],
    temporal = false,
    decimal = false,
    dateDefault = "legacy",
  } = options;
  const dbTypesPath = await writeDbTypesFile(
    previousSnapshot,
    migrationsDir,
    migrationNumber,
    diff,
    expandPlans,
    { temporal, decimal },
  );
  await recordRuntimeModes(
    getMigrationFilePath(migrationsDir, migrationNumber, "diff"),
    { temporal, decimal },
    dateDefault,
  );
  return {
    dbTypesPath,
    ...(await tryWritePgliteSchemaFile(previousSnapshot, diff, migrationsDir, migrationNumber)),
  };
}
