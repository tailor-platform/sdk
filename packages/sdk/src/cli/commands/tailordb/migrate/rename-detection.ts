/**
 * Field and table rename detection for TailorDB migrations
 *
 * A rename has no dedicated platform API, so the diff decomposes it into
 * `field_removed` + `field_added` (`table_removed` + `table_added` for tables).
 * This module detects removed/added pairs that are compatible enough to be a
 * rename so that `migration generate` can ask the user (or accept
 * `--rename Table.oldField:newField` / `--rename OldTable:NewTable`) and record a single
 * `field_renamed` / `table_renamed` change instead.
 */

import { collectNestedMemberChanges, getNestedMember } from "./nested-members";
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
  TableAddedChange,
  TableRemovedChange,
} from "./diff-calculator";

/**
 * A confirmed field rename to record in the migration diff.
 */
export interface FieldRenameSpec {
  tableName: string;
  /** Field name before the rename. */
  previousFieldName: string;
  /** Field name after the rename. */
  fieldName: string;
}

/**
 * A removed field together with the added fields it could have been renamed to.
 */
export interface FieldRenameCandidate {
  tableName: string;
  removed: FieldRemovedChange;
  /** Compatible added fields in the same table, in diff order. */
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
      const list = removedByType.get(change.tableName) ?? [];
      list.push(change);
      removedByType.set(change.tableName, list);
    } else if (change.kind === "field_added") {
      const list = addedByType.get(change.tableName) ?? [];
      list.push(change);
      addedByType.set(change.tableName, list);
    }
  }

  const candidates: FieldRenameCandidate[] = [];
  for (const [tableName, removedChanges] of removedByType) {
    const addedChanges = addedByType.get(tableName);
    if (!addedChanges) continue;
    for (const removed of removedChanges) {
      const added = addedChanges.filter((a) => isRenameCompatible(removed.before, a.after));
      if (added.length > 0) {
        candidates.push({ tableName, removed, added });
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
  const prevFields = previousSnapshot.tables[spec.tableName]?.fields;
  const currFields = currentSnapshot.tables[spec.tableName]?.fields;
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
    const { tableName, previousFieldName, fieldName } = rename;
    const label = `${tableName}.${previousFieldName}:${fieldName}`;
    for (const key of [`${tableName}.${previousFieldName}`, `${tableName}.${fieldName}`]) {
      if (seen.has(key)) {
        throw new Error(`Field "${key}" appears in more than one rename.`);
      }
      seen.add(key);
    }

    const prevType = previous.tables[tableName];
    const currType = current.tables[tableName];
    if (!prevType || !currType) {
      throw new Error(
        `Cannot rename ${label}: table "${tableName}" must exist in both the previous and the current schema.`,
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
 * Parse a `--rename` option value of the form `Table.oldField:newField`.
 * @param {string} value - Raw option value
 * @returns {FieldRenameSpec} Parsed rename spec
 */
export function parseRenameOption(value: string): FieldRenameSpec {
  const match = value.match(RENAME_OPTION_PATTERN);
  const [, tableName, previousFieldName, fieldName] = match ?? [];
  if (!tableName || !previousFieldName || !fieldName) {
    throw new Error(
      `Invalid --rename value "${value}". Expected format: "Table.oldField:newField".`,
    );
  }
  if (previousFieldName === fieldName) {
    throw new Error(`Invalid --rename value "${value}": old and new field names are identical.`);
  }
  return { tableName, previousFieldName, fieldName };
}

/**
 * A field removal confirmed as intentional (`--drop Table.field`), so its
 * rename candidates need no interactive confirmation.
 */
export interface FieldDropSpec {
  tableName: string;
  fieldName: string;
}

const DROP_OPTION_PATTERN = /^([^.:\s]+)\.([^.:\s]+)$/;

/**
 * Parse a `--drop` option value of the form `Table.field`.
 * @param {string} value - Raw option value
 * @returns {FieldDropSpec} Parsed drop spec
 */
export function parseDropOption(value: string): FieldDropSpec {
  const match = value.match(DROP_OPTION_PATTERN);
  const [, tableName, fieldName] = match ?? [];
  if (!tableName || !fieldName) {
    throw new Error(`Invalid --drop value "${value}". Expected format: "Table.field".`);
  }
  return { tableName, fieldName };
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
  const prevFields = previousSnapshot.tables[spec.tableName]?.fields;
  const currFields = currentSnapshot.tables[spec.tableName]?.fields;
  return Boolean(prevFields?.[spec.fieldName] && !currFields?.[spec.fieldName]);
}

/** A field the user approved for conversion through a temporary field. */
export interface FieldExpandContractSpec {
  tableName: string;
  fieldName: string;
}

/**
 * Parse an `--expand-contract` option value of the form `Table.field`.
 * @param {string} value - Raw option value
 * @returns {FieldExpandContractSpec} Parsed spec
 */
export function parseExpandContractOption(value: string): FieldExpandContractSpec {
  const match = value.match(DROP_OPTION_PATTERN);
  const [, tableName, fieldName] = match ?? [];
  if (!tableName || !fieldName) {
    throw new Error(`Invalid --expand-contract value "${value}". Expected format: "Table.field".`);
  }
  return { tableName, fieldName };
}

// ============================================================================
// Nested Member Renames
// ============================================================================

/**
 * A confirmed rename of a member inside a nested field. Paths are relative to
 * the top-level field and share the same parent.
 */
export interface NestedMemberRenameSpec {
  tableName: string;
  /** Top-level nested field containing the member. */
  fieldName: string;
  /** Member path before the rename. */
  previousPath: string[];
  /** Member path after the rename. */
  path: string[];
}

/**
 * A removed nested member together with the added siblings it could have been
 * renamed to.
 */
export interface NestedMemberRenameCandidate {
  tableName: string;
  fieldName: string;
  previousPath: string[];
  removed: SnapshotFieldConfig;
  /** Compatible added sibling names, in diff order. */
  added: string[];
}

/**
 * Whether copying values from `before` into `after` preserves their meaning
 * for members inside a nested field. The Pre-phase never relaxes nested
 * member constraints, so unlike a top-level rename every constraint must match:
 * type, array-ness, requiredness, modifiers, foreign key target, scale,
 * hooks, and validations. Enum values may be added but not removed, serial
 * members cannot be renamed, and nested members must match recursively.
 * Description and default values may differ.
 * @param {SnapshotFieldConfig} before - Removed member's configuration
 * @param {SnapshotFieldConfig} after - Added member's configuration
 * @returns {boolean} True if the pair is rename-compatible
 */
export function isNestedMemberRenameCompatible(
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
): boolean {
  if (before.type !== after.type) return false;
  if (before.required !== after.required) return false;
  for (const prop of SNAPSHOT_FIELD_BOOLEAN_PROPS) {
    if ((before[prop] ?? false) !== (after[prop] ?? false)) return false;
  }
  if ((before.foreignKeyType ?? "") !== (after.foreignKeyType ?? "")) return false;
  if ((before.foreignKeyField ?? "") !== (after.foreignKeyField ?? "")) return false;
  if (before.serial || after.serial) return false;
  if ((before.scale ?? null) !== (after.scale ?? null)) return false;
  if ((before.hooks?.create?.expr ?? "") !== (after.hooks?.create?.expr ?? "")) return false;
  if ((before.hooks?.update?.expr ?? "") !== (after.hooks?.update?.expr ?? "")) return false;
  const beforeValidate = before.validate ?? [];
  const afterValidate = after.validate ?? [];
  if (beforeValidate.length !== afterValidate.length) return false;
  for (const [index, beforeRule] of beforeValidate.entries()) {
    const afterRule = afterValidate[index];
    if ((beforeRule.script?.expr ?? "") !== (afterRule?.script?.expr ?? "")) return false;
    if (beforeRule.errorMessage !== afterRule?.errorMessage) return false;
  }
  if (before.type === "enum") {
    const afterValues = new Set((after.allowedValues ?? []).map((v) => v.value));
    if ((before.allowedValues ?? []).some((v) => !afterValues.has(v.value))) return false;
  }
  const beforeMembers = before.fields ?? {};
  const afterMembers = after.fields ?? {};
  const beforeNames = Object.keys(beforeMembers);
  if (beforeNames.length !== Object.keys(afterMembers).length) return false;
  for (const name of beforeNames) {
    const beforeMember = beforeMembers[name];
    const afterMember = Object.hasOwn(afterMembers, name) ? afterMembers[name] : undefined;
    if (!beforeMember || !afterMember) return false;
    if (!isNestedMemberRenameCompatible(beforeMember, afterMember)) return false;
  }
  return true;
}

function haveSameParent(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.slice(0, -1).every((segment, index) => segment === b[index]);
}

/**
 * Find removed members inside nested fields that a compatible added sibling
 * could be the renamed form of.
 * @param {MigrationDiff} diff - Migration diff to scan
 * @returns {NestedMemberRenameCandidate[]} Candidates in diff order (may be empty)
 */
export function findNestedMemberRenameCandidates(
  diff: MigrationDiff,
): NestedMemberRenameCandidate[] {
  const candidates: NestedMemberRenameCandidate[] = [];
  for (const change of diff.changes) {
    if (change.kind !== "field_modified") continue;
    const memberChanges = collectNestedMemberChanges(change.before, change.after);
    for (const removed of memberChanges) {
      if (removed.kind !== "removed") continue;
      const added = memberChanges
        .filter(
          (candidate) =>
            candidate.kind === "added" &&
            haveSameParent(candidate.path, removed.path) &&
            isNestedMemberRenameCompatible(removed.before, candidate.after),
        )
        .map((candidate) => candidate.path[candidate.path.length - 1])
        .filter((name): name is string => name !== undefined);
      if (added.length > 0) {
        candidates.push({
          tableName: change.tableName,
          fieldName: change.fieldName,
          previousPath: removed.path,
          removed: removed.before,
          added,
        });
      }
    }
  }
  return candidates;
}

/**
 * Whether a nested member rename spec matches a removed + added member pair
 * between two snapshots. Compatibility is checked separately when the diff is
 * recomputed with the spec.
 * @param {NestedMemberRenameSpec} spec - Rename spec to test
 * @param {SchemaSnapshot} previousSnapshot - Previous schema snapshot
 * @param {SchemaSnapshot} currentSnapshot - Current schema snapshot
 * @returns {boolean} True if the spec matches a removed + added pair
 */
export function nestedMemberRenameSpecApplies(
  spec: NestedMemberRenameSpec,
  previousSnapshot: SchemaSnapshot,
  currentSnapshot: SchemaSnapshot,
): boolean {
  const prevField = previousSnapshot.tables[spec.tableName]?.fields[spec.fieldName];
  const currField = currentSnapshot.tables[spec.tableName]?.fields[spec.fieldName];
  return Boolean(
    getNestedMember(prevField, spec.previousPath) &&
    !getNestedMember(currField, spec.previousPath) &&
    getNestedMember(currField, spec.path) &&
    !getNestedMember(prevField, spec.path),
  );
}

/**
 * Assert that every nested member rename spec matches a compatible removed +
 * added member pair between the two normalized snapshots.
 * @param {NormalizedSchemaSnapshot} previous - Previous normalized snapshot
 * @param {NormalizedSchemaSnapshot} current - Current normalized snapshot
 * @param {readonly NestedMemberRenameSpec[]} renames - Rename specs to validate
 */
export function assertValidNestedMemberRenames(
  previous: NormalizedSchemaSnapshot,
  current: NormalizedSchemaSnapshot,
  renames: readonly NestedMemberRenameSpec[],
): void {
  const seen = new Set<string>();
  for (const rename of renames) {
    const { tableName, fieldName, previousPath, path } = rename;
    const previousLabel = `${tableName}.${fieldName}.${previousPath.join(".")}`;
    const label = `${previousLabel}:${path[path.length - 1] ?? ""}`;
    for (const key of [previousLabel, `${tableName}.${fieldName}.${path.join(".")}`]) {
      if (seen.has(key)) {
        throw new Error(`Member "${key}" appears in more than one rename.`);
      }
      seen.add(key);
    }
    if (previousPath.length === 0 || !haveSameParent(previousPath, path)) {
      throw new Error(
        `Cannot rename ${label}: the old and new member must share the same parent inside "${fieldName}".`,
      );
    }
    const prevField = previous.tables[tableName]?.fields[fieldName];
    const currField = current.tables[tableName]?.fields[fieldName];
    if (prevField?.type !== "nested" || currField?.type !== "nested") {
      throw new Error(
        `Cannot rename ${label}: "${tableName}.${fieldName}" must be a nested field in both the previous and the current schema.`,
      );
    }
    const prevMember = getNestedMember(prevField, previousPath);
    if (!prevMember) {
      throw new Error(
        `Cannot rename ${label}: member "${previousPath.join(".")}" does not exist in the previous schema.`,
      );
    }
    if (getNestedMember(currField, previousPath)) {
      throw new Error(
        `Cannot rename ${label}: member "${previousPath.join(".")}" still exists in the current schema.`,
      );
    }
    const currMember = getNestedMember(currField, path);
    if (!currMember) {
      throw new Error(
        `Cannot rename ${label}: member "${path.join(".")}" does not exist in the current schema.`,
      );
    }
    if (getNestedMember(prevField, path)) {
      throw new Error(
        `Cannot rename ${label}: member "${path.join(".")}" already exists in the previous schema.`,
      );
    }
    if (!isNestedMemberRenameCompatible(prevMember, currMember)) {
      throw new Error(
        `Cannot rename ${label}: the members are not rename-compatible ` +
          `(the member type, array-ness, requiredness, modifiers, foreign key target, scale, ` +
          `hooks, and validations must match, enum values must not be removed, nested members ` +
          `must match recursively, and serial members cannot be renamed).`,
      );
    }
  }
}

const NESTED_MEMBER_RENAME_OPTION_PATTERN = /^([^.:\s]+)\.([^.:\s]+)((?:\.[^.:\s]+)+):([^.:\s]+)$/;

/**
 * Parse a `--rename` option value of the form `Table.field.member:newName`,
 * where `member` may be a deeper dotted path inside the nested field.
 * @param {string} value - Raw option value
 * @returns {NestedMemberRenameSpec} Parsed rename spec
 */
export function parseNestedMemberRenameOption(value: string): NestedMemberRenameSpec {
  const match = value.match(NESTED_MEMBER_RENAME_OPTION_PATTERN);
  const [, tableName, fieldName, memberPath, newName] = match ?? [];
  if (!tableName || !fieldName || !memberPath || !newName) {
    throw new Error(
      `Invalid --rename value "${value}". Expected format: "Table.field.member:newName".`,
    );
  }
  const previousPath = memberPath.slice(1).split(".");
  if (previousPath[previousPath.length - 1] === newName) {
    throw new Error(`Invalid --rename value "${value}": old and new member names are identical.`);
  }
  return { tableName, fieldName, previousPath, path: [...previousPath.slice(0, -1), newName] };
}

/**
 * A nested member removal confirmed as intentional (`--drop Table.field.member`),
 * so its rename candidates need no interactive confirmation.
 */
export interface NestedMemberDropSpec {
  tableName: string;
  fieldName: string;
  path: string[];
}

const NESTED_MEMBER_DROP_OPTION_PATTERN = /^([^.:\s]+)\.([^.:\s]+)((?:\.[^.:\s]+)+)$/;

/**
 * Parse a `--drop` option value of the form `Table.field.member`.
 * @param {string} value - Raw option value
 * @returns {NestedMemberDropSpec} Parsed drop spec
 */
export function parseNestedMemberDropOption(value: string): NestedMemberDropSpec {
  const match = value.match(NESTED_MEMBER_DROP_OPTION_PATTERN);
  const [, tableName, fieldName, memberPath] = match ?? [];
  if (!tableName || !fieldName || !memberPath) {
    throw new Error(`Invalid --drop value "${value}". Expected format: "Table.field.member".`);
  }
  return { tableName, fieldName, path: memberPath.slice(1).split(".") };
}

/**
 * Whether a nested member drop spec matches a member that was removed between
 * two snapshots.
 * @param {NestedMemberDropSpec} spec - Drop spec to test
 * @param {SchemaSnapshot} previousSnapshot - Previous schema snapshot
 * @param {SchemaSnapshot} currentSnapshot - Current schema snapshot
 * @returns {boolean} True if the spec matches a removed member
 */
export function nestedMemberDropSpecApplies(
  spec: NestedMemberDropSpec,
  previousSnapshot: SchemaSnapshot,
  currentSnapshot: SchemaSnapshot,
): boolean {
  const prevField = previousSnapshot.tables[spec.tableName]?.fields[spec.fieldName];
  const currField = currentSnapshot.tables[spec.tableName]?.fields[spec.fieldName];
  return Boolean(getNestedMember(prevField, spec.path) && !getNestedMember(currField, spec.path));
}

// ============================================================================
// Table Renames
// ============================================================================

/**
 * A confirmed table rename to record in the migration diff.
 */
export interface TypeRenameSpec {
  /** Type name before the rename. */
  previousTableName: string;
  /** Type name after the rename. */
  tableName: string;
}

/**
 * A removed table together with the added tables it could have been renamed to.
 */
export interface TypeRenameCandidate {
  removed: TableRemovedChange;
  /** Compatible added tables, in diff order. */
  added: TableAddedChange[];
}

/**
 * Return a copy of a field config with foreign key references to the old table
 * name retargeted at the new name, so a self-referential table compares equal
 * to its renamed shape.
 * @param {SnapshotFieldConfig} field - Field configuration to retarget
 * @param {string} previousTableName - Type name before the rename
 * @param {string} tableName - Type name after the rename
 * @returns {SnapshotFieldConfig} Retargeted copy of the field
 */
function retargetSelfReferences(
  field: SnapshotFieldConfig,
  previousTableName: string,
  tableName: string,
): SnapshotFieldConfig {
  const nested = field.fields
    ? Object.fromEntries(
        Object.entries(field.fields).map(([name, member]) => [
          name,
          retargetSelfReferences(member, previousTableName, tableName),
        ]),
      )
    : undefined;
  return {
    ...field,
    ...(field.foreignKeyType === previousTableName && { foreignKeyType: tableName }),
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

function isTypeRenameFieldCompatible(
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
): boolean {
  if (!isRenameCompatible(before, after)) return false;
  if (before.required !== after.required) return false;
  if ((before.unique ?? false) !== (after.unique ?? false)) return false;
  if ((before.scale ?? null) !== (after.scale ?? null)) return false;

  for (const [name, beforeMember] of Object.entries(before.fields ?? {})) {
    const afterMember = after.fields?.[name];
    if (!afterMember || !isTypeRenameFieldCompatible(beforeMember, afterMember)) return false;
  }
  return true;
}

/**
 * Whether copying every row of `before` into `after` preserves the data, i.e.
 * the removed + added table pair can be treated as a rename.
 *
 * A renamed table is created with its full constraints in the Pre-phase (there
 * is no relaxation machinery for a fresh table), so the shape must match
 * strictly: same field names with the same type, array-ness, required/unique
 * constraints, foreign key target (self references compare against the new
 * name), and scale; enum values must not be removed; indexes must match.
 * Serial values cannot be written by a script and file contents are not
 * copied by SQL, so tables with serial or file fields are never candidates.
 * Name-derived and data-independent surfaces (pluralForm, description,
 * settings, permissions, hooks, validations, relationships) may differ.
 * @param {TailorDBSnapshotType} before - Removed table's snapshot
 * @param {TailorDBSnapshotType} after - Added table's snapshot
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
    // A required self-referential foreign key cannot survive the copy: the
    // batched insert cannot order rows parent-first and the two-phase
    // backfill needs the column to accept null first.
    if (beforeField.foreignKeyType === before.name && beforeField.required) return false;
    const retargeted = retargetSelfReferences(beforeField, before.name, after.name);
    if (!isTypeRenameFieldCompatible(retargeted, afterField)) return false;
  }

  return stableStringify(before.indexes ?? {}) === stableStringify(after.indexes ?? {});
}

/**
 * Find removed + added table pairs in a diff that could be renames.
 * @param {MigrationDiff} diff - Migration diff to scan
 * @returns {TypeRenameCandidate[]} Candidates in diff order (may be empty)
 */
export function findTypeRenameCandidates(diff: MigrationDiff): TypeRenameCandidate[] {
  const removedChanges = diff.changes.filter(
    (change): change is TableRemovedChange => change.kind === "table_removed",
  );
  const addedChanges = diff.changes.filter(
    (change): change is TableAddedChange => change.kind === "table_added",
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
 * Whether a table rename spec matches a removed + added table pair between two
 * snapshots: the old table existed before and is gone now, and the new table
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
    previousSnapshot.tables[spec.previousTableName] &&
    !currentSnapshot.tables[spec.previousTableName] &&
    currentSnapshot.tables[spec.tableName] &&
    !previousSnapshot.tables[spec.tableName],
  );
}

/**
 * Assert that every table rename spec matches a compatible removed + added
 * table pair between the two normalized snapshots.
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
    const { previousTableName, tableName } = rename;
    const label = `${previousTableName}:${tableName}`;
    for (const key of [previousTableName, tableName]) {
      if (seen.has(key)) {
        throw new Error(`Table "${key}" appears in more than one rename.`);
      }
      seen.add(key);
    }

    const prevType = previous.tables[previousTableName];
    if (!prevType) {
      throw new Error(
        `Cannot rename ${label}: table "${previousTableName}" does not exist in the previous schema.`,
      );
    }
    if (current.tables[previousTableName]) {
      throw new Error(
        `Cannot rename ${label}: table "${previousTableName}" still exists in the current schema.`,
      );
    }
    const currType = current.tables[tableName];
    if (!currType) {
      throw new Error(
        `Cannot rename ${label}: table "${tableName}" does not exist in the current schema.`,
      );
    }
    if (previous.tables[tableName]) {
      throw new Error(
        `Cannot rename ${label}: table "${tableName}" already exists in the previous schema.`,
      );
    }
    if (!isTypeRenameCompatible(prevType, currType)) {
      throw new Error(
        `Cannot rename ${label}: the tables are not rename-compatible ` +
          `(every field must keep its name, type, array-ness, required/unique constraints, ` +
          `foreign key target, and scale, enum values must not be removed, indexes must match, ` +
          `self-referential foreign keys must be optional, ` +
          `and tables with serial or file fields cannot be renamed).`,
      );
    }
  }
}

/**
 * Whether a field's foreign key target changed in a way that is not explained
 * by a confirmed table rename. Such a retarget is breaking (stored references
 * may become invalid) and needs a reference fixup script; a retarget that
 * follows a rename does not, because record ids are preserved by the copy —
 * provided the referenced field is unchanged, since the copy only guarantees
 * that the same ids exist under the new table name.
 * @param {SnapshotFieldConfig} before - Field configuration before the change
 * @param {SnapshotFieldConfig} after - Field configuration after the change
 * @param {ReadonlyMap<string, string>} [typeRenameTargets] - Confirmed table renames (old name → new name)
 * @returns {boolean} True if the retarget is breaking
 */
export function isBreakingForeignKeyRetarget(
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
  typeRenameTargets?: ReadonlyMap<string, string>,
): boolean {
  return Boolean(
    before.foreignKeyType &&
    after.foreignKeyType &&
    before.foreignKeyType !== after.foreignKeyType &&
    (typeRenameTargets?.get(before.foreignKeyType) !== after.foreignKeyType ||
      (before.foreignKeyField ?? "") !== (after.foreignKeyField ?? "")),
  );
}

const TYPE_RENAME_OPTION_PATTERN = /^([^.:\s]+):([^.:\s]+)$/;

/**
 * Parse a `--rename` option value of the form `OldTable:NewTable`.
 * @param {string} value - Raw option value
 * @returns {TypeRenameSpec} Parsed rename spec
 */
export function parseTypeRenameOption(value: string): TypeRenameSpec {
  const match = value.match(TYPE_RENAME_OPTION_PATTERN);
  const [, previousTableName, tableName] = match ?? [];
  if (!previousTableName || !tableName) {
    throw new Error(
      `Invalid --rename value "${value}". Expected format: "Table.oldField:newField" or "OldTable:NewTable".`,
    );
  }
  if (previousTableName === tableName) {
    throw new Error(`Invalid --rename value "${value}": old and new table names are identical.`);
  }
  return { previousTableName, tableName };
}

/**
 * A table removal confirmed as intentional (`--drop Table`), so its rename
 * candidates need no interactive confirmation.
 */
export interface TypeDropSpec {
  tableName: string;
}

const TYPE_DROP_OPTION_PATTERN = /^([^.:\s]+)$/;

/**
 * Parse a `--drop` option value of the form `Table`.
 * @param {string} value - Raw option value
 * @returns {TypeDropSpec} Parsed drop spec
 */
export function parseTypeDropOption(value: string): TypeDropSpec {
  const match = value.match(TYPE_DROP_OPTION_PATTERN);
  const [, tableName] = match ?? [];
  if (!tableName) {
    throw new Error(`Invalid --drop value "${value}". Expected format: "Table.field" or "Table".`);
  }
  return { tableName };
}

/**
 * Whether a table drop spec matches a table that was removed between two
 * snapshots: the table existed before and is gone now.
 * @param {TypeDropSpec} spec - Drop spec to test
 * @param {SchemaSnapshot} previousSnapshot - Previous schema snapshot
 * @param {SchemaSnapshot} currentSnapshot - Current schema snapshot
 * @returns {boolean} True if the spec matches a removed table
 */
export function typeDropSpecApplies(
  spec: TypeDropSpec,
  previousSnapshot: SchemaSnapshot,
  currentSnapshot: SchemaSnapshot,
): boolean {
  return Boolean(
    previousSnapshot.tables[spec.tableName] && !currentSnapshot.tables[spec.tableName],
  );
}
