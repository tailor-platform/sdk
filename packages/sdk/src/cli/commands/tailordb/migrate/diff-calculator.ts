/**
 * Diff calculator and formatter for TailorDB schema migrations
 *
 * This module provides utilities for formatting and displaying migration diffs.
 * The actual diff calculation is performed by snapshot.ts.
 */

import { collectNestedMemberChanges, type NestedMemberChange } from "./nested-members";
import type {
  SnapshotFieldConfig,
  SnapshotGqlPermission,
  SnapshotIndexConfig,
  SnapshotRecordPermission,
  SnapshotRelationship,
  TailorDBSnapshotType,
} from "./snapshot-types";

// ============================================================================
// Diff Types
// ============================================================================

/**
 * Current schema snapshot format version
 */
export const SCHEMA_SNAPSHOT_VERSION = 6 as const;

/** Oldest migration file format this SDK can replay. */
export const MIN_SUPPORTED_MIGRATION_FILE_VERSION = 1 as const;

/**
 * Change kind in migration diff
 */
export type DiffChangeKind = DiffChange["kind"];

/**
 * Properties shared by all diff change variants
 */
interface DiffChangeBase {
  tableName: string;
  reason?: string;
}

/**
 * Table-level settings patch carried by legacy `type_modified` changes.
 * Current SDK versions no longer produce this kind, but persisted
 * diff.json files written by older versions may still contain it.
 */
export interface TypeSettingsPatch {
  indexes?: Record<string, SnapshotIndexConfig>;
  files?: Record<string, string>;
}

/** Table-level settings and metadata state used by current diffs. */
export interface SnapshotTypeSettingsState {
  description?: string;
  pluralForm: string;
  settings?: TailorDBSnapshotType["settings"];
}

/**
 * Permission state carried by `permission_modified` changes.
 */
export interface SnapshotPermissionState {
  recordPermission?: SnapshotRecordPermission;
  gqlPermission?: SnapshotGqlPermission;
}

/** A new table was added to the schema. */
export interface TableAddedChange extends DiffChangeBase {
  kind: "table_added";
  after: TailorDBSnapshotType;
}

/** An existing table was removed from the schema. */
export interface TableRemovedChange extends DiffChangeBase {
  kind: "table_removed";
  before: TailorDBSnapshotType;
}

/**
 * A table was renamed. Recorded when the user confirms that a removed + added
 * table pair is a rename (interactively or via `--rename`).
 * `tableName` is the new name; `previousTableName` is the old name.
 */
export interface TableRenamedChange extends DiffChangeBase {
  kind: "table_renamed";
  previousTableName: string;
  before: TailorDBSnapshotType;
  after: TailorDBSnapshotType;
}

/**
 * Legacy table-level settings change. Kept for backward compatibility with
 * diff.json files written by older SDK versions; `before`/`after` may be
 * absent in those files, hence optional.
 */
export interface TableModifiedChange extends DiffChangeBase {
  kind: "table_modified";
  before?: TypeSettingsPatch;
  after?: TypeSettingsPatch;
}

/** Table-level settings or metadata changed. */
export interface TableSettingsModifiedChange extends DiffChangeBase {
  kind: "table_settings_modified";
  before: SnapshotTypeSettingsState;
  after: SnapshotTypeSettingsState;
}

/** A field was added to a table. */
export interface FieldAddedChange extends DiffChangeBase {
  kind: "field_added";
  fieldName: string;
  after: SnapshotFieldConfig;
}

/** A field was removed from a table. */
export interface FieldRemovedChange extends DiffChangeBase {
  kind: "field_removed";
  fieldName: string;
  before: SnapshotFieldConfig;
}

/**
 * A member inside a nested field was renamed. Paths are relative to the
 * top-level field and share the same parent; `path` is the new name.
 */
export interface NestedMemberRename {
  previousPath: string[];
  path: string[];
}

/**
 * A field configuration was modified. `memberRenames` records members inside a
 * nested field that the user confirmed as renames (interactively or via
 * `--rename Table.field.old:new`); their values must be copied by the
 * migration script.
 */
export interface FieldModifiedChange extends DiffChangeBase {
  kind: "field_modified";
  fieldName: string;
  before: SnapshotFieldConfig;
  after: SnapshotFieldConfig;
  memberRenames?: NestedMemberRename[];
}

/**
 * A field was renamed within a table. Recorded when the user confirms that a
 * removed + added field pair is a rename (interactively or via `--rename`).
 * `fieldName` is the new name; `previousFieldName` is the old name.
 */
export interface FieldRenamedChange extends DiffChangeBase {
  kind: "field_renamed";
  fieldName: string;
  previousFieldName: string;
  before: SnapshotFieldConfig;
  after: SnapshotFieldConfig;
}

/** A field type changed and must remain on the previous type until Post-phase. */
export interface FieldTypeModifiedChange extends DiffChangeBase {
  kind: "field_type_modified";
  fieldName: string;
  before: SnapshotFieldConfig;
  after: SnapshotFieldConfig;
}

/** An index was added to a table. */
export interface IndexAddedChange extends DiffChangeBase {
  kind: "index_added";
  indexName: string;
  after: SnapshotIndexConfig;
}

/** An index was removed from a table. */
export interface IndexRemovedChange extends DiffChangeBase {
  kind: "index_removed";
  indexName: string;
  before: SnapshotIndexConfig;
}

/** An index configuration was modified. */
export interface IndexModifiedChange extends DiffChangeBase {
  kind: "index_modified";
  indexName: string;
  before: SnapshotIndexConfig;
  after: SnapshotIndexConfig;
}

/** A file field was added to a table. `before`/`after` hold the description. */
export interface FileAddedChange extends DiffChangeBase {
  kind: "file_added";
  fieldName: string;
  after: string;
}

/** A file field was removed from a table. */
export interface FileRemovedChange extends DiffChangeBase {
  kind: "file_removed";
  fieldName: string;
  before: string;
}

/** A file field description was modified. */
export interface FileModifiedChange extends DiffChangeBase {
  kind: "file_modified";
  fieldName: string;
  before: string;
  after: string;
}

/**
 * A relationship was added to a table. `relationshipType` is optional for
 * backward compatibility: diff.json files written by older SDK versions
 * predate the field.
 */
export interface RelationshipAddedChange extends DiffChangeBase {
  kind: "relationship_added";
  relationshipName: string;
  relationshipType?: "forward" | "backward";
  after: SnapshotRelationship;
}

/** A relationship was removed from a table. */
export interface RelationshipRemovedChange extends DiffChangeBase {
  kind: "relationship_removed";
  relationshipName: string;
  relationshipType?: "forward" | "backward";
  before: SnapshotRelationship;
}

/** A relationship configuration was modified. */
export interface RelationshipModifiedChange extends DiffChangeBase {
  kind: "relationship_modified";
  relationshipName: string;
  relationshipType?: "forward" | "backward";
  before: SnapshotRelationship;
  after: SnapshotRelationship;
}

/**
 * Table-level permissions were modified. `before`/`after` are optional for
 * robustness against hand-edited or legacy diff.json files; consumers guard
 * on their presence.
 */
export interface PermissionModifiedChange extends DiffChangeBase {
  kind: "permission_modified";
  before?: SnapshotPermissionState;
  after?: SnapshotPermissionState;
}

/** Table-level hook/validate script state for diff tracking. */
export interface TypeScriptsState {
  typeHookExpr?: { create?: string; update?: string };
  typeValidateExpr?: string;
}

/** Table-level hook/validate scripts changed. */
export interface TableScriptsModifiedChange extends DiffChangeBase {
  kind: "table_scripts_modified";
  before: TypeScriptsState;
  after: TypeScriptsState;
}

/**
 * Single change in migration diff, discriminated by `kind` so that
 * `before`/`after` are typed per change kind.
 */
export type DiffChange =
  | TableAddedChange
  | TableRemovedChange
  | TableRenamedChange
  | TableModifiedChange
  | TableSettingsModifiedChange
  | FieldAddedChange
  | FieldRemovedChange
  | FieldModifiedChange
  | FieldRenamedChange
  | FieldTypeModifiedChange
  | IndexAddedChange
  | IndexRemovedChange
  | IndexModifiedChange
  | FileAddedChange
  | FileRemovedChange
  | FileModifiedChange
  | RelationshipAddedChange
  | RelationshipRemovedChange
  | RelationshipModifiedChange
  | PermissionModifiedChange
  | TableScriptsModifiedChange;

/**
 * Field-level diff change (added / removed / modified / renamed).
 */
export type FieldDiffChange =
  | FieldAddedChange
  | FieldRemovedChange
  | FieldModifiedChange
  | FieldRenamedChange
  | FieldTypeModifiedChange;

/**
 * Index-level diff change (added / removed / modified).
 */
export type IndexDiffChange = IndexAddedChange | IndexRemovedChange | IndexModifiedChange;

/**
 * Migration diff - changes between two schema versions
 * Stored as XXXX/diff.json (e.g., 0001/diff.json)
 */
export interface MigrationDiff {
  /** Format version for future compatibility */
  version: number;
  namespace: string;
  createdAt: string;
  description?: string;
  changes: DiffChange[];
  /** Whether there are breaking changes (data loss or constraint violations possible) */
  hasBreakingChanges: boolean;
  /** List of breaking changes */
  breakingChanges: BreakingChangeInfo[];
  /** Whether there are non-breaking changes that may cause data loss (e.g. field/table removal) */
  hasWarnings: boolean;
  /** List of non-breaking warnings */
  warnings: WarningChangeInfo[];
  /** Whether a migration script is required to handle data migration */
  requiresMigrationScript: boolean;
  /** Explicit acknowledgment that this migration needs no script despite breaking changes or data-loss warnings */
  scriptSkipped?: ScriptSkippedInfo;
}

/**
 * Acknowledgment that a migration requiring or recommending a script intentionally has none.
 * Recorded by `tailordb migration script <n> --no-script --reason "..."`.
 */
export interface ScriptSkippedInfo {
  reason: string;
  acknowledgedAt: string;
}

/**
 * Breaking change information in migration diff
 */
export interface BreakingChangeInfo {
  tableName: string;
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
 * (e.g. removing a field or table). Unlike breaking changes, a migration
 * script is not required, but writing one is recommended if you need to
 * preserve or transform data before the change applies.
 */
export interface WarningChangeInfo {
  tableName: string;
  /** Field name, or the dotted path of a member inside a nested field (e.g. `address.zip`). */
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

  // Group changes by table name
  const changesByType = new Map<string, DiffChange[]>();
  for (const change of diff.changes) {
    const existing = changesByType.get(change.tableName) ?? [];
    existing.push(change);
    changesByType.set(change.tableName, existing);
  }

  for (const [tableName, changes] of changesByType) {
    lines.push(`${diff.namespace}.${tableName}:`);

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
    case "table_added":
      return `  + [Table] ${change.tableName} (new table)`;
    case "table_removed":
      return `  - [Table] ${change.tableName} (removed)`;
    case "table_renamed":
      return `  ~ [Table] ${change.previousTableName} → ${change.tableName} (renamed)`;
    case "table_modified":
      return `  ~ [Table] ${change.tableName}: ${change.reason}`;
    case "table_settings_modified":
      return `  ~ [Table Settings] ${change.tableName}: ${change.reason ?? "settings changed"}`;
    case "field_added": {
      const typeStr = formatFieldType(change.after);
      return `  + ${change.fieldName}: ${typeStr}`;
    }
    case "field_removed":
      return `  - ${change.fieldName}: ${change.before.type}`;
    case "field_modified":
      return `  ~ ${change.fieldName}: ${formatFieldModification(change.before, change.after, change.memberRenames)}`;
    case "field_type_modified":
      return `  ~ ${change.fieldName}: ${formatFieldModification(change.before, change.after)}`;
    case "field_renamed":
      return `  ~ ${change.previousFieldName} → ${change.fieldName}: ${formatFieldType(change.after)} (renamed)`;
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
    case "table_scripts_modified":
      return `  ~ [Table Scripts] ${change.tableName}: ${change.reason ?? "table-level hooks/validate changed"}`;
    default: {
      // Runtime fallback: diff.json is parsed without validation, so
      // hand-edited or future-version files may carry unknown kinds.
      const unknown = change as { tableName: string; fieldName?: string };
      return `  ? ${unknown.tableName}.${unknown.fieldName ?? ""}`;
    }
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
 * @param {readonly NestedMemberRename[]} [memberRenames] - Confirmed renames of members inside the nested field
 * @returns {string} Formatted modification details
 */
function formatFieldModification(
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
  memberRenames: readonly NestedMemberRename[] = [],
): string {
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

  const renamedPaths = new Set(
    memberRenames.flatMap((rename) => [rename.previousPath.join("."), rename.path.join(".")]),
  );
  const members = collectNestedMemberChanges(before, after)
    .filter((m) => !renamedPaths.has(m.path.join(".")))
    .map((m) => `${NESTED_MEMBER_CHANGE_MARKERS[m.kind]}${m.path.join(".")}`);
  members.push(
    ...memberRenames.map(
      (rename) => `${rename.previousPath.join(".")} → ${rename.path.join(".")} (renamed)`,
    ),
  );
  if (members.length > 0) {
    changes.push(`members: ${members.join(", ")}`);
  }

  return changes.length > 0 ? changes.join(", ") : "configuration changed";
}

const NESTED_MEMBER_CHANGE_MARKERS: Record<NestedMemberChange["kind"], string> = {
  removed: "-",
  added: "+",
  modified: "~",
};

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
    const location = bc.fieldName ? `${bc.tableName}.${bc.fieldName}` : bc.tableName;
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
    const location = w.fieldName ? `${w.tableName}.${w.fieldName}` : w.tableName;
    lines.push(`  - ${location}: ${w.reason}`);
  }

  return lines.join("\n");
}

const DIFF_CHANGE_LABELS: Record<DiffChangeKind, string> = {
  table_added: "table(s) added",
  table_removed: "table(s) removed",
  table_renamed: "table(s) renamed",
  table_modified: "table(s) modified",
  table_settings_modified: "table setting(s) modified",
  field_added: "field(s) added",
  field_removed: "field(s) removed",
  field_modified: "field(s) modified",
  field_renamed: "field(s) renamed",
  field_type_modified: "field type(s) modified",
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
  table_scripts_modified: "table script(s) modified",
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
