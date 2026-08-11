/**
 * Field rename detection for TailorDB migrations
 *
 * A rename has no dedicated platform API, so the diff decomposes it into
 * `field_removed` + `field_added`. This module detects removed/added pairs
 * that are compatible enough to be a rename so that `migration generate`
 * can ask the user (or accept `--rename Type.old:new`) and record a single
 * `field_renamed` change instead.
 */

import {
  SNAPSHOT_FIELD_BOOLEAN_PROPS,
  type NormalizedSchemaSnapshot,
  type SchemaSnapshot,
  type SnapshotFieldBooleanProp,
  type SnapshotFieldConfig,
} from "./snapshot-types";
import type { FieldAddedChange, FieldRemovedChange, MigrationDiff } from "./diff-calculator";

/**
 * A confirmed field rename to record in the migration diff.
 */
export interface FieldRenameSpec {
  typeName: string;
  /** Field name before the rename. */
  previousFieldName: string;
  /** Field name after the rename. */
  fieldName: string;
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

/** Modifiers a rename may change, since the Pre-phase relaxes them. */
const RENAME_TOLERATED_BOOLEAN_PROPS = new Set<SnapshotFieldBooleanProp>([
  "index",
  "unique",
  "vector",
]);

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
  for (const prop of SNAPSHOT_FIELD_BOOLEAN_PROPS) {
    if (RENAME_TOLERATED_BOOLEAN_PROPS.has(prop)) continue;
    if ((before[prop] ?? false) !== (after[prop] ?? false)) return false;
  }
  if ((before.foreignKeyType ?? "") !== (after.foreignKeyType ?? "")) return false;
  if ((before.foreignKeyField ?? "") !== (after.foreignKeyField ?? "")) return false;
  if (before.serial || after.serial) return false;
  if (before.type === "enum") {
    const afterValues = new Set((after.allowedValues ?? []).map((v) => v.value));
    if ((before.allowedValues ?? []).some((v) => !afterValues.has(v.value))) return false;
  }
  // Top-level `required` may differ: the Pre-phase relaxes it and the
  // scaffolded copy script carries a TODO to resolve nulls before the
  // Post-phase enforces it. Nested member constraints are never relaxed, so
  // the wholesale-copied nested structures must match exactly: same member
  // names, same requiredness, recursively compatible members.
  const beforeNested = before.fields ?? {};
  const afterNested = after.fields ?? {};
  const beforeNames = Object.keys(beforeNested);
  const afterNames = Object.keys(afterNested);
  if (beforeNames.length !== afterNames.length) return false;
  for (const name of beforeNames) {
    const beforeMember = beforeNested[name];
    const afterMember = afterNested[name];
    if (!beforeMember || !afterMember) return false;
    if (beforeMember.required !== afterMember.required) return false;
    if (!isRenameCompatible(beforeMember, afterMember)) return false;
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

/**
 * Whether a rename spec matches a removed + added field pair between two
 * snapshots: the old field existed before and is gone now, and the new field
 * exists now but did not before. Field compatibility is checked separately
 * when the diff is recomputed with the spec.
 * @param {FieldRenameSpec} spec - Rename spec to test
 * @param {SchemaSnapshot} previousSnapshot - Previous schema snapshot
 * @param {SchemaSnapshot} currentSnapshot - Current schema snapshot
 * @returns {boolean} True if the spec matches a removed + added pair
 */
export function renameSpecApplies(
  spec: FieldRenameSpec,
  previousSnapshot: SchemaSnapshot,
  currentSnapshot: SchemaSnapshot,
): boolean {
  const prevFields = previousSnapshot.types[spec.typeName]?.fields;
  const currFields = currentSnapshot.types[spec.typeName]?.fields;
  return Boolean(
    prevFields?.[spec.previousFieldName] &&
    !currFields?.[spec.previousFieldName] &&
    currFields?.[spec.fieldName] &&
    !prevFields[spec.fieldName],
  );
}

/**
 * Assert that every rename spec matches a compatible removed + added field
 * pair between the two normalized snapshots.
 * @param {NormalizedSchemaSnapshot} previous - Previous normalized snapshot
 * @param {NormalizedSchemaSnapshot} current - Current normalized snapshot
 * @param {readonly FieldRenameSpec[]} fieldRenames - Rename specs to validate
 */
export function assertValidFieldRenames(
  previous: NormalizedSchemaSnapshot,
  current: NormalizedSchemaSnapshot,
  fieldRenames: readonly FieldRenameSpec[],
): void {
  const seen = new Set<string>();
  for (const rename of fieldRenames) {
    const { typeName, previousFieldName, fieldName } = rename;
    const label = `${typeName}.${previousFieldName}:${fieldName}`;
    for (const key of [`${typeName}.${previousFieldName}`, `${typeName}.${fieldName}`]) {
      if (seen.has(key)) {
        throw new Error(`Field "${key}" appears in more than one rename.`);
      }
      seen.add(key);
    }

    const prevType = previous.types[typeName];
    const currType = current.types[typeName];
    if (!prevType || !currType) {
      throw new Error(
        `Cannot rename ${label}: type "${typeName}" must exist in both the previous and the current schema.`,
      );
    }
    const prevField = prevType.fields[previousFieldName];
    if (!prevField) {
      throw new Error(
        `Cannot rename ${label}: field "${previousFieldName}" does not exist in the previous schema.`,
      );
    }
    if (currType.fields[previousFieldName]) {
      throw new Error(
        `Cannot rename ${label}: field "${previousFieldName}" still exists in the current schema.`,
      );
    }
    const currField = currType.fields[fieldName];
    if (!currField) {
      throw new Error(
        `Cannot rename ${label}: field "${fieldName}" does not exist in the current schema.`,
      );
    }
    if (prevType.fields[fieldName]) {
      throw new Error(
        `Cannot rename ${label}: field "${fieldName}" already exists in the previous schema.`,
      );
    }
    if (!isRenameCompatible(prevField, currField)) {
      throw new Error(
        `Cannot rename ${label}: the fields are not rename-compatible ` +
          `(the field type, array-ness, and foreign key target must match, ` +
          `enum values must not be removed, nested member names, requiredness, and types must ` +
          `match recursively, and serial fields cannot be renamed).`,
      );
    }
  }
}

const RENAME_OPTION_PATTERN = /^([^.:\s]+)\.([^.:\s]+):([^.:\s]+)$/;

/**
 * Parse a `--rename` option value of the form `Type.old:new`.
 * @param {string} value - Raw option value
 * @returns {FieldRenameSpec} Parsed rename spec
 */
export function parseRenameOption(value: string): FieldRenameSpec {
  const match = value.match(RENAME_OPTION_PATTERN);
  const [, typeName, previousFieldName, fieldName] = match ?? [];
  if (!typeName || !previousFieldName || !fieldName) {
    throw new Error(
      `Invalid --rename value "${value}". Expected format: "Type.oldField:newField".`,
    );
  }
  if (previousFieldName === fieldName) {
    throw new Error(`Invalid --rename value "${value}": old and new field names are identical.`);
  }
  return { typeName, previousFieldName, fieldName };
}

/**
 * A field removal confirmed as intentional (`--drop Type.field`), so its
 * rename candidates need no interactive confirmation.
 */
export interface FieldDropSpec {
  typeName: string;
  fieldName: string;
}

const DROP_OPTION_PATTERN = /^([^.:\s]+)\.([^.:\s]+)$/;

/**
 * Parse a `--drop` option value of the form `Type.field`.
 * @param {string} value - Raw option value
 * @returns {FieldDropSpec} Parsed drop spec
 */
export function parseDropOption(value: string): FieldDropSpec {
  const match = value.match(DROP_OPTION_PATTERN);
  const [, typeName, fieldName] = match ?? [];
  if (!typeName || !fieldName) {
    throw new Error(`Invalid --drop value "${value}". Expected format: "Type.field".`);
  }
  return { typeName, fieldName };
}

/**
 * Whether a drop spec matches a field that was removed between two snapshots:
 * the field existed before and is gone now.
 * @param {FieldDropSpec} spec - Drop spec to test
 * @param {SchemaSnapshot} previousSnapshot - Previous schema snapshot
 * @param {SchemaSnapshot} currentSnapshot - Current schema snapshot
 * @returns {boolean} True if the spec matches a removed field
 */
export function dropSpecApplies(
  spec: FieldDropSpec,
  previousSnapshot: SchemaSnapshot,
  currentSnapshot: SchemaSnapshot,
): boolean {
  const prevFields = previousSnapshot.types[spec.typeName]?.fields;
  const currFields = currentSnapshot.types[spec.typeName]?.fields;
  return Boolean(prevFields?.[spec.fieldName] && !currFields?.[spec.fieldName]);
}

/** A field the user approved for conversion through a temporary field. */
export interface FieldExpandContractSpec {
  typeName: string;
  fieldName: string;
}

/**
 * Parse an `--expand-contract` option value of the form `Type.field`.
 * @param {string} value - Raw option value
 * @returns {FieldExpandContractSpec} Parsed spec
 */
export function parseExpandContractOption(value: string): FieldExpandContractSpec {
  const match = value.match(DROP_OPTION_PATTERN);
  const [, typeName, fieldName] = match ?? [];
  if (!typeName || !fieldName) {
    throw new Error(`Invalid --expand-contract value "${value}". Expected format: "Type.field".`);
  }
  return { typeName, fieldName };
}

/**
 * Whether a spec matches a field whose type changed between two snapshots.
 * @param {FieldExpandContractSpec} spec - Spec to test
 * @param {SchemaSnapshot} previousSnapshot - Previous schema snapshot
 * @param {SchemaSnapshot} currentSnapshot - Current schema snapshot
 * @returns {boolean} True if the spec matches a field whose type changed
 */
export function expandContractSpecApplies(
  spec: FieldExpandContractSpec,
  previousSnapshot: SchemaSnapshot,
  currentSnapshot: SchemaSnapshot,
): boolean {
  const before = previousSnapshot.types[spec.typeName]?.fields[spec.fieldName];
  const after = currentSnapshot.types[spec.typeName]?.fields[spec.fieldName];
  return Boolean(before && after && before.type !== after.type);
}
