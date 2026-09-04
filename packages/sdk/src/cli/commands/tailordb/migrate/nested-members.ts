/**
 * Member-level diff of a nested field
 *
 * The diff engine compares nested fields wholesale: any member change surfaces
 * as one `field_modified` on the top-level field. This module walks the member
 * structures so the diff display can name the changed members and removed
 * members can be surfaced as data-loss warnings. It also owns the field
 * configuration comparison that the diff engine and the member walk share.
 */

import { assertDefined } from "#/utils/assert";
import { SNAPSHOT_FIELD_BOOLEAN_PROPS, type SnapshotFieldConfig } from "./snapshot-types";

/** A change to one member inside a nested field. */
export type NestedMemberChange =
  | { kind: "removed"; path: string[]; before: SnapshotFieldConfig }
  | { kind: "added"; path: string[]; after: SnapshotFieldConfig }
  | { kind: "modified"; path: string[]; before: SnapshotFieldConfig; after: SnapshotFieldConfig };

/**
 * Collect the member changes between two versions of a nested field.
 *
 * A member present on both sides is recursed into; it is reported as
 * `modified` only when its own configuration (everything except its members)
 * differs. A member present on one side only, or a field or member whose type
 * changed, is treated as a whole without descending into its members. Removed
 * members come first, then added, then the rest in `before` order.
 * @param {SnapshotFieldConfig} before - Field configuration before the change
 * @param {SnapshotFieldConfig} after - Field configuration after the change
 * @returns {NestedMemberChange[]} Member changes with paths relative to the field (may be empty)
 */
export function collectNestedMemberChanges(
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
): NestedMemberChange[] {
  if (before.type !== after.type) return [];
  return collectMemberChanges(before.fields ?? {}, after.fields ?? {}, []);
}

function collectMemberChanges(
  beforeMembers: Record<string, SnapshotFieldConfig>,
  afterMembers: Record<string, SnapshotFieldConfig>,
  parentPath: string[],
): NestedMemberChange[] {
  const removed: NestedMemberChange[] = [];
  const added: NestedMemberChange[] = [];
  const rest: NestedMemberChange[] = [];

  for (const [name, beforeMember] of Object.entries(beforeMembers)) {
    const path = [...parentPath, name];
    const afterMember = Object.hasOwn(afterMembers, name) ? afterMembers[name] : undefined;
    if (!afterMember) {
      removed.push({ kind: "removed", path, before: beforeMember });
      continue;
    }
    if (beforeMember.type === afterMember.type) {
      rest.push(...collectMemberChanges(beforeMember.fields ?? {}, afterMember.fields ?? {}, path));
    }
    if (areOwnFieldConfigsDifferent(beforeMember, afterMember)) {
      rest.push({ kind: "modified", path, before: beforeMember, after: afterMember });
    }
  }

  for (const [name, afterMember] of Object.entries(afterMembers)) {
    if (!Object.hasOwn(beforeMembers, name)) {
      added.push({ kind: "added", path: [...parentPath, name], after: afterMember });
    }
  }

  return [...removed, ...added, ...rest];
}

/**
 * Whether two field configurations differ in anything but their nested
 * members. Optional booleans default to `false`, enum values are compared as a
 * set, and hooks and validations by their expressions.
 * @param {SnapshotFieldConfig} oldField - Old field configuration
 * @param {SnapshotFieldConfig} newField - New field configuration
 * @returns {boolean} True if the configurations differ
 */
export function areOwnFieldConfigsDifferent(
  oldField: SnapshotFieldConfig,
  newField: SnapshotFieldConfig,
): boolean {
  if (oldField.type !== newField.type) return true;
  if (oldField.required !== newField.required) return true;

  for (const prop of SNAPSHOT_FIELD_BOOLEAN_PROPS) {
    if ((oldField[prop] ?? false) !== (newField[prop] ?? false)) return true;
  }

  if (oldField.foreignKeyType !== newField.foreignKeyType) return true;
  if (oldField.foreignKeyField !== newField.foreignKeyField) return true;

  if ((oldField.description ?? "") !== (newField.description ?? "")) return true;

  const oldAllowed = oldField.allowedValues ?? [];
  const newAllowed = newField.allowedValues ?? [];
  if (oldAllowed.length !== newAllowed.length) return true;
  const newAllowedMap = new Map(newAllowed.map((v) => [v.value, v.description]));
  for (const v of oldAllowed) {
    if (!newAllowedMap.has(v.value)) return true;
    if ((v.description ?? "") !== (newAllowedMap.get(v.value) ?? "")) return true;
  }

  const oldHooks = oldField.hooks;
  const newHooks = newField.hooks;
  if (Boolean(oldHooks) !== Boolean(newHooks)) return true;
  if (oldHooks && newHooks) {
    if ((oldHooks.create?.expr ?? "") !== (newHooks.create?.expr ?? "")) return true;
    if ((oldHooks.update?.expr ?? "") !== (newHooks.update?.expr ?? "")) return true;
  }

  const oldValidate = oldField.validate ?? [];
  const newValidate = newField.validate ?? [];
  if (oldValidate.length !== newValidate.length) return true;
  for (let i = 0; i < oldValidate.length; i++) {
    const oldV = assertDefined(oldValidate[i], `oldValidate missing index ${i}`);
    const newV = assertDefined(newValidate[i], `newValidate missing index ${i}`);
    if ((oldV.script?.expr ?? "") !== (newV.script?.expr ?? "")) return true;
    if (oldV.errorMessage !== newV.errorMessage) return true;
  }

  const oldSerial = oldField.serial;
  const newSerial = newField.serial;
  if (Boolean(oldSerial) !== Boolean(newSerial)) return true;
  if (oldSerial && newSerial) {
    if (oldSerial.start !== newSerial.start) return true;
    if (oldSerial.maxValue !== newSerial.maxValue) return true;
    if ((oldSerial.format ?? "") !== (newSerial.format ?? "")) return true;
  }

  if (oldField.scale !== newField.scale) return true;

  if (oldField.default !== newField.default) {
    if (typeof oldField.default !== typeof newField.default) return true;
    if (JSON.stringify(oldField.default) !== JSON.stringify(newField.default)) return true;
  }

  return false;
}
