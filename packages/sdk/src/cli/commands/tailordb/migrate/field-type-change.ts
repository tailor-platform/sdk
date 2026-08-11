import type { SnapshotFieldConfig } from "./snapshot-types";

/**
 * Scalar type changes whose complete source domain is accepted by the target
 * representation without relying on per-row index recreation.
 *
 * Keep this list deliberately narrow. Pair-specific platform experiments can
 * extend it once both indexed and unindexed read paths have been verified.
 */
const IN_PLACE_TYPE_CHANGES = new Set([
  "decimal:string",
  "enum:string",
  "integer:float",
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

/**
 * Determine whether a field type change can be carried by a pair of migrations
 * that move values through a temporary field.
 *
 * The copy is a whole-value overwrite, so it can only carry a field whose value
 * stands on its own: a serial number belongs to a sequence the copy cannot
 * reproduce, a foreign key would dangle while both fields exist, a vector
 * belongs to an index built from it, and a nested value would need its members
 * converted individually. Arrays are excluded because collapsing one into a
 * single value has no answer the generated script could choose.
 * @param before - Previous field configuration
 * @param after - Target field configuration
 * @returns Whether the change can be split into expand and contract migrations
 */
export function supportsExpandContractFieldChange(
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
): boolean {
  if (before.type === after.type) return false;
  if (supportsInPlaceFieldTypeChange(before, after)) return false;
  if (before.array || after.array) return false;
  if (before.type === "nested" || after.type === "nested") return false;
  if (before.serial || after.serial) return false;
  if (before.vector || after.vector) return false;
  if (before.foreignKey || after.foreignKey) return false;

  return true;
}
