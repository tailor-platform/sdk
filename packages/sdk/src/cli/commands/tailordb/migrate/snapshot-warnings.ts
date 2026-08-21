import { type MigrationDiff, type WarningChangeInfo } from "./diff-calculator";

export const FIELD_REMOVED_WARNING_REASON =
  "Field removed (existing data will no longer be accessible through the schema)";
export const TABLE_REMOVED_WARNING_REASON =
  "Table removed (all records in this table will be deleted during post-migration cleanup)";

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
    }
  }
  return warnings;
}
