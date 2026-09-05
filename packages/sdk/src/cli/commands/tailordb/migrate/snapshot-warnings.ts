import { collectNestedMemberChanges, type NestedMemberChange } from "./nested-members";
import { isNestedMemberRenameCompatible } from "./rename-detection";
import type { FieldModifiedChange, MigrationDiff, WarningChangeInfo } from "./diff-calculator";

export const FIELD_REMOVED_WARNING_REASON =
  "Field removed (existing data will no longer be accessible through the schema)";
export const TABLE_REMOVED_WARNING_REASON =
  "Table removed (all records in this table will be deleted during post-migration cleanup)";
const NESTED_MEMBER_REMOVED_WARNING_REASON =
  "Nested member removed (existing values will no longer be accessible through the schema)";

function isSibling(a: NestedMemberChange, b: NestedMemberChange): boolean {
  return (
    a.path.length === b.path.length &&
    a.path.slice(0, -1).every((segment, index) => segment === b.path[index])
  );
}

/**
 * Data-loss warnings for members removed inside a nested field.
 *
 * Members confirmed as renamed (`change.memberRenames`) are not data loss and
 * are skipped, and their new names are not offered as rename hints. The
 * Pre-phase keeps every removed member readable, and a compatible member added
 * at the same level is named in the warning as a hint.
 * @param {FieldModifiedChange} change - Modification of the top-level nested field
 * @returns {WarningChangeInfo[]} One warning per removed member, keyed by dotted member path
 */
export function collectNestedMemberRemovalWarnings(
  change: FieldModifiedChange,
): WarningChangeInfo[] {
  const changes = collectNestedMemberChanges(change.before, change.after);
  const renamedPaths = new Set(
    (change.memberRenames ?? []).flatMap((rename) => [
      rename.previousPath.join("."),
      rename.path.join("."),
    ]),
  );
  const warnings: WarningChangeInfo[] = [];
  for (const removed of changes) {
    if (removed.kind !== "removed" || renamedPaths.has(removed.path.join("."))) continue;
    const renameTargets = changes
      .filter(
        (added) =>
          added.kind === "added" &&
          !renamedPaths.has(added.path.join(".")) &&
          isSibling(added, removed) &&
          isNestedMemberRenameCompatible(removed.before, added.after),
      )
      .map((added) => added.path.at(-1));
    const hint =
      renameTargets.length > 0
        ? `. Possibly renamed to ${renameTargets.join(", ")}: confirm it with ` +
          `--rename "${change.tableName}.${change.fieldName}.${removed.path.join(".")}:<newName>" ` +
          "to scaffold a copy script, or keep the removal and copy the values yourself"
        : "";
    warnings.push({
      tableName: change.tableName,
      fieldName: [change.fieldName, ...removed.path].join("."),
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
      warnings.push(...collectNestedMemberRemovalWarnings(change));
    }
  }
  return warnings;
}
