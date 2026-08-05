/**
 * Field rename detection for TailorDB migrations
 *
 * A rename has no dedicated platform API, so the diff decomposes it into
 * `field_removed` + `field_added`. This module detects removed/added pairs
 * that are compatible enough to be a rename so that `migration generate`
 * can ask the user (or accept `--rename Type.old:new`) and record a single
 * `field_renamed` change instead.
 */

import type { FieldAddedChange, FieldRemovedChange, MigrationDiff } from "./diff-calculator";
import type { SnapshotFieldConfig } from "./snapshot-types";

/**
 * A confirmed field rename to record in the migration diff.
 */
export interface FieldRenameSpec {
  typeName: string;
  /** Field name before the rename. */
  fromFieldName: string;
  /** Field name after the rename. */
  toFieldName: string;
}

/**
 * A removed field together with the added fields it could have been renamed to.
 */
export interface FieldRenameCandidate {
  typeName: string;
  removed: FieldRemovedChange;
  /** Compatible added fields in the same type, in diff order. */
  added: FieldAddedChange[];
}

/**
 * Whether copying values from `before` into `after` preserves their meaning,
 * i.e. the removed + added pair can be treated as a rename.
 *
 * Serial fields are excluded because their values are platform-generated and
 * cannot be written by a migration script.
 * @param {SnapshotFieldConfig} before - Removed field's configuration
 * @param {SnapshotFieldConfig} after - Added field's configuration
 * @returns {boolean} True if the pair is rename-compatible
 */
export function isRenameCompatible(
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
): boolean {
  if (before.type !== after.type) return false;
  if ((before.array ?? false) !== (after.array ?? false)) return false;
  if ((before.foreignKeyType ?? "") !== (after.foreignKeyType ?? "")) return false;
  if ((before.foreignKeyField ?? "") !== (after.foreignKeyField ?? "")) return false;
  if (before.serial || after.serial) return false;
  if (before.type === "enum") {
    const afterValues = new Set((after.allowedValues ?? []).map((v) => v.value));
    if ((before.allowedValues ?? []).some((v) => !afterValues.has(v.value))) return false;
  }
  return true;
}

/**
 * Find removed + added field pairs in a diff that could be renames.
 * @param {MigrationDiff} diff - Migration diff to scan
 * @returns {FieldRenameCandidate[]} Candidates in diff order (may be empty)
 */
export function findRenameCandidates(diff: MigrationDiff): FieldRenameCandidate[] {
  const removedByType = new Map<string, FieldRemovedChange[]>();
  const addedByType = new Map<string, FieldAddedChange[]>();
  for (const change of diff.changes) {
    if (change.kind === "field_removed") {
      const list = removedByType.get(change.typeName) ?? [];
      list.push(change);
      removedByType.set(change.typeName, list);
    } else if (change.kind === "field_added") {
      const list = addedByType.get(change.typeName) ?? [];
      list.push(change);
      addedByType.set(change.typeName, list);
    }
  }

  const candidates: FieldRenameCandidate[] = [];
  for (const [typeName, removedChanges] of removedByType) {
    const addedChanges = addedByType.get(typeName);
    if (!addedChanges) continue;
    for (const removed of removedChanges) {
      const added = addedChanges.filter((a) => isRenameCompatible(removed.before, a.after));
      if (added.length > 0) {
        candidates.push({ typeName, removed, added });
      }
    }
  }
  return candidates;
}

const RENAME_OPTION_PATTERN = /^([^.:\s]+)\.([^.:\s]+):([^.:\s]+)$/;

/**
 * Parse a `--rename` option value of the form `Type.old:new`.
 * @param {string} value - Raw option value
 * @returns {FieldRenameSpec} Parsed rename spec
 */
export function parseRenameOption(value: string): FieldRenameSpec {
  const match = value.match(RENAME_OPTION_PATTERN);
  if (!match) {
    throw new Error(
      `Invalid --rename value "${value}". Expected format: "Type.oldField:newField".`,
    );
  }
  const [, typeName, fromFieldName, toFieldName] = match;
  if (!typeName || !fromFieldName || !toFieldName) {
    throw new Error(
      `Invalid --rename value "${value}". Expected format: "Type.oldField:newField".`,
    );
  }
  if (fromFieldName === toFieldName) {
    throw new Error(`Invalid --rename value "${value}": old and new field names are identical.`);
  }
  return { typeName, fromFieldName, toFieldName };
}
