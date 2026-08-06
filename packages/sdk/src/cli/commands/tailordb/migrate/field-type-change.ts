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
