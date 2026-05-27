/**
 * Diff calculator and formatter for TailorDB schema migrations
 *
 * This module provides utilities for formatting and displaying migration diffs.
 * The actual diff calculation is performed by snapshot.ts.
 */

import type { SnapshotFieldConfig } from "./snapshot";

// ============================================================================
// Diff Types
// ============================================================================

/**
 * Current schema snapshot format version
 */
export const SCHEMA_SNAPSHOT_VERSION = 1 as const;

/**
 * Change kind in migration diff
 */
export type DiffChangeKind =
  | "type_added"
  | "type_removed"
  | "type_modified"
  | "field_added"
  | "field_removed"
  | "field_modified"
  | "index_added"
  | "index_removed"
  | "index_modified"
  | "file_added"
  | "file_removed"
  | "file_modified"
  | "relationship_added"
  | "relationship_removed"
  | "relationship_modified"
  | "permission_modified";

/**
 * Single change in migration diff
 */
export interface DiffChange {
  kind: DiffChangeKind;
  typeName: string;
  fieldName?: string;
  /** Index name for index_* changes */
  indexName?: string;
  /** Relationship name for relationship_* changes */
  relationshipName?: string;
  /** Relationship type for relationship_* changes */
  relationshipType?: "forward" | "backward";
  before?: unknown;
  after?: unknown;
  reason?: string;
}

/**
 * Migration diff - changes between two schema versions
 * Stored as XXXX/diff.json (e.g., 0001/diff.json)
 */
export interface MigrationDiff {
  /** Format version for future compatibility */
  version: typeof SCHEMA_SNAPSHOT_VERSION;
  namespace: string;
  createdAt: string;
  description?: string;
  changes: DiffChange[];
  /** Whether there are breaking changes (data loss or constraint violations possible) */
  hasBreakingChanges: boolean;
  /** List of breaking changes */
  breakingChanges: BreakingChangeInfo[];
  /** Whether there are non-breaking changes that may cause data loss (e.g. field/type removal) */
  hasWarnings: boolean;
  /** List of non-breaking warnings */
  warnings: WarningChangeInfo[];
  /** Whether a migration script is required to handle data migration */
  requiresMigrationScript: boolean;
}

/**
 * Breaking change information in migration diff
 */
export interface BreakingChangeInfo {
  typeName: string;
  fieldName?: string;
  reason: string;
  /** If true, this change is not supported and migration generation will fail */
  unsupported?: boolean;
  /** If true, show 3-step migration instructions for this unsupported change */
  showThreeStepHint?: boolean;
}

/**
 * Warning change information in migration diff.
 *
 * Warnings are non-breaking changes that may still cause data loss
 * (e.g. removing a field or type). Unlike breaking changes, a migration
 * script is not required, but writing one is recommended if you need to
 * preserve or transform data before the change applies.
 */
export interface WarningChangeInfo {
  typeName: string;
  fieldName?: string;
  reason: string;
}

/**
 * Check if a migration diff has any changes
 * @param {MigrationDiff} diff - Migration diff to check
 * @returns {boolean} True if diff has changes
 */
export function hasChanges(diff: MigrationDiff): boolean {
  return diff.changes.length > 0;
}

/**
 * Format a migration diff for display
 * @param {MigrationDiff} diff - Migration diff to format
 * @returns {string} Formatted diff string
 */
export function formatMigrationDiff(diff: MigrationDiff): string {
  if (diff.changes.length === 0) {
    return "No schema differences detected.";
  }

  const lines: string[] = [];

  // Group changes by type name
  const changesByType = new Map<string, DiffChange[]>();
  for (const change of diff.changes) {
    const existing = changesByType.get(change.typeName) ?? [];
    existing.push(change);
    changesByType.set(change.typeName, existing);
  }

  for (const [typeName, changes] of changesByType) {
    lines.push(`${diff.namespace}.${typeName}:`);

    for (const change of changes) {
      lines.push(formatDiffChange(change));
    }
  }

  return lines.join("\n");
}

/**
 * Format a single diff change for display
 * @param {DiffChange} change - Diff change to format
 * @returns {string} Formatted change string
 */
function formatDiffChange(change: DiffChange): string {
  switch (change.kind) {
    case "type_added":
      return `  + [Type] ${change.typeName} (new type)`;
    case "type_removed":
      return `  - [Type] ${change.typeName} (removed)`;
    case "type_modified":
      return `  ~ [Type] ${change.typeName}: ${change.reason}`;
    case "field_added": {
      const field = change.after as SnapshotFieldConfig;
      const typeStr = formatFieldType(field);
      return `  + ${change.fieldName}: ${typeStr}`;
    }
    case "field_removed": {
      const field = change.before as SnapshotFieldConfig;
      return `  - ${change.fieldName}: ${field.type}`;
    }
    case "field_modified": {
      const before = change.before as SnapshotFieldConfig;
      const after = change.after as SnapshotFieldConfig;
      return `  ~ ${change.fieldName}: ${formatFieldModification(before, after)}`;
    }
    case "index_added":
      return `  + [Index] ${change.indexName}`;
    case "index_removed":
      return `  - [Index] ${change.indexName}`;
    case "index_modified":
      return `  ~ [Index] ${change.indexName}: ${change.reason ?? "modified"}`;
    case "file_added":
      return `  + [File] ${change.fieldName}`;
    case "file_removed":
      return `  - [File] ${change.fieldName}`;
    case "file_modified":
      return `  ~ [File] ${change.fieldName}: ${change.reason ?? "modified"}`;
    case "relationship_added":
      return `  + [Relationship${change.relationshipType ? ` (${change.relationshipType})` : ""}] ${change.relationshipName}`;
    case "relationship_removed":
      return `  - [Relationship${change.relationshipType ? ` (${change.relationshipType})` : ""}] ${change.relationshipName}`;
    case "relationship_modified":
      return `  ~ [Relationship${change.relationshipType ? ` (${change.relationshipType})` : ""}] ${change.relationshipName}: ${change.reason ?? "modified"}`;
    case "permission_modified":
      return `  ~ [Permission] ${change.reason ?? "modified"}`;
    default:
      return `  ? ${change.typeName}.${change.fieldName ?? ""}`;
  }
}

/**
 * Format field type with attributes
 * @param {SnapshotFieldConfig} field - Field configuration
 * @returns {string} Formatted field type string
 */
function formatFieldType(field: SnapshotFieldConfig): string {
  let type = field.type;
  if (field.array) type += "[]";
  if (field.required) type += " (required)";
  else type += " (optional)";
  return type;
}

/**
 * Format field modification details
 * @param {SnapshotFieldConfig} before - Before field configuration
 * @param {SnapshotFieldConfig} after - After field configuration
 * @returns {string} Formatted modification details
 */
function formatFieldModification(before: SnapshotFieldConfig, after: SnapshotFieldConfig): string {
  const changes: string[] = [];

  if (before.type !== after.type) {
    changes.push(`type: ${before.type} → ${after.type}`);
  }
  if (before.required !== after.required) {
    changes.push(`required: ${before.required} → ${after.required}`);
  }
  if (Boolean(before.array) !== Boolean(after.array)) {
    changes.push(`array: ${before.array ?? false} → ${after.array ?? false}`);
  }
  if (Boolean(before.index) !== Boolean(after.index)) {
    changes.push(`index: ${before.index ?? false} → ${after.index ?? false}`);
  }
  if (Boolean(before.unique) !== Boolean(after.unique)) {
    changes.push(`unique: ${before.unique ?? false} → ${after.unique ?? false}`);
  }
  if (Boolean(before.vector) !== Boolean(after.vector)) {
    changes.push(`vector: ${before.vector ?? false} → ${after.vector ?? false}`);
  }

  const beforeAllowed = before.allowedValues ?? [];
  const afterAllowed = after.allowedValues ?? [];
  const afterSet = new Set(afterAllowed.map((v) => v.value));
  const hasAllowedValuesChange =
    beforeAllowed.length !== afterAllowed.length ||
    beforeAllowed.some((v) => !afterSet.has(v.value));
  if (hasAllowedValuesChange) {
    const beforeValues = beforeAllowed.map((v) => v.value).join(", ");
    const afterValues = afterAllowed.map((v) => v.value).join(", ");
    changes.push(`allowedValues: [${beforeValues}] → [${afterValues}]`);
  }

  const beforeHooks = before.hooks;
  const afterHooks = after.hooks;
  if (
    (beforeHooks?.create?.expr ?? "") !== (afterHooks?.create?.expr ?? "") ||
    (beforeHooks?.update?.expr ?? "") !== (afterHooks?.update?.expr ?? "")
  ) {
    changes.push("hooks modified");
  }

  const beforeValidate = before.validate ?? [];
  const afterValidate = after.validate ?? [];
  if (beforeValidate.length !== afterValidate.length) {
    changes.push(`validations: ${beforeValidate.length} → ${afterValidate.length}`);
  }

  if (Boolean(before.serial) !== Boolean(after.serial)) {
    changes.push(
      `serial: ${before.serial ? "enabled" : "disabled"} → ${after.serial ? "enabled" : "disabled"}`,
    );
  }

  return changes.join(", ");
}

/**
 * Format breaking changes for display
 * @param {BreakingChangeInfo[]} breakingChanges - Breaking changes to format
 * @returns {string} Formatted breaking changes string
 */
export function formatBreakingChanges(breakingChanges: BreakingChangeInfo[]): string {
  if (breakingChanges.length === 0) {
    return "";
  }

  const lines: string[] = ["Breaking changes detected:", ""];

  for (const bc of breakingChanges) {
    const location = bc.fieldName ? `${bc.typeName}.${bc.fieldName}` : bc.typeName;
    lines.push(`  - ${location}: ${bc.reason}`);
  }

  return lines.join("\n");
}

/**
 * Format warning changes for display
 * @param {WarningChangeInfo[]} warnings - Warning changes to format
 * @returns {string} Formatted warning changes string
 */
export function formatWarnings(warnings: WarningChangeInfo[]): string {
  if (warnings.length === 0) {
    return "";
  }

  const lines: string[] = ["Warning: data loss possible:", ""];

  for (const w of warnings) {
    const location = w.fieldName ? `${w.typeName}.${w.fieldName}` : w.typeName;
    lines.push(`  - ${location}: ${w.reason}`);
  }

  return lines.join("\n");
}

const DIFF_CHANGE_LABELS: Record<DiffChangeKind, string> = {
  type_added: "type(s) added",
  type_removed: "type(s) removed",
  type_modified: "type(s) modified",
  field_added: "field(s) added",
  field_removed: "field(s) removed",
  field_modified: "field(s) modified",
  index_added: "index(es) added",
  index_removed: "index(es) removed",
  index_modified: "index(es) modified",
  file_added: "file field(s) added",
  file_removed: "file field(s) removed",
  file_modified: "file field(s) modified",
  relationship_added: "relationship(s) added",
  relationship_removed: "relationship(s) removed",
  relationship_modified: "relationship(s) modified",
  permission_modified: "permission(s) modified",
};

/**
 * Format a summary of the migration diff
 * @param {MigrationDiff} diff - Migration diff to summarize
 * @returns {string} Formatted summary string
 */
export function formatDiffSummary(diff: MigrationDiff): string {
  const stats: Partial<Record<DiffChangeKind, number>> = {};
  for (const change of diff.changes) {
    stats[change.kind] = (stats[change.kind] ?? 0) + 1;
  }

  const parts = Object.keys(stats).map(
    (kind) => `${stats[kind as DiffChangeKind]} ${DIFF_CHANGE_LABELS[kind as DiffChangeKind]}`,
  );

  return parts.length > 0 ? parts.join(", ") : "No changes";
}
