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
  | "field_modified";

/**
 * Single change in migration diff
 */
export interface DiffChange {
  kind: DiffChangeKind;
  typeName: string;
  fieldName?: string;
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

  // Check allowedValues changes (set-based comparison - order doesn't matter)
  const beforeAllowed = before.allowedValues ?? [];
  const afterAllowed = after.allowedValues ?? [];
  const afterSet = new Set(afterAllowed);
  const hasAllowedValuesChange =
    beforeAllowed.length !== afterAllowed.length || beforeAllowed.some((v) => !afterSet.has(v));
  if (hasAllowedValuesChange) {
    changes.push(`allowedValues: [${beforeAllowed.join(", ")}] → [${afterAllowed.join(", ")}]`);
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
 * Format a summary of the migration diff
 * @param {MigrationDiff} diff - Migration diff to summarize
 * @returns {string} Formatted summary string
 */
export function formatDiffSummary(diff: MigrationDiff): string {
  const stats = {
    typesAdded: 0,
    typesRemoved: 0,
    fieldsAdded: 0,
    fieldsRemoved: 0,
    fieldsModified: 0,
  };

  for (const change of diff.changes) {
    switch (change.kind) {
      case "type_added":
        stats.typesAdded++;
        break;
      case "type_removed":
        stats.typesRemoved++;
        break;
      case "field_added":
        stats.fieldsAdded++;
        break;
      case "field_removed":
        stats.fieldsRemoved++;
        break;
      case "field_modified":
        stats.fieldsModified++;
        break;
    }
  }

  const parts: string[] = [];
  if (stats.typesAdded > 0) parts.push(`${stats.typesAdded} type(s) added`);
  if (stats.typesRemoved > 0) parts.push(`${stats.typesRemoved} type(s) removed`);
  if (stats.fieldsAdded > 0) parts.push(`${stats.fieldsAdded} field(s) added`);
  if (stats.fieldsRemoved > 0) parts.push(`${stats.fieldsRemoved} field(s) removed`);
  if (stats.fieldsModified > 0) parts.push(`${stats.fieldsModified} field(s) modified`);

  if (parts.length === 0) {
    return "No changes";
  }

  return parts.join(", ");
}
