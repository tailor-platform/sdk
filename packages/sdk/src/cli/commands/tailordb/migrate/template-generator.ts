/**
 * Template generator for TailorDB migrations
 *
 * Generates migration files in directory structure:
 * - XXXX/schema.json - Full schema snapshot (initial migration 0000)
 * - XXXX/diff.json - Schema diff (subsequent migrations 0001+)
 * - XXXX/migrate.ts - Data migration script (when breaking changes exist)
 * - XXXX/db.ts - Generated types for migration script
 */

import * as fs from "node:fs/promises";
import { writeDbTypesFile } from "./db-types-generator";
import { isBreakingForeignKeyRetarget } from "./rename-detection";
import {
  DEFAULT_DECIMAL_SCALE,
  getMigrationDirPath,
  getMigrationFilePath,
  isBreakingIndexChange,
  type SchemaSnapshot,
} from "./snapshot";
import type {
  MigrationDiff,
  DiffChange,
  FieldRenamedChange,
  TableRenamedChange,
} from "./diff-calculator";
import type { ExpandContractPlan } from "./expand-contract";

/** Marker left in generated migration scripts until their normalization logic is reviewed. */
export const MIGRATION_REVIEW_REQUIRED_MARKER = "TODO(tailor-migration-review)";

/**
 * Check if a file exists
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} True if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a file does not already exist, throwing an error if it does
 * @param {string} filePath - Path to check
 * @throws {Error} If file already exists
 */
async function ensureFileNotExists(filePath: string): Promise<void> {
  if (await fileExists(filePath)) {
    throw new Error(`Migration file already exists: ${filePath}`);
  }
}

interface GenerateSchemaResult {
  filePath: string;
  migrationNumber: number;
}

interface GenerateDiffResult {
  diffFilePath: string;
  migrateFilePath?: string;
  dbTypesFilePath?: string;
  migrationNumber: number;
}

/**
 * Generate the initial schema snapshot file
 * @param {SchemaSnapshot} snapshot - Schema snapshot to save
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} migrationNumber - Migration number
 * @returns {Promise<GenerateSchemaResult>} Generated file info
 */
export async function generateSchemaFile(
  snapshot: SchemaSnapshot,
  migrationsDir: string,
  migrationNumber: number,
): Promise<GenerateSchemaResult> {
  // Create migration directory
  const migrationDir = getMigrationDirPath(migrationsDir, migrationNumber);
  await fs.mkdir(migrationDir, { recursive: true });

  const filePath = getMigrationFilePath(migrationsDir, migrationNumber, "schema");

  // Check if file already exists to prevent accidental overwrite
  await ensureFileNotExists(filePath);

  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2));

  return {
    filePath,
    migrationNumber,
  };
}

/**
 * Generate diff and optional migration script files
 * @param {MigrationDiff} diff - Migration diff to save
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} migrationNumber - Migration number
 * @param {SchemaSnapshot} previousSnapshot - Previous schema snapshot (for db.ts generation)
 * @param {string} [description] - Optional description for the migration
 * @param expandPlans - Field changes carried through temporary fields
 * @returns {Promise<GenerateDiffResult>} Generated file info
 */
export async function generateDiffFiles(
  diff: MigrationDiff,
  migrationsDir: string,
  migrationNumber: number,
  previousSnapshot: SchemaSnapshot,
  description?: string,
  expandPlans: readonly ExpandContractPlan[] = [],
): Promise<GenerateDiffResult> {
  // Create migration directory
  const migrationDir = getMigrationDirPath(migrationsDir, migrationNumber);
  await fs.mkdir(migrationDir, { recursive: true });

  // Build file paths
  const diffFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "diff");
  const migrateFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "migrate");
  const dbTypesFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "db");

  const writeScript = diff.requiresMigrationScript;

  // Check if files already exist to prevent accidental overwrite
  await ensureFileNotExists(diffFilePath);
  if (writeScript) {
    await ensureFileNotExists(migrateFilePath);
    await ensureFileNotExists(dbTypesFilePath);
  }

  // Add description if provided
  if (description) {
    diff = { ...diff, description };
  }

  // Write diff file
  await fs.writeFile(diffFilePath, JSON.stringify(diff, null, 2));

  const result: GenerateDiffResult = {
    diffFilePath,
    migrationNumber,
  };

  if (writeScript) {
    const scriptContent = generateMigrationScript(diff, expandPlans);
    await fs.writeFile(migrateFilePath, scriptContent);
    result.migrateFilePath = migrateFilePath;

    // Generate db.ts with types based on the PREVIOUS schema state
    // (the state before this migration runs)
    // Pass diff to generate ColumnType for optional->required fields
    await writeDbTypesFile(previousSnapshot, migrationsDir, migrationNumber, diff, expandPlans);
    result.dbTypesFilePath = dbTypesFilePath;
  }

  return result;
}

/** Inputs for {@link generateDataOnlyMigrationFiles}. */
interface GenerateDataOnlyFilesOptions {
  /** Empty diff marked as requiring a migration script. */
  diff: MigrationDiff;
  migrationsDir: string;
  migrationNumber: number;
  /** Schema the migration runs against, used for db.ts generation. */
  snapshot: SchemaSnapshot;
  description?: string;
}

/** Files written for a data-only migration. */
interface GenerateDataOnlyFilesResult {
  diffFilePath: string;
  migrateFilePath: string;
  dbTypesFilePath: string;
  migrationNumber: number;
}

/**
 * Generate the files for a data-only migration: an empty diff and a migration
 * script skeleton typed against the unchanged schema.
 * @param {GenerateDataOnlyFilesOptions} options - Diff, output location, and schema for db.ts
 * @returns {Promise<GenerateDataOnlyFilesResult>} Generated file info
 */
export async function generateDataOnlyMigrationFiles(
  options: GenerateDataOnlyFilesOptions,
): Promise<GenerateDataOnlyFilesResult> {
  const { migrationsDir, migrationNumber, snapshot, description } = options;
  const migrationDir = getMigrationDirPath(migrationsDir, migrationNumber);
  await fs.mkdir(migrationDir, { recursive: true });

  const diffFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "diff");
  const migrateFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "migrate");
  const dbTypesFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "db");

  await ensureFileNotExists(diffFilePath);
  await ensureFileNotExists(migrateFilePath);
  await ensureFileNotExists(dbTypesFilePath);

  const diff = description ? { ...options.diff, description } : options.diff;
  await fs.writeFile(diffFilePath, JSON.stringify(diff, null, 2));
  await fs.writeFile(migrateFilePath, generateDataOnlyMigrationScript(diff.namespace));
  await writeDbTypesFile(snapshot, migrationsDir, migrationNumber, diff);

  return { diffFilePath, migrateFilePath, dbTypesFilePath, migrationNumber };
}

/**
 * Generate the script skeleton for a data-only migration
 * @param {string} namespace - TailorDB namespace the migration belongs to
 * @returns {string} Migration script content
 */
export function generateDataOnlyMigrationScript(namespace: string): string {
  return `/**
 * Data-only migration script for ${namespace}
 *
 * This migration carries no schema change; it exists to run this script.
 * Edit this file to implement the data transformation.
 *
 * The transaction is managed by the deploy command.
 * If any operation fails, all changes will be rolled back.
 */

import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
  // TODO: Implement the data transformation for this migration
}
`;
}

/**
 * Generate migration script content based on diff
 * @param {MigrationDiff} diff - Migration diff
 * @param expandPlans - Field changes carried through temporary fields
 * @returns {string} Migration script content
 */
export function generateMigrationScript(
  diff: MigrationDiff,
  expandPlans: readonly ExpandContractPlan[] = [],
): string {
  const updates: string[] = [];
  const typeRenameTargets = new Map(
    diff.changes
      .filter((change): change is TableRenamedChange => change.kind === "table_renamed")
      .map((change) => [change.previousTableName, change.tableName]),
  );

  for (const plan of expandPlans) {
    updates.push(generateExpandConversionScript(plan));
  }

  for (const change of diff.changes) {
    const decimalScaleScript = generateDecimalScaleChangeScript(change);
    updates.push(...generateChangeScripts(change, decimalScaleScript !== null, typeRenameTargets));
    if (decimalScaleScript) {
      updates.push(decimalScaleScript);

      const uniqueConstraintScript = generateUniqueConstraintScript(change);
      if (uniqueConstraintScript) {
        updates.push(uniqueConstraintScript);
      }
    }
  }

  if (updates.length === 0) {
    updates.push(`  // No data migration needed for this schema change
  // Add custom data transformations if required`);
  }

  return `/**
 * Migration script for ${diff.namespace}
 *
 * This script runs between the Pre-migration and Post-migration phases of
 * 'tailor deploy'. Use it to transform existing data so that the schema
 * change can complete safely (for breaking changes, this is hard-required;
 * for warning-tier changes it is optional). Edit this file to implement
 * your data migration logic.
 *
 * The transaction is managed by the deploy command.
 * If any operation fails, all changes will be rolled back.
 */

import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
${updates.join("\n\n")}
}
`;
}

/**
 * Generate migration test file content
 * @param {MigrationDiff} diff - Migration diff
 * @returns {string} Migration test file content
 */
export function generateMigrationTestScript(diff: MigrationDiff): string {
  return `/**
 * Unit test for the ${diff.namespace} migration script.
 *
 * The mock compiles queries to the same SQL as the deployed migration, so the
 * test verifies the exact statements migrate.ts issues. Stage the rows each
 * query returns, run main() inside a transaction, then assert the executed
 * statements.
 */

import { createKyselyMock } from "@tailor-platform/sdk/vitest";
import { describe, expect, test } from "vitest";
import type { Database } from "./db";
import { main } from "./migrate";

describe(${JSON.stringify(`${diff.namespace} migration`)}, () => {
  test("issues the intended statements", async () => {
    const mock = createKyselyMock<Database>();

    // Stage the rows each query returns, in execution order:
    // mock.enqueueResult([{ id: "record-1" }]);

    // Pass a MigrationContext when your main uses env: main(trx, { env: { ... } })
    await mock.withTx((trx) => main(trx));

    // Replace with assertions on the statements the script must issue:
    // expect(mock.updates).toHaveLength(1);
    // expect(mock.updates[0]?.updateValues()).toEqual({ field: "value" });
    expect(
      mock.executedQueries.map((query) => ({ sql: query.sql, parameters: query.parameters })),
    ).toMatchSnapshot();
  });
});
`;
}

/**
 * Generate scripts for a single change
 * @param {DiffChange} change - Diff change to generate script for
 * @param {boolean} deferUniqueConstraint - Generate the unique check after decimal re-serialization
 * @param {ReadonlyMap<string, string>} [typeRenameTargets] - Confirmed type renames (old name → new name)
 * @returns {string[]} Script contents, or an empty array if no script is needed
 */
function generateChangeScripts(
  change: DiffChange,
  deferUniqueConstraint = false,
  typeRenameTargets?: ReadonlyMap<string, string>,
): string[] {
  if (change.kind === "index_added" || change.kind === "index_modified") {
    const before = change.kind === "index_modified" ? change.before : undefined;
    if (!isBreakingIndexChange(change.tableName, change.indexName, before, change.after)) {
      return [];
    }
    const fields = change.after.fields;
    const fieldList = fields.map((f) => `"${f}"`).join(", ");
    const whereClauses = fields.map((f) => `.where("${f}", "=", dup.${f})`).join("\n        ");
    return [
      `  // Resolve duplicate (${fields.join(", ")}) combinations before unique index "${change.indexName}" is enforced
  {
    const duplicates = await trx
      .selectFrom("${change.tableName}")
      .select([${fieldList}])
      .groupBy([${fieldList}])
      .having((eb) => eb.fn.count("id"), ">", 1)
      .execute();
    for (const dup of duplicates) {
      const records = await trx
        .selectFrom("${change.tableName}")
        .select(["id"])
        ${whereClauses}
        .execute();
      // Keep the first record; update or delete the others so the combination becomes unique
      for (let i = 1; i < records.length; i++) {
        await trx
          .updateTable("${change.tableName}")
          .set({ ${fields[0]}: null }) // TODO: Set appropriate unique value
          .where("id", "=", records[i].id)
          .execute();
      }
    }
  }`,
    ];
  }

  if (change.kind === "field_added") {
    const field = change.after;
    if (field.required) {
      return [
        `  // Populate ${change.fieldName} for existing ${change.tableName} records
  await trx
    .updateTable("${change.tableName}")
    .set({
      ${change.fieldName}: null, // TODO: Set appropriate default value
    })
    .execute();`,
      ];
    }
    return [];
  }

  if (change.kind === "field_renamed") {
    const scripts = [generateFieldRenameCopyScript(change)];
    // The unique constraint is deferred to the post-migration phase, so
    // duplicates in the copied values must be resolved before it is enforced.
    // A previously unique source still needs the check when the copy itself
    // can collapse distinct values (e.g. a decreased decimal scale rounds
    // 1.231 and 1.232 both to 1.23).
    if (
      (change.after.unique ?? false) &&
      (!(change.before.unique ?? false) || renameCopyCanCollapseValues(change))
    ) {
      scripts.push(generateUniqueDedupeScript(change.tableName, change.fieldName, "suffix"));
    }
    return scripts;
  }

  if (change.kind === "table_renamed") {
    return [generateTypeRenameCopyScript(change)];
  }

  if (change.kind !== "field_modified" && change.kind !== "field_type_modified") {
    // No data migration needed for table_added, table_removed, or field_removed
    return [];
  }

  const { before, after } = change;
  const scripts: string[] = [];

  if (change.kind === "field_type_modified") {
    scripts.push(generateFieldTypeChangeScript(change));
  }

  // Optional to required
  if (!before.required && after.required) {
    scripts.push(`  // Set ${change.fieldName} for ${change.tableName} records where it is null
  await trx
    .updateTable("${change.tableName}")
    .set({
      ${change.fieldName}: null, // TODO: Set appropriate default value
    })
    .where("${change.fieldName}", "is", null)
    .execute();`);
  }

  // Note: Array to single value change is rejected in generate.ts
  // No script generation needed here

  // Unique constraint added
  if (!deferUniqueConstraint) {
    const uniqueConstraintScript = generateUniqueConstraintScript(change);
    if (uniqueConstraintScript) {
      scripts.push(uniqueConstraintScript);
    }
  }

  // Enum values removed
  if (before.type === "enum" && after.type === "enum") {
    const beforeValues = (before.allowedValues ?? []).map((v) => v.value);
    const afterValues = (after.allowedValues ?? []).map((v) => v.value);
    const removedValues = beforeValues.filter((v) => !afterValues.includes(v));
    if (removedValues.length > 0) {
      const defaultValue = afterValues[0] ?? "NEW_VALUE";
      scripts.push(`  // Migrate records with removed enum values: ${removedValues.join(", ")}
  await trx
    .updateTable("${change.tableName}")
    .set({ ${change.fieldName}: "${defaultValue}" }) // TODO: Set appropriate value
    .where("${change.fieldName}", "in", [${removedValues.map((v) => `"${v}"`).join(", ")}])
    .execute();`);
    }
  }

  // Foreign key relationship changed. A retarget that follows a confirmed
  // type rename needs no fixup: record ids are preserved by the rename copy.
  if (isBreakingForeignKeyRetarget(before, after, typeRenameTargets)) {
    scripts.push(`  // Migrate ${change.fieldName} references from ${before.foreignKeyType} to ${after.foreignKeyType}
  // Find records that don't have a valid reference in the new target table
  {
    const orphanedRecords = await trx
      .selectFrom("${change.tableName}")
      .leftJoin("${after.foreignKeyType}", "${change.tableName}.${change.fieldName}", "${after.foreignKeyType}.id")
      .select(["${change.tableName}.id", "${change.tableName}.${change.fieldName}"])
      .where("${after.foreignKeyType}.id", "is", null)
      .where("${change.tableName}.${change.fieldName}", "is not", null)
      .execute();
    for (const record of orphanedRecords) {
      await trx
        .updateTable("${change.tableName}")
        .set({ ${change.fieldName}: null }) // TODO: Set appropriate new reference
        .where("id", "=", record.id)
        .execute();
    }
  }`);
  }

  return scripts;
}

function renameCopyCanCollapseValues(change: FieldRenamedChange): boolean {
  const { before, after } = change;
  if (before.type !== "decimal" || after.type !== "decimal") return false;
  return (after.scale ?? DEFAULT_DECIMAL_SCALE) < (before.scale ?? DEFAULT_DECIMAL_SCALE);
}

function generateFieldRenameCopyScript(change: FieldRenamedChange): string {
  const { tableName, fieldName, previousFieldName, before, after } = change;
  const requiredTodo =
    !before.required && after.required
      ? `
  // TODO: ${previousFieldName} is optional but ${fieldName} is required.
  // Resolve null values, or the post-migration phase will fail.`
      : "";
  const roundingWarning = renameCopyCanCollapseValues(change)
    ? `
  // WARNING: ${fieldName} has a smaller decimal scale than ${previousFieldName}, so
  // copied values that exceed it may be rounded half-up. Review the resulting
  // precision before deploying.`
    : "";

  return `  // Copy ${tableName}.${previousFieldName} into ${fieldName} for every row.
  // Overwrite unconditionally: stored values of previously removed fields are
  // not pruned, so a stale value could otherwise resurface under ${fieldName}.${requiredTodo}${roundingWarning}
  await trx
    .updateTable("${tableName}")
    .set((eb) => ({ ${fieldName}: eb.ref("${previousFieldName}") }))
    .execute();`;
}

function generateTypeRenameCopyScript(change: TableRenamedChange): string {
  const { tableName, previousTableName } = change;
  const columns = ["id", ...Object.keys(change.before.fields).filter((name) => name !== "id")];
  const columnList = columns.map((name) => JSON.stringify(name)).join(", ");
  // Self-referential foreign keys may point at rows in later batches, so they
  // are inserted as null and backfilled once every row exists.
  const selfRefColumns = Object.entries(change.after.fields)
    .filter(([, field]) => field.foreignKeyType === tableName)
    .map(([name]) => name);
  const insertValues =
    selfRefColumns.length > 0
      ? `rows.map((row) => ({ ...row, ${selfRefColumns.map((name) => `${name}: null`).join(", ")} }))`
      : "rows";
  const selfRefBackfill =
    selfRefColumns.length > 0
      ? `

  // Backfill the self-referential column(s) now that every row exists.
  await trx
    .updateTable("${tableName}")
    .set((eb) => ({
${selfRefColumns
  .map(
    (name) => `      ${name}: eb
        .selectFrom("${previousTableName}")
        .select("${previousTableName}.${name}")
        .whereRef("${previousTableName}.id", "=", "${tableName}.id"),`,
  )
  .join("\n")}
    }))
    .execute();`
      : "";

  return `  // Copy every ${previousTableName} row into ${tableName}, preserving ids so that
  // stored foreign key references remain valid. ${previousTableName} stays readable
  // until the post-migration phase drops it.
  {
    let lastId: string | undefined;
    while (true) {
      let query = trx
        .selectFrom("${previousTableName}")
        .select([${columnList}])
        .orderBy("id", "asc")
        .limit(100);
      if (lastId) {
        query = query.where("id", ">", lastId);
      }
      const rows = await query.execute();
      if (rows.length === 0) break;

      await trx.insertInto("${tableName}").values(${insertValues}).execute();
      lastId = rows[rows.length - 1]!.id;
    }
  }${selfRefBackfill}`;
}

function generateFieldTypeChangeScript(
  change: Extract<DiffChange, { kind: "field_type_modified" }>,
): string {
  return `  // Normalize ${change.tableName}.${change.fieldName} from ${change.before.type} to ${change.after.type} while the previous type is still active
  {
    let lastId: string | undefined;
    while (true) {
      let query = trx
        .selectFrom("${change.tableName}")
        .select(["id", "${change.fieldName}"])
        .where("${change.fieldName}", "is not", null)
        .orderBy("id", "asc")
        .limit(100);
      if (lastId) {
        query = query.where("id", ">", lastId);
      }
      const rows = await query.execute();
      if (rows.length === 0) break;

      for (const row of rows) {
        // ${MIGRATION_REVIEW_REQUIRED_MARKER}: Remove this marker and the \`never\` annotation after reviewing the normalization.
        // Keep the value accepted by the active ${change.before.type} type and castable to ${change.after.type}.
        const sourceValue = row.${change.fieldName};
        if (sourceValue === null) continue;
        const normalizedValue: never = sourceValue;
        if (Object.is(normalizedValue, sourceValue)) continue;
        await trx
          .updateTable("${change.tableName}")
          .set({ [${JSON.stringify(change.fieldName)}]: normalizedValue })
          .where("id", "=", row.id)
          .execute();
      }
      lastId = rows[rows.length - 1]!.id;
    }
  }`;
}

function generateExpandConversionScript(plan: ExpandContractPlan): string {
  return `  // Convert ${plan.tableName}.${plan.fieldName} into ${plan.tempFieldName}, which the next migration renames back to ${plan.fieldName}
  {
    let lastId: string | undefined;
    while (true) {
      let query = trx
        .selectFrom("${plan.tableName}")
        .select(["id", "${plan.fieldName}"])
        .where("${plan.fieldName}", "is not", null)
        .orderBy("id", "asc")
        .limit(100);
      if (lastId) {
        query = query.where("id", ">", lastId);
      }
      const rows = await query.execute();
      if (rows.length === 0) break;

      for (const row of rows) {
        // ${MIGRATION_REVIEW_REQUIRED_MARKER}: Remove this marker and the \`never\` annotation after reviewing the conversion.
        // Produce a value accepted by the ${plan.after.type} type from the stored ${plan.before.type} value.
        const sourceValue = row.${plan.fieldName};
        const convertedValue: never = sourceValue;
        // Clearing ${plan.fieldName} keeps a re-run from converting the row twice.
        await trx
          .updateTable("${plan.tableName}")
          .set({
            [${JSON.stringify(plan.tempFieldName)}]: convertedValue,
            [${JSON.stringify(plan.fieldName)}]: null,
          })
          .where("id", "=", row.id)
          .execute();
      }
      lastId = rows[rows.length - 1]!.id;
    }
  }`;
}

function generateUniqueConstraintScript(change: DiffChange): string | null {
  if (change.kind !== "field_modified" && change.kind !== "field_type_modified") return null;

  const { before, after } = change;
  if ((before.unique ?? false) || !(after.unique ?? false)) return null;

  return generateUniqueDedupeScript(
    change.tableName,
    change.fieldName,
    change.kind === "field_type_modified" ? "throw" : "suffix",
  );
}

function generateUniqueDedupeScript(
  tableName: string,
  fieldName: string,
  resolution: "suffix" | "throw",
): string {
  const duplicateResolution =
    resolution === "throw"
      ? `      if (records.length > 1) {
        throw new Error(
          "TODO: Resolve duplicate ${tableName}.${fieldName} values before adding the unique constraint",
        );
      }`
      : `      // Keep first record, add suffix to others
      for (let i = 1; i < records.length; i++) {
        await trx
          .updateTable("${tableName}")
          .set({ ${fieldName}: \`\${records[i].${fieldName}}_\${i}\` }) // TODO: Set appropriate unique value
          .where("id", "=", records[i].id)
          .execute();
      }`;

  return `  // Ensure ${fieldName} values are unique before adding constraint
  {
    const duplicates = await trx
      .selectFrom("${tableName}")
      .select(["${fieldName}"])
      .groupBy("${fieldName}")
      .having((eb) => eb.fn.count("id"), ">", 1)
      .execute();
    for (const dup of duplicates) {
      // Load every record in this duplicate group before resolving it
      const records = await trx
        .selectFrom("${tableName}")
        .select(["id", "${fieldName}"])
        .where("${fieldName}", "=", dup.${fieldName})
        .execute();
${duplicateResolution}
    }
  }`;
}

function generateDecimalScaleChangeScript(change: DiffChange): string | null {
  if (change.kind !== "field_modified") return null;

  const { before, after } = change;
  if (before.type !== "decimal" || after.type !== "decimal" || before.scale === after.scale)
    return null;

  const valueExpression =
    !before.required && after.required ? `row.${change.fieldName}!` : `row.${change.fieldName}`;
  const beforeScale = before.scale ?? DEFAULT_DECIMAL_SCALE;
  const afterScale = after.scale ?? DEFAULT_DECIMAL_SCALE;
  const roundingWarning =
    afterScale < beforeScale
      ? `
  // WARNING: Values that exceed the new scale may be rounded half-up, so
  // review the resulting precision before deploying.`
      : "";

  return `  // Re-save existing ${change.tableName} rows so ${change.fieldName} is stored under the new scale.
  // This is a workaround for a platform-side gap where rows written under the
  // previous scale could fail on later updates until re-saved. Keep it unless
  // your platform is confirmed to handle stored values across scale changes.${roundingWarning}
  {
    let lastId: string | undefined;
    while (true) {
      let query = trx
        .selectFrom("${change.tableName}")
        .select(["id", "${change.fieldName}"])
        .where("${change.fieldName}", "is not", null)
        .orderBy("id", "asc")
        .limit(100);
      if (lastId) {
        query = query.where("id", ">", lastId);
      }
      const rows = await query.execute();
      if (rows.length === 0) break;

      for (const row of rows) {
        await trx
          .updateTable("${change.tableName}")
          .set({ ${change.fieldName}: ${valueExpression} })
          .where("id", "=", row.id)
          .where("${change.fieldName}", "=", ${valueExpression})
          .execute();
      }
      lastId = rows[rows.length - 1]!.id;
    }
  }`;
}

/**
 * Check if a migration script exists for a given migration number
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} migrationNumber - Migration number
 * @returns {Promise<boolean>} True if script exists
 */
export async function migrationScriptExists(
  migrationsDir: string,
  migrationNumber: number,
): Promise<boolean> {
  const filePath = getMigrationFilePath(migrationsDir, migrationNumber, "migrate");
  return fileExists(filePath);
}

/**
 * Get the migration script path for a given migration number
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} migrationNumber - Migration number
 * @returns {string} Full path to migration script
 */
export function getMigrationScriptPath(migrationsDir: string, migrationNumber: number): string {
  return getMigrationFilePath(migrationsDir, migrationNumber, "migrate");
}
