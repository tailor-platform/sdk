/**
 * PGlite schema for migration tests: the tables as the Pre-phase leaves them
 * while `migrate.ts` runs, rendered as a `CREATE TABLE` script module next to
 * `db.ts`.
 */

import * as fs from "node:fs/promises";
import { generatePgliteSchemaModule, type DDLTableConfig } from "#/utils/tailordb-ddl";
import { writeDbTypesFile } from "./db-types-generator";
import {
  applyPreMigrationFieldAdjustmentsToSnapshot,
  applyPreMigrationIndexAdjustmentsToSnapshot,
  buildPreMigrationChangesMapFromDiffs,
  buildPreMigrationIndexChangesMapFromDiffs,
} from "./pre-migration-schema";
import { applyDiffToSnapshot, getMigrationFilePath } from "./snapshot";
import { copySnapshotRecord } from "./snapshot-normalization";
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
  const target = applyDiffToSnapshot(previousSnapshot, diff);
  const fieldChanges = buildPreMigrationChangesMapFromDiffs([diff]);
  const indexChanges = buildPreMigrationIndexChangesMapFromDiffs([diff]);

  const tables: DDLTableConfig[] = Object.values(target.tables).map((table) => {
    const fields = copySnapshotRecord(table.fields);
    const typeChanges = fieldChanges.get(table.name);
    if (typeChanges) applyPreMigrationFieldAdjustmentsToSnapshot(fields, typeChanges);
    const indexes = copySnapshotRecord(table.indexes);
    const typeIndexChanges = indexChanges.get(table.name);
    if (typeIndexChanges) applyPreMigrationIndexAdjustmentsToSnapshot(indexes, typeIndexChanges);
    return { name: table.name, fields, indexes };
  });

  for (const change of diff.changes) {
    if (change.kind === "table_removed" || change.kind === "table_renamed") {
      tables.push(toDDLTable(change.before));
    }
  }
  return tables;
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
export interface WriteMigrationTypeFilesOptions {
  /** Schema before the migration */
  previousSnapshot: SchemaSnapshot;
  /** The migration's diff */
  diff: MigrationDiff;
  migrationsDir: string;
  migrationNumber: number;
  /** Field changes carried through temporary fields */
  expandPlans?: readonly ExpandContractPlan[];
}

/** Files written by {@link writeMigrationTypeFiles}. */
export interface WriteMigrationTypeFilesResult {
  dbTypesPath: string;
  /** Undefined when the schema could not be expressed as DDL; see `pgliteSchemaError`. */
  pgliteSchemaPath?: string;
  /** Why `db.pglite.ts` was skipped */
  pgliteSchemaError?: string;
}

/**
 * Write `db.ts` and `db.pglite.ts` for a migration. The types are required
 * for the script itself, so a schema the DDL generator cannot express (an
 * unknown field type, a serial format it cannot reproduce) skips only the
 * PGlite file and reports why.
 * @param options - Snapshot, diff, and destination
 * @returns Paths of the written files
 */
export async function writeMigrationTypeFiles(
  options: WriteMigrationTypeFilesOptions,
): Promise<WriteMigrationTypeFilesResult> {
  const { previousSnapshot, diff, migrationsDir, migrationNumber, expandPlans = [] } = options;
  const dbTypesPath = await writeDbTypesFile(
    previousSnapshot,
    migrationsDir,
    migrationNumber,
    diff,
    expandPlans,
  );
  try {
    const pgliteSchemaPath = await writePgliteSchemaFile(
      previousSnapshot,
      diff,
      migrationsDir,
      migrationNumber,
    );
    return { dbTypesPath, pgliteSchemaPath };
  } catch (error) {
    return {
      dbTypesPath,
      pgliteSchemaError: error instanceof Error ? error.message : String(error),
    };
  }
}
