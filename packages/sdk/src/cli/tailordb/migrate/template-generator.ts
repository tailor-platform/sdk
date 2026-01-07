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
import { getMigrationDirPath, getMigrationFilePath } from "./types";
import type { SchemaSnapshot, MigrationDiff, DiffChange, SnapshotFieldConfig } from "./types";

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
 * @returns {Promise<GenerateDiffResult>} Generated file info
 */
export async function generateDiffFiles(
  diff: MigrationDiff,
  migrationsDir: string,
  migrationNumber: number,
  previousSnapshot: SchemaSnapshot,
  description?: string,
): Promise<GenerateDiffResult> {
  // Create migration directory
  const migrationDir = getMigrationDirPath(migrationsDir, migrationNumber);
  await fs.mkdir(migrationDir, { recursive: true });

  // Build file paths
  const diffFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "diff");
  const migrateFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "migrate");
  const dbTypesFilePath = getMigrationFilePath(migrationsDir, migrationNumber, "db");

  // Check if files already exist to prevent accidental overwrite
  await ensureFileNotExists(diffFilePath);
  if (diff.requiresMigrationScript) {
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

  // Generate migration script and db types only if migration script is required
  if (diff.requiresMigrationScript) {
    const scriptContent = generateMigrationScript(diff);
    await fs.writeFile(migrateFilePath, scriptContent);
    result.migrateFilePath = migrateFilePath;

    // Generate db.ts with types based on the PREVIOUS schema state
    // (the state before this migration runs)
    // Pass diff to generate ColumnType for optional->required fields
    await writeDbTypesFile(previousSnapshot, migrationsDir, migrationNumber, diff);
    result.dbTypesFilePath = dbTypesFilePath;
  }

  return result;
}

/**
 * Generate migration script content based on diff
 * @param {MigrationDiff} diff - Migration diff
 * @returns {string} Migration script content
 */
function generateMigrationScript(diff: MigrationDiff): string {
  const updates: string[] = [];

  for (const change of diff.changes) {
    const script = generateChangeScript(change);
    if (script) {
      updates.push(script);
    }
  }

  if (updates.length === 0) {
    updates.push(`  // No data migration needed for this schema change
  // Add custom data transformations if required`);
  }

  return `/**
 * Migration script for ${diff.namespace}
 *
 * This script handles data migration for breaking schema changes.
 * Edit this file to implement your data migration logic.
 *
 * The transaction is managed by the apply command.
 * If any operation fails, all changes will be rolled back.
 */

import type { Transaction } from "./db";

export async function main(trx: Transaction): Promise<void> {
${updates.join("\n\n")}
}
`;
}

/**
 * Generate script for a single change
 * @param {DiffChange} change - Diff change to generate script for
 * @returns {string | null} Script content or null if no script needed
 */
function generateChangeScript(change: DiffChange): string | null {
  if (change.kind === "field_added") {
    const field = change.after as SnapshotFieldConfig;
    if (field.required) {
      return `  // Populate ${change.fieldName} for existing ${change.typeName} records
  await trx
    .updateTable("${change.typeName}")
    .set({
      ${change.fieldName}: null, // TODO: Set appropriate default value
    })
    .execute();`;
    }
    return null;
  }

  if (change.kind !== "field_modified") {
    // No data migration needed for type_added, type_removed, or field_removed
    return null;
  }

  const before = change.before as SnapshotFieldConfig;
  const after = change.after as SnapshotFieldConfig;

  // Type change
  if (before.type !== after.type) {
    return `  // Migrate ${change.fieldName} from ${before.type} to ${after.type}
  // TODO: Implement data conversion logic
  // const records = await trx.selectFrom("${change.typeName}").selectAll().execute();
  // for (const record of records) {
  //   const convertedValue = /* convert record.${change.fieldName} */;
  //   await trx
  //     .updateTable("${change.typeName}")
  //     .set({ ${change.fieldName}: convertedValue })
  //     .where("id", "=", record.id)
  //     .execute();
  // }`;
  }

  // Optional to required
  if (!before.required && after.required) {
    return `  // Set ${change.fieldName} for ${change.typeName} records where it is null
  await trx
    .updateTable("${change.typeName}")
    .set({
      ${change.fieldName}: null, // TODO: Set appropriate default value
    })
    .where("${change.fieldName}", "is", null)
    .execute();`;
  }

  // Note: Array to single value change is rejected in generate.ts
  // No script generation needed here

  // Unique constraint added
  if (!(before.unique ?? false) && (after.unique ?? false)) {
    return `  // TODO: Ensure ${change.fieldName} values are unique before adding constraint
  const duplicates = await trx
    .selectFrom("${change.typeName}")
    .select(["${change.fieldName}"])
    .groupBy("${change.fieldName}")
    .having((eb) => eb.fn.count("id"), ">", 1)
    .execute();
  for (const dup of duplicates) {
    // Example: Keep first record, add suffix to others
    // const records = await trx
    //   .selectFrom("${change.typeName}")
    //   .select(["id", "${change.fieldName}"])
    //   .where("${change.fieldName}", "=", dup.${change.fieldName})
    //   .execute();
    // for (let i = 1; i < records.length; i++) {
    //   await trx
    //     .updateTable("${change.typeName}")
    //     .set({ ${change.fieldName}: \`\${records[i].${change.fieldName}}_\${i}\` })
    //     .where("id", "=", records[i].id)
    //     .execute();
    // }
  }`;
  }

  // Enum values removed
  if (before.type === "enum" && after.type === "enum") {
    const beforeValues = before.allowedValues ?? [];
    const afterValues = after.allowedValues ?? [];
    const removedValues = beforeValues.filter((v) => !afterValues.includes(v));
    if (removedValues.length > 0) {
      const defaultValue = afterValues[0] ?? "NEW_VALUE";
      return `  // Migrate records with removed enum values: ${removedValues.join(", ")}
  await trx
    .updateTable("${change.typeName}")
    .set({ ${change.fieldName}: "${defaultValue}" }) // TODO: Set appropriate value
    .where("${change.fieldName}", "in", [${removedValues.map((v) => `"${v}"`).join(", ")}])
    .execute();`;
    }
  }

  return null;
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
