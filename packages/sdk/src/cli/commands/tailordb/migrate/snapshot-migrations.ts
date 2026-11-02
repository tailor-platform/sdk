import * as fs from "node:fs";
import { CLIError } from "#/cli/shared/errors";
import { type MigrationDiff } from "./diff-calculator";
import { formatNamespaceMigrationHint } from "./hints";
import { formatMigrationNumber } from "./migration-number";
import {
  DIFF_FILE_NAME,
  INITIAL_SCHEMA_NUMBER,
  MIGRATION_FILE_NAMES,
  SCHEMA_FILE_NAME,
  getMigrationArtifacts,
  getMigrationFiles,
  loadDiff,
  loadSnapshot,
} from "./snapshot-files";
import { copySnapshotRecord, normalizeSchemaSnapshot } from "./snapshot-normalization";
import { type NormalizedSchemaSnapshot, type SchemaSnapshot } from "./snapshot-types";

/**
 * Apply a diff to a snapshot to get the resulting snapshot
 * @param {SchemaSnapshot} snapshot - Base snapshot to apply diff to
 * @param {MigrationDiff} diff - Diff to apply
 * @returns {NormalizedSchemaSnapshot} Normalized snapshot after applying diff
 */
export function applyDiffToSnapshot(
  snapshot: SchemaSnapshot,
  diff: MigrationDiff,
): NormalizedSchemaSnapshot {
  const tables = copySnapshotRecord(snapshot.tables);

  for (const change of diff.changes) {
    switch (change.kind) {
      case "table_added":
        tables[change.tableName] = change.after;
        break;
      case "table_removed":
        delete tables[change.tableName];
        break;
      case "table_modified": {
        const existing = tables[change.tableName];
        if (existing && change.after) {
          const after = change.after;
          tables[change.tableName] = {
            ...existing,
            ...(after.indexes !== undefined && { indexes: after.indexes }),
            ...(after.files !== undefined && { files: after.files }),
          };
        }
        break;
      }
      case "table_settings_modified": {
        const existing = tables[change.tableName];
        if (existing) {
          tables[change.tableName] = {
            ...existing,
            description: change.after.description,
            pluralForm: change.after.pluralForm,
            settings: change.after.settings ?? {},
          };
        }
        break;
      }
      case "table_scripts_modified": {
        const existing = tables[change.tableName];
        if (existing) {
          const { typeHookExpr: _, typeValidateExpr: __, ...rest } = existing;
          tables[change.tableName] = {
            ...rest,
            ...(change.after.typeHookExpr && { typeHookExpr: change.after.typeHookExpr }),
            ...(change.after.typeValidateExpr !== undefined && {
              typeValidateExpr: change.after.typeValidateExpr,
            }),
          };
        }
        break;
      }
      case "field_added":
      case "field_modified":
      case "field_type_modified": {
        const existing = tables[change.tableName];
        if (existing) {
          const fields = copySnapshotRecord(existing.fields);
          fields[change.fieldName] = change.after;
          tables[change.tableName] = {
            ...existing,
            fields,
          };
        }
        break;
      }
      case "field_removed": {
        const existing = tables[change.tableName];
        if (existing) {
          const remainingFields = copySnapshotRecord(existing.fields);
          delete remainingFields[change.fieldName];
          tables[change.tableName] = {
            ...existing,
            fields: remainingFields,
          };
        }
        break;
      }
      case "field_renamed": {
        const existing = tables[change.tableName];
        if (existing) {
          const fields = copySnapshotRecord(existing.fields);
          delete fields[change.previousFieldName];
          fields[change.fieldName] = change.after;
          tables[change.tableName] = {
            ...existing,
            fields,
          };
        }
        break;
      }
      case "table_renamed":
        delete tables[change.previousTableName];
        tables[change.tableName] = change.after;
        break;
      case "index_added":
      case "index_modified": {
        const existing = tables[change.tableName];
        if (existing) {
          const indexes = copySnapshotRecord(existing.indexes);
          indexes[change.indexName] = change.after;
          tables[change.tableName] = {
            ...existing,
            indexes,
          };
        }
        break;
      }
      case "index_removed": {
        const existing = tables[change.tableName];
        if (existing && existing.indexes) {
          const remainingIndexes = copySnapshotRecord(existing.indexes);
          delete remainingIndexes[change.indexName];
          tables[change.tableName] = {
            ...existing,
            indexes: Object.keys(remainingIndexes).length > 0 ? remainingIndexes : undefined,
          };
        }
        break;
      }
      case "file_added":
      case "file_modified": {
        const existing = tables[change.tableName];
        if (existing) {
          const files = copySnapshotRecord(existing.files);
          files[change.fieldName] = change.after;
          tables[change.tableName] = {
            ...existing,
            files,
          };
        }
        break;
      }
      case "file_removed": {
        const existing = tables[change.tableName];
        if (existing && existing.files) {
          const remainingFiles = copySnapshotRecord(existing.files);
          delete remainingFiles[change.fieldName];
          tables[change.tableName] = {
            ...existing,
            files: Object.keys(remainingFiles).length > 0 ? remainingFiles : undefined,
          };
        }
        break;
      }
      case "relationship_added":
      case "relationship_modified": {
        const existing = tables[change.tableName];
        if (existing) {
          const rel = change.after;
          // Use relationshipType if specified, fallback to existing logic for backwards compatibility
          const targetType =
            change.relationshipType ??
            (existing.forwardRelationships?.[change.relationshipName]
              ? "forward"
              : existing.backwardRelationships?.[change.relationshipName]
                ? "backward"
                : "forward");

          if (targetType === "forward") {
            const forwardRelationships = copySnapshotRecord(existing.forwardRelationships);
            forwardRelationships[change.relationshipName] = rel;
            tables[change.tableName] = {
              ...existing,
              forwardRelationships,
            };
          } else {
            const backwardRelationships = copySnapshotRecord(existing.backwardRelationships);
            backwardRelationships[change.relationshipName] = rel;
            tables[change.tableName] = {
              ...existing,
              backwardRelationships,
            };
          }
        }
        break;
      }
      case "relationship_removed": {
        const type = tables[change.tableName];
        if (type) {
          // Use relationshipType if specified
          const targetType =
            change.relationshipType ??
            (type.forwardRelationships?.[change.relationshipName]
              ? "forward"
              : type.backwardRelationships?.[change.relationshipName]
                ? "backward"
                : null);

          if (targetType === "forward" && type.forwardRelationships?.[change.relationshipName]) {
            const remaining = copySnapshotRecord(type.forwardRelationships);
            delete remaining[change.relationshipName];
            tables[change.tableName] = {
              ...type,
              forwardRelationships: Object.keys(remaining).length > 0 ? remaining : undefined,
            };
          } else if (
            targetType === "backward" &&
            type.backwardRelationships?.[change.relationshipName]
          ) {
            const remaining = copySnapshotRecord(type.backwardRelationships);
            delete remaining[change.relationshipName];
            tables[change.tableName] = {
              ...type,
              backwardRelationships: Object.keys(remaining).length > 0 ? remaining : undefined,
            };
          }
        }
        break;
      }
      case "permission_modified": {
        const existing = tables[change.tableName];
        if (existing && change.after) {
          const after = change.after;
          tables[change.tableName] = {
            ...existing,
            permissions: {
              record: after.recordPermission,
              gql: after.gqlPermission,
            },
          };
        }
        break;
      }
    }
  }

  return normalizeSchemaSnapshot({
    ...snapshot,
    tables,
    createdAt: diff.createdAt,
  });
}

/**
 * Reconstruct the latest schema snapshot from all migration files
 * Returns null if no migrations exist
 *
 * **Beta:** This API may change in future releases.
 * @param {string} migrationsDir - Migrations directory path
 * @param {number} [maxVersion] - Optional maximum migration version to apply
 * @returns {NormalizedSchemaSnapshot | null} Reconstructed normalized snapshot or null if no migrations exist
 */
export function reconstructSnapshotFromMigrations(
  migrationsDir: string,
  maxVersion?: number,
): NormalizedSchemaSnapshot | null {
  const files = getMigrationFiles(migrationsDir);
  if (files.length === 0) return null;

  // Find the initial schema file (should be 0000/schema.json)
  const schemaFile = files.find((f) => f.type === "schema" && f.number === INITIAL_SCHEMA_NUMBER);
  if (!schemaFile) {
    throw CLIError({
      code: "MIGRATION_BASELINE_NOT_FOUND",
      message: `No initial schema file found in ${migrationsDir}. Expected ${formatMigrationNumber(
        INITIAL_SCHEMA_NUMBER,
      )}/schema.json`,
    });
  }

  let snapshot = loadSnapshot(schemaFile.path);

  // Apply subsequent diffs in order (up to maxVersion if specified)
  for (const file of files) {
    if (file.type === "diff" && file.number > schemaFile.number) {
      // Skip diffs beyond maxVersion if specified
      if (maxVersion !== undefined && file.number > maxVersion) {
        continue;
      }
      const diff = loadDiff(file.path);
      snapshot = applyDiffToSnapshot(snapshot, diff);
    }
  }

  return snapshot;
}

// ============================================================================
// Migration Validation
// ============================================================================

/**
 * Validation error for migration files
 */
export interface MigrationValidationError {
  type:
    | "missing_schema"
    | "missing_diff"
    | "duplicate"
    | "gap"
    | "invalid_schema_number"
    | "invalid_diff_number";
  message: string;
  suggestion?: string;
  migrationNumber?: number;
}

/**
 * Validate migration files in a directory
 *
 * Checks:
 * - Schema file exists at 0000 (initial schema)
 * - No gaps in migration numbers
 * - No duplicate migration numbers (schema at 0000, diffs at 1+)
 * - No diff file at 0000
 * - Diff files exist for every migration directory 1+, including ones holding only migrate.ts or other generated files
 * @param {string} migrationsDir - Migrations directory path
 * @returns {MigrationValidationError[]} Array of validation errors (empty if valid)
 */
export function validateMigrationFiles(migrationsDir: string): MigrationValidationError[] {
  const errors: MigrationValidationError[] = [];

  if (!fs.existsSync(migrationsDir)) {
    // No migrations directory - this is valid (no migrations yet)
    return errors;
  }

  const artifacts = getMigrationArtifacts(migrationsDir);
  if (artifacts.length === 0) {
    // No migration files at all - valid
    return errors;
  }

  // Categorize files by type
  const schemaFiles: number[] = [];
  const diffFiles: number[] = [];

  for (const { number, fileTypes } of artifacts) {
    if (fileTypes.includes("schema")) schemaFiles.push(number);
    if (fileTypes.includes("diff")) diffFiles.push(number);
  }

  const allNumbers = artifacts.map(({ number }) => number);
  const lastDiffNumber = Math.max(INITIAL_SCHEMA_NUMBER, ...diffFiles);
  const hasLaterDiff = lastDiffNumber > INITIAL_SCHEMA_NUMBER;

  // Check for schema file at INITIAL_SCHEMA_NUMBER (0000)
  if (!schemaFiles.includes(INITIAL_SCHEMA_NUMBER)) {
    const label = formatMigrationNumber(INITIAL_SCHEMA_NUMBER);
    errors.push({
      type: "missing_schema",
      message: `Initial schema snapshot (${label}/${SCHEMA_FILE_NAME}) is missing`,
      suggestion:
        hasLaterDiff || allNumbers.includes(INITIAL_SCHEMA_NUMBER)
          ? missingFileSuggestion(label, SCHEMA_FILE_NAME, !hasLaterDiff)
          : undefined,
      migrationNumber: INITIAL_SCHEMA_NUMBER,
    });
  }

  // Check for schema files at wrong positions (only 0000 should have schema)
  for (const num of schemaFiles) {
    if (num !== INITIAL_SCHEMA_NUMBER) {
      errors.push({
        type: "invalid_schema_number",
        message: `Schema file found at migration ${formatMigrationNumber(
          num,
        )}, but schema should only exist at ${formatMigrationNumber(INITIAL_SCHEMA_NUMBER)}`,
        migrationNumber: num,
      });
    }
  }

  if (diffFiles.includes(INITIAL_SCHEMA_NUMBER)) {
    errors.push({
      type: "invalid_diff_number",
      message: `Migration ${formatMigrationNumber(INITIAL_SCHEMA_NUMBER)} must not have ${DIFF_FILE_NAME}`,
      migrationNumber: INITIAL_SCHEMA_NUMBER,
    });
  }

  // Check for duplicate files (same number with both schema and diff, except for INITIAL_SCHEMA_NUMBER)
  for (const num of schemaFiles) {
    if (num !== INITIAL_SCHEMA_NUMBER && diffFiles.includes(num)) {
      errors.push({
        type: "duplicate",
        message: `Migration ${formatMigrationNumber(num)} has both schema and diff files`,
        migrationNumber: num,
      });
    }
  }

  // Check for gaps in sequence (from INITIAL_SCHEMA_NUMBER to max)
  const maxNum = Math.max(...allNumbers);
  for (let i = INITIAL_SCHEMA_NUMBER; i <= maxNum; i++) {
    if (!allNumbers.includes(i)) {
      errors.push({
        type: "gap",
        message: `Migration ${formatMigrationNumber(i)} is missing (gap in sequence)`,
        migrationNumber: i,
      });
    }
  }

  // Check that migrations > INITIAL_SCHEMA_NUMBER have diff files
  for (const { number, fileTypes } of artifacts) {
    if (number === INITIAL_SCHEMA_NUMBER || fileTypes.includes("diff")) continue;
    if (fileTypes.includes("schema")) {
      errors.push({
        type: "missing_diff",
        message: `Migration ${formatMigrationNumber(number)} is missing diff file`,
        migrationNumber: number,
      });
      continue;
    }
    const label = formatMigrationNumber(number);
    const fileNames = fileTypes.map((type) => MIGRATION_FILE_NAMES[type]).join(", ");
    errors.push({
      type: "missing_diff",
      message: `Migration ${label} has ${fileNames} but no ${DIFF_FILE_NAME}`,
      suggestion: missingFileSuggestion(label, DIFF_FILE_NAME, number > lastDiffNumber),
      migrationNumber: number,
    });
  }

  return errors;
}

/**
 * Build the remediation for a migration directory that lacks a required file
 * @param {string} label - Formatted migration number
 * @param {string} fileName - Name of the missing file
 * @param {boolean} deletable - Whether deleting the directory leaves a valid history
 * @returns {string} Suggestion text
 */
function missingFileSuggestion(label: string, fileName: string, deletable: boolean): string {
  return deletable
    ? `Delete migration directory ${label} if it is a leftover, or restore its ${fileName}.`
    : `Restore ${fileName} in migration directory ${label}.`;
}

/**
 * Validate migration files and throw if invalid
 * @param {string} migrationsDir - Migrations directory path
 * @param {string} namespace - Namespace for error messages
 * @param {string} configPath - Config path the current run used, kept in the suggested command
 * @throws {Error} If validation fails
 */
export function assertValidMigrationFiles(
  migrationsDir: string,
  namespace: string,
  configPath: string,
): void {
  const errors = validateMigrationFiles(migrationsDir);
  if (errors.length > 0) {
    const errorMessages = errors.map((e) => `  - ${e.message}`).join("\n");
    const suggestions = new Set(errors.flatMap((e) => (e.suggestion ? [e.suggestion] : [])));
    if (errors.some((e) => e.suggestion === undefined)) {
      const initHint = formatNamespaceMigrationHint({
        subcommand: ["generate", "--init"],
        namespace,
        configPath,
      });
      suggestions.add(
        `Restore the migration files from version control. If no workspace has been deployed with these migrations, you can instead recreate ${formatMigrationNumber(INITIAL_SCHEMA_NUMBER)} from the local tables with ${initHint}, which deletes every migration of the namespace.`,
      );
    }
    throw CLIError({
      code: "MIGRATION_FILES_INVALID",
      message: `Migration file validation failed for namespace "${namespace}":\n${errorMessages}`,
      suggestion: [...suggestions].join("\n"),
    });
  }
}
