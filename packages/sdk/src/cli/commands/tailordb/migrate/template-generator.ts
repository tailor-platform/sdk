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
import {
  DEFAULT_DECIMAL_SCALE,
  getMigrationDirPath,
  getMigrationFilePath,
  isBreakingIndexChange,
  type SchemaSnapshot,
} from "./snapshot";
import type { MigrationDiff, DiffChange, FieldRenamedChange } from "./diff-calculator";
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

  // The expand migration only adds an optional field and removes the original,
  // neither of which is breaking, but its conversion script is what carries the
  // data across.
  const writeScript = diff.requiresMigrationScript || expandPlans.length > 0;

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

  for (const plan of expandPlans) {
    updates.push(generateExpandConversionScript(plan));
  }

  for (const change of diff.changes) {
    const decimalScaleScript = generateDecimalScaleChangeScript(change);
    updates.push(...generateChangeScripts(change, decimalScaleScript !== null));
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
 * @returns {string[]} Script contents, or an empty array if no script is needed
 */
function generateChangeScripts(change: DiffChange, deferUniqueConstraint = false): string[] {
  if (change.kind === "index_added" || change.kind === "index_modified") {
    const before = change.kind === "index_modified" ? change.before : undefined;
    if (!isBreakingIndexChange(change.typeName, change.indexName, before, change.after)) {
      return [];
    }
    const fields = change.after.fields;
    const fieldList = fields.map((f) => `"${f}"`).join(", ");
    const whereClauses = fields.map((f) => `.where("${f}", "=", dup.${f})`).join("\n        ");
    return [
      `  // Resolve duplicate (${fields.join(", ")}) combinations before unique index "${change.indexName}" is enforced
  {
    const duplicates = await trx
      .selectFrom("${change.typeName}")
      .select([${fieldList}])
      .groupBy([${fieldList}])
      .having((eb) => eb.fn.count("id"), ">", 1)
      .execute();
    for (const dup of duplicates) {
      const records = await trx
        .selectFrom("${change.typeName}")
        .select(["id"])
        ${whereClauses}
        .execute();
      // Keep the first record; update or delete the others so the combination becomes unique
      for (let i = 1; i < records.length; i++) {
        await trx
          .updateTable("${change.typeName}")
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
        `  // Populate ${change.fieldName} for existing ${change.typeName} records
  await trx
    .updateTable("${change.typeName}")
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
      scripts.push(generateUniqueDedupeScript(change.typeName, change.fieldName, "suffix"));
    }
    return scripts;
  }

  if (change.kind !== "field_modified" && change.kind !== "field_type_modified") {
    // No data migration needed for type_added, type_removed, or field_removed
    return [];
  }

  const { before, after } = change;
  const scripts: string[] = [];

  if (change.kind === "field_type_modified") {
    scripts.push(generateFieldTypeChangeScript(change));
  }

  // Optional to required
  if (!before.required && after.required) {
    scripts.push(`  // Set ${change.fieldName} for ${change.typeName} records where it is null
  await trx
    .updateTable("${change.typeName}")
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
    .updateTable("${change.typeName}")
    .set({ ${change.fieldName}: "${defaultValue}" }) // TODO: Set appropriate value
    .where("${change.fieldName}", "in", [${removedValues.map((v) => `"${v}"`).join(", ")}])
    .execute();`);
    }
  }

  // Foreign key relationship changed
  if (
    before.foreignKeyType &&
    after.foreignKeyType &&
    before.foreignKeyType !== after.foreignKeyType
  ) {
    scripts.push(`  // Migrate ${change.fieldName} references from ${before.foreignKeyType} to ${after.foreignKeyType}
  // Find records that don't have a valid reference in the new target table
  {
    const orphanedRecords = await trx
      .selectFrom("${change.typeName}")
      .leftJoin("${after.foreignKeyType}", "${change.typeName}.${change.fieldName}", "${after.foreignKeyType}.id")
      .select(["${change.typeName}.id", "${change.typeName}.${change.fieldName}"])
      .where("${after.foreignKeyType}.id", "is", null)
      .where("${change.typeName}.${change.fieldName}", "is not", null)
      .execute();
    for (const record of orphanedRecords) {
      await trx
        .updateTable("${change.typeName}")
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
  const { typeName, fieldName, previousFieldName, before, after } = change;
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

  return `  // Copy ${typeName}.${previousFieldName} into ${fieldName} for every row.
  // Overwrite unconditionally: stored values of previously removed fields are
  // not pruned, so a stale value could otherwise resurface under ${fieldName}.${requiredTodo}${roundingWarning}
  await trx
    .updateTable("${typeName}")
    .set((eb) => ({ ${fieldName}: eb.ref("${previousFieldName}") }))
    .execute();`;
}

function generateFieldTypeChangeScript(
  change: Extract<DiffChange, { kind: "field_type_modified" }>,
): string {
  return `  // Normalize ${change.typeName}.${change.fieldName} from ${change.before.type} to ${change.after.type} while the previous type is still active
  {
    let lastId: string | undefined;
    while (true) {
      let query = trx
        .selectFrom("${change.typeName}")
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
          .updateTable("${change.typeName}")
          .set({ [${JSON.stringify(change.fieldName)}]: normalizedValue })
          .where("id", "=", row.id)
          .execute();
      }
      lastId = rows[rows.length - 1]!.id;
    }
  }`;
}

function generateExpandConversionScript(plan: ExpandContractPlan): string {
  return `  // Convert ${plan.typeName}.${plan.fieldName} into ${plan.tempFieldName}, which the next migration renames back to ${plan.fieldName}
  {
    while (true) {
      const rows = await trx
        .selectFrom("${plan.typeName}")
        .select(["id", "${plan.fieldName}"])
        .where("${plan.fieldName}", "is not", null)
        .orderBy("id", "asc")
        .limit(100)
        .execute();
      if (rows.length === 0) break;

      for (const row of rows) {
        // ${MIGRATION_REVIEW_REQUIRED_MARKER}: Remove this marker and the \`never\` annotation after reviewing the conversion.
        // Produce a value accepted by the ${plan.after.type} type from the stored ${plan.before.type} value.
        const sourceValue = row.${plan.fieldName};
        if (sourceValue === null) continue;
        const convertedValue: never = sourceValue;
        // Clearing ${plan.fieldName} in the same update is what removes it from the
        // batch filter, so a re-run cannot overwrite an already converted row.
        await trx
          .updateTable("${plan.typeName}")
          .set({
            [${JSON.stringify(plan.tempFieldName)}]: convertedValue,
            [${JSON.stringify(plan.fieldName)}]: null,
          })
          .where("id", "=", row.id)
          .execute();
      }
    }
  }`;
}

function generateUniqueConstraintScript(change: DiffChange): string | null {
  if (change.kind !== "field_modified" && change.kind !== "field_type_modified") return null;

  const { before, after } = change;
  if ((before.unique ?? false) || !(after.unique ?? false)) return null;

  return generateUniqueDedupeScript(
    change.typeName,
    change.fieldName,
    change.kind === "field_type_modified" ? "throw" : "suffix",
  );
}

function generateUniqueDedupeScript(
  typeName: string,
  fieldName: string,
  resolution: "suffix" | "throw",
): string {
  const duplicateResolution =
    resolution === "throw"
      ? `      if (records.length > 1) {
        throw new Error(
          "TODO: Resolve duplicate ${typeName}.${fieldName} values before adding the unique constraint",
        );
      }`
      : `      // Keep first record, add suffix to others
      for (let i = 1; i < records.length; i++) {
        await trx
          .updateTable("${typeName}")
          .set({ ${fieldName}: \`\${records[i].${fieldName}}_\${i}\` }) // TODO: Set appropriate unique value
          .where("id", "=", records[i].id)
          .execute();
      }`;

  return `  // Ensure ${fieldName} values are unique before adding constraint
  {
    const duplicates = await trx
      .selectFrom("${typeName}")
      .select(["${fieldName}"])
      .groupBy("${fieldName}")
      .having((eb) => eb.fn.count("id"), ">", 1)
      .execute();
    for (const dup of duplicates) {
      // Load every record in this duplicate group before resolving it
      const records = await trx
        .selectFrom("${typeName}")
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

  return `  // Re-save existing ${change.typeName} rows so ${change.fieldName} is stored under the new scale.
  // This is a workaround for a platform-side gap where rows written under the
  // previous scale could fail on later updates until re-saved. Keep it unless
  // your platform is confirmed to handle stored values across scale changes.${roundingWarning}
  {
    let lastId: string | undefined;
    while (true) {
      let query = trx
        .selectFrom("${change.typeName}")
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
          .updateTable("${change.typeName}")
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
