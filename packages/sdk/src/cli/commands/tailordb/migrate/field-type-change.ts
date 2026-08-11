import type { SnapshotFieldConfig } from "./snapshot-types";

/**
 * Scalar type changes a normalized value can survive: every value the script
 * leaves behind is castable to the target, and reads back with its meaning
 * intact.
 *
 * Values are not required to cast as-is — `"abc"` in a `string` field still
 * fails to become an `integer`, and the generated script is where the user
 * normalizes it. What the pair must guarantee is that a representation valid
 * under both types exists. Date, datetime, and time values are not stored in
 * the textual form they were written in, so no such representation exists for
 * them; those pairs stay off this list even though the platform accepts the
 * schema change.
 *
 * Keep this list deliberately narrow. Pair-specific platform experiments can
 * extend it once both indexed and unindexed read paths have been verified.
 */
export const IN_PLACE_TYPE_CHANGES: ReadonlySet<string> = new Set([
  "boolean:string",
  "decimal:float",
  "decimal:string",
  "enum:string",
  "float:decimal",
  "float:string",
  "integer:boolean",
  "integer:decimal",
  "integer:float",
  "integer:string",
  "string:boolean",
  "string:decimal",
  "string:float",
  "string:integer",
  "string:uuid",
  "uuid:string",
]);

/**
 * Determine whether a field type change can use a single phased migration.
 * @param before - Previous field configuration
 * @param after - Target field configuration
 * @returns Whether the migration can normalize data before applying the type
 */
export function supportsInPlaceFieldTypeChange(
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
): boolean {
  if (before.type === after.type) return false;
  if (before.array || after.array) return false;
  if (before.type === "nested" || after.type === "nested") return false;
  if (before.serial || after.serial) return false;
  if (before.vector || after.vector) return false;
  if (before.foreignKey || after.foreignKey) return false;

  return IN_PLACE_TYPE_CHANGES.has(`${before.type}:${after.type}`);
}
