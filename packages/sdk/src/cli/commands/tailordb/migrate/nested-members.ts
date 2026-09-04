/**
 * Member-level diff of a nested field
 *
 * The diff engine compares nested fields wholesale: any member change surfaces
 * as one `field_modified` on the top-level field. This module walks the member
 * structures so the diff display can name the changed members and removed
 * members can be surfaced as data-loss warnings.
 */

import type { SnapshotFieldConfig } from "./snapshot-types";

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
 * differs. A member present on one side only is reported once, without
 * descending into its members. Removed members come first, then added, then
 * the rest in `before` order.
 * @param {SnapshotFieldConfig} before - Field configuration before the change
 * @param {SnapshotFieldConfig} after - Field configuration after the change
 * @returns {NestedMemberChange[]} Member changes with paths relative to the field (may be empty)
 */
export function collectNestedMemberChanges(
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
): NestedMemberChange[] {
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
    rest.push(...collectMemberChanges(beforeMember.fields ?? {}, afterMember.fields ?? {}, path));
    if (ownConfigDiffers(beforeMember, afterMember)) {
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

function ownConfigDiffers(before: SnapshotFieldConfig, after: SnapshotFieldConfig): boolean {
  return (
    stableStringify(comparableOwnConfig(before)) !== stableStringify(comparableOwnConfig(after))
  );
}

// Own configuration as the diff engine compares it: no members, enum values in value order.
function comparableOwnConfig(config: SnapshotFieldConfig): Omit<SnapshotFieldConfig, "fields"> {
  const { fields: _fields, allowedValues, ...own } = config;
  return {
    ...own,
    ...(allowedValues && {
      allowedValues: allowedValues.toSorted((a, b) => a.value.localeCompare(b.value)),
    }),
  };
}

/**
 * JSON serialization with recursively sorted object keys, for deep equality.
 * @param {unknown} value - Value to serialize
 * @returns {string} Canonical JSON representation
 */
export function stableStringify(value: unknown): string {
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
