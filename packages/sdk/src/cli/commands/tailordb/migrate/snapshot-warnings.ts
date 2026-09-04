import { collectNestedMemberChanges, type NestedMemberChange } from "./nested-members";
import { isRenameCompatible } from "./rename-detection";
import type { MigrationDiff, WarningChangeInfo } from "./diff-calculator";
import type { SnapshotFieldConfig } from "./snapshot-types";

export const FIELD_REMOVED_WARNING_REASON =
  "Field removed (existing data will no longer be accessible through the schema)";
export const TABLE_REMOVED_WARNING_REASON =
  "Table removed (all records in this table will be deleted during post-migration cleanup)";
const NESTED_MEMBER_REMOVED_WARNING_REASON =
  "Nested member removed (existing values will no longer be accessible through the schema)";

/**
 * Whether an added nested member could carry the removed member's values. The
 * Pre-phase never relaxes nested member constraints, so unlike a top-level
 * rename the requiredness must match as well.
 * @param {SnapshotFieldConfig} before - Removed member's configuration
 * @param {SnapshotFieldConfig} after - Added member's configuration
 * @returns {boolean} True if the pair looks like a rename
 */
function isNestedMemberRenameCompatible(
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
): boolean {
  return before.required === after.required && isRenameCompatible(before, after);
}

function isSibling(a: NestedMemberChange, b: NestedMemberChange): boolean {
  return (
    a.path.length === b.path.length &&
    a.path.slice(0, -1).every((segment, index) => segment === b.path[index])
  );
}

/**
 * Data-loss warnings for members removed inside a nested field.
 *
 * Nested renames are not detected: the Pre-phase cannot keep a removed member
 * alongside its replacement, so no copy script can be scaffolded. A compatible
 * member added at the same level is named in the warning as a hint instead.
 * @param {string} tableName - Table containing the nested field
 * @param {string} fieldName - Top-level nested field name
 * @param {SnapshotFieldConfig} before - Field configuration before the change
 * @param {SnapshotFieldConfig} after - Field configuration after the change
 * @returns {WarningChangeInfo[]} One warning per removed member, keyed by dotted member path
 */
export function collectNestedMemberRemovalWarnings(
  tableName: string,
  fieldName: string,
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
): WarningChangeInfo[] {
  const changes = collectNestedMemberChanges(before, after);
  const warnings: WarningChangeInfo[] = [];
  for (const removed of changes) {
    if (removed.kind !== "removed") continue;
    const renameTargets = changes
      .filter(
        (change) =>
          change.kind === "added" &&
          isSibling(change, removed) &&
          isNestedMemberRenameCompatible(removed.before, change.after),
      )
      .map((change) => change.path.at(-1));
    const hint =
      renameTargets.length > 0
        ? `. Possibly renamed to ${renameTargets.join(", ")}: nested renames are not detected, ` +
          "so keep the old member until a migration script has copied its values and remove it in a later migration"
        : "";
    warnings.push({
      tableName,
      fieldName: [fieldName, ...removed.path].join("."),
      reason: `${NESTED_MEMBER_REMOVED_WARNING_REASON}${hint}`,
    });
  }
  return warnings;
}

/**
 * Reconstruct data-loss warnings from removal changes for diff.json files
 * written before the warning tier existed
 * @param {MigrationDiff} diff - Parsed legacy migration diff
 * @returns {WarningChangeInfo[]} Warnings equivalent to what diff generation would have recorded
 */
export function deriveWarningsFromChanges(diff: MigrationDiff): WarningChangeInfo[] {
  const warnings: WarningChangeInfo[] = [];
  for (const change of diff.changes) {
    if (change.kind === "field_removed") {
      warnings.push({
        tableName: change.tableName,
        fieldName: change.fieldName,
        reason: FIELD_REMOVED_WARNING_REASON,
      });
    } else if (change.kind === "table_removed") {
      warnings.push({ tableName: change.tableName, reason: TABLE_REMOVED_WARNING_REASON });
    } else if (change.kind === "field_modified") {
      warnings.push(
        ...collectNestedMemberRemovalWarnings(
          change.tableName,
          change.fieldName,
          change.before,
          change.after,
        ),
      );
    }
  }
  return warnings;
}
