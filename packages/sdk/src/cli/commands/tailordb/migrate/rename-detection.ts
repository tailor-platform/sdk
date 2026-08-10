/**
 * Field and type rename detection for TailorDB migrations
 *
 * A rename has no dedicated platform API, so the diff decomposes it into
 * `field_removed` + `field_added` (`type_removed` + `type_added` for types).
 * This module detects removed/added pairs that are compatible enough to be a
 * rename so that `migration generate` can ask the user (or accept
 * `--rename Type.old:new` / `--rename OldType:NewType`) and record a single
 * `field_renamed` / `type_renamed` change instead.
 */

import {
  SNAPSHOT_FIELD_BOOLEAN_PROPS,
  type NormalizedSchemaSnapshot,
  type SchemaSnapshot,
  type SnapshotFieldBooleanProp,
  type SnapshotFieldConfig,
  type TailorDBSnapshotType,
} from "./snapshot-types";
import type {
  FieldAddedChange,
  FieldRemovedChange,
  MigrationDiff,
  TypeAddedChange,
  TypeRemovedChange,
} from "./diff-calculator";

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

// ============================================================================
// Type Renames
// ============================================================================

/**
 * A confirmed type rename to record in the migration diff.
 */
export interface TypeRenameSpec {
  /** Type name before the rename. */
  previousTypeName: string;
  /** Type name after the rename. */
  typeName: string;
}

/**
 * A removed type together with the added types it could have been renamed to.
 */
export interface TypeRenameCandidate {
  removed: TypeRemovedChange;
  /** Compatible added types, in diff order. */
  added: TypeAddedChange[];
}

/**
 * Return a copy of a field config with foreign key references to the old type
 * name retargeted at the new name, so a self-referential type compares equal
 * to its renamed shape.
 * @param {SnapshotFieldConfig} field - Field configuration to retarget
 * @param {string} previousTypeName - Type name before the rename
 * @param {string} typeName - Type name after the rename
 * @returns {SnapshotFieldConfig} Retargeted copy of the field
 */
function retargetSelfReferences(
  field: SnapshotFieldConfig,
  previousTypeName: string,
  typeName: string,
): SnapshotFieldConfig {
  const nested = field.fields
    ? Object.fromEntries(
        Object.entries(field.fields).map(([name, member]) => [
          name,
          retargetSelfReferences(member, previousTypeName, typeName),
        ]),
      )
    : undefined;
  return {
    ...field,
    ...(field.foreignKeyType === previousTypeName && { foreignKeyType: typeName }),
    ...(nested && { fields: nested }),
  };
}

/**
 * JSON serialization with recursively sorted object keys, for deep equality.
 * @param {unknown} value - Value to serialize
 * @returns {string} Canonical JSON representation
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Whether copying every row of `before` into `after` preserves the data, i.e.
 * the removed + added type pair can be treated as a rename.
 *
 * A renamed type is created with its full constraints in the Pre-phase (there
 * is no relaxation machinery for a fresh type), so the shape must match
 * strictly: same field names with the same type, array-ness, required/unique
 * constraints, foreign key target (self references compare against the new
 * name), and scale; enum values must not be removed; indexes must match.
 * Serial values cannot be written by a script and file contents are not
 * copied by SQL, so types with serial or file fields are never candidates.
 * Name-derived and data-independent surfaces (pluralForm, description,
 * settings, permissions, hooks, validations, relationships) may differ.
 * @param {TailorDBSnapshotType} before - Removed type's snapshot
 * @param {TailorDBSnapshotType} after - Added type's snapshot
 * @returns {boolean} True if the pair is rename-compatible
 */
export function isTypeRenameCompatible(
  before: TailorDBSnapshotType,
  after: TailorDBSnapshotType,
): boolean {
  if (Object.keys(before.files ?? {}).length > 0 || Object.keys(after.files ?? {}).length > 0) {
    return false;
  }

  const beforeFieldNames = Object.keys(before.fields);
  const afterFieldNames = Object.keys(after.fields);
  if (beforeFieldNames.length !== afterFieldNames.length) return false;
  for (const fieldName of beforeFieldNames) {
    const beforeField = before.fields[fieldName];
    const afterField = after.fields[fieldName];
    if (!beforeField || !afterField) return false;
    const retargeted = retargetSelfReferences(beforeField, before.name, after.name);
    if (!isRenameCompatible(retargeted, afterField)) return false;
    if (retargeted.required !== afterField.required) return false;
    if ((retargeted.unique ?? false) !== (afterField.unique ?? false)) return false;
    if ((retargeted.scale ?? null) !== (afterField.scale ?? null)) return false;
  }

  return stableStringify(before.indexes ?? {}) === stableStringify(after.indexes ?? {});
}

/**
 * Find removed + added type pairs in a diff that could be renames.
 * @param {MigrationDiff} diff - Migration diff to scan
 * @returns {TypeRenameCandidate[]} Candidates in diff order (may be empty)
 */
export function findTypeRenameCandidates(diff: MigrationDiff): TypeRenameCandidate[] {
  const removedChanges = diff.changes.filter(
    (change): change is TypeRemovedChange => change.kind === "type_removed",
  );
  const addedChanges = diff.changes.filter(
    (change): change is TypeAddedChange => change.kind === "type_added",
  );

  const candidates: TypeRenameCandidate[] = [];
  for (const removed of removedChanges) {
    const added = addedChanges.filter((a) => isTypeRenameCompatible(removed.before, a.after));
    if (added.length > 0) {
      candidates.push({ removed, added });
    }
  }
  return candidates;
}

/**
 * Whether a type rename spec matches a removed + added type pair between two
 * snapshots: the old type existed before and is gone now, and the new type
 * exists now but did not before. Type compatibility is checked separately
 * when the diff is recomputed with the spec.
 * @param {TypeRenameSpec} spec - Rename spec to test
 * @param {SchemaSnapshot} previousSnapshot - Previous schema snapshot
 * @param {SchemaSnapshot} currentSnapshot - Current schema snapshot
 * @returns {boolean} True if the spec matches a removed + added pair
 */
export function typeRenameSpecApplies(
  spec: TypeRenameSpec,
  previousSnapshot: SchemaSnapshot,
  currentSnapshot: SchemaSnapshot,
): boolean {
  return Boolean(
    previousSnapshot.types[spec.previousTypeName] &&
    !currentSnapshot.types[spec.previousTypeName] &&
    currentSnapshot.types[spec.typeName] &&
    !previousSnapshot.types[spec.typeName],
  );
}

/**
 * Assert that every type rename spec matches a compatible removed + added
 * type pair between the two normalized snapshots.
 * @param {NormalizedSchemaSnapshot} previous - Previous normalized snapshot
 * @param {NormalizedSchemaSnapshot} current - Current normalized snapshot
 * @param {readonly TypeRenameSpec[]} typeRenames - Rename specs to validate
 */
export function assertValidTypeRenames(
  previous: NormalizedSchemaSnapshot,
  current: NormalizedSchemaSnapshot,
  typeRenames: readonly TypeRenameSpec[],
): void {
  const seen = new Set<string>();
  for (const rename of typeRenames) {
    const { previousTypeName, typeName } = rename;
    const label = `${previousTypeName}:${typeName}`;
    for (const key of [previousTypeName, typeName]) {
      if (seen.has(key)) {
        throw new Error(`Type "${key}" appears in more than one rename.`);
      }
      seen.add(key);
    }

    const prevType = previous.types[previousTypeName];
    if (!prevType) {
      throw new Error(
        `Cannot rename ${label}: type "${previousTypeName}" does not exist in the previous schema.`,
      );
    }
    if (current.types[previousTypeName]) {
      throw new Error(
        `Cannot rename ${label}: type "${previousTypeName}" still exists in the current schema.`,
      );
    }
    const currType = current.types[typeName];
    if (!currType) {
      throw new Error(
        `Cannot rename ${label}: type "${typeName}" does not exist in the current schema.`,
      );
    }
    if (previous.types[typeName]) {
      throw new Error(
        `Cannot rename ${label}: type "${typeName}" already exists in the previous schema.`,
      );
    }
    if (!isTypeRenameCompatible(prevType, currType)) {
      throw new Error(
        `Cannot rename ${label}: the types are not rename-compatible ` +
          `(every field must keep its name, type, array-ness, required/unique constraints, ` +
          `foreign key target, and scale, enum values must not be removed, indexes must match, ` +
          `and types with serial or file fields cannot be renamed).`,
      );
    }
  }
}

const TYPE_RENAME_OPTION_PATTERN = /^([^.:\s]+):([^.:\s]+)$/;

/**
 * Parse a `--rename` option value of the form `OldType:NewType`.
 * @param {string} value - Raw option value
 * @returns {TypeRenameSpec} Parsed rename spec
 */
export function parseTypeRenameOption(value: string): TypeRenameSpec {
  const match = value.match(TYPE_RENAME_OPTION_PATTERN);
  const [, previousTypeName, typeName] = match ?? [];
  if (!previousTypeName || !typeName) {
    throw new Error(
      `Invalid --rename value "${value}". Expected format: "Type.oldField:newField" or "OldType:NewType".`,
    );
  }
  if (previousTypeName === typeName) {
    throw new Error(`Invalid --rename value "${value}": old and new type names are identical.`);
  }
  return { previousTypeName, typeName };
}

/**
 * A type removal confirmed as intentional (`--drop Type`), so its rename
 * candidates need no interactive confirmation.
 */
export interface TypeDropSpec {
  typeName: string;
}

const TYPE_DROP_OPTION_PATTERN = /^([^.:\s]+)$/;

/**
 * Parse a `--drop` option value of the form `Type`.
 * @param {string} value - Raw option value
 * @returns {TypeDropSpec} Parsed drop spec
 */
export function parseTypeDropOption(value: string): TypeDropSpec {
  const match = value.match(TYPE_DROP_OPTION_PATTERN);
  const [, typeName] = match ?? [];
  if (!typeName) {
    throw new Error(`Invalid --drop value "${value}". Expected format: "Type.field" or "Type".`);
  }
  return { typeName };
}

/**
 * Whether a type drop spec matches a type that was removed between two
 * snapshots: the type existed before and is gone now.
 * @param {TypeDropSpec} spec - Drop spec to test
 * @param {SchemaSnapshot} previousSnapshot - Previous schema snapshot
 * @param {SchemaSnapshot} currentSnapshot - Current schema snapshot
 * @returns {boolean} True if the spec matches a removed type
 */
export function typeDropSpecApplies(
  spec: TypeDropSpec,
  previousSnapshot: SchemaSnapshot,
  currentSnapshot: SchemaSnapshot,
): boolean {
  return Boolean(previousSnapshot.types[spec.typeName] && !currentSnapshot.types[spec.typeName]);
}
