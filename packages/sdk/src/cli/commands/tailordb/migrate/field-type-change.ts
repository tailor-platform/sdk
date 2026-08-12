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

/** Result of checking whether a field type change can use expand-contract. */
export type ExpandContractFieldChangeEligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

/**
 * Explain whether a field type change can be carried by a pair of migrations
 * that move values through a temporary field.
 *
 * The copy is a whole-value overwrite, so it can only carry a field whose value
 * stands on its own: a serial number belongs to a sequence the copy cannot
 * reproduce, a foreign key would dangle while both fields exist, a vector
 * belongs to an index built from it, and a nested value would need its members
 * converted individually. Arrays are excluded because collapsing one into a
 * single value has no answer the generated script could choose, and unique
 * fields because the duplicate-resolution scaffold the rename half would emit
 * only produces string values.
 * @param before - Previous field configuration
 * @param after - Target field configuration
 * @returns Eligibility and, when ineligible, the reason
 */
export function getExpandContractFieldChangeEligibility(
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
): ExpandContractFieldChangeEligibility {
  if (before.type === after.type)
    return { eligible: false, reason: "the field type did not change" };
  if (supportsInPlaceFieldTypeChange(before, after)) {
    return {
      eligible: false,
      reason: `the ${before.type} to ${after.type} change is already supported in place`,
    };
  }
  if (before.unique || after.unique) return { eligible: false, reason: "the field is unique" };
  if (before.array || after.array) return { eligible: false, reason: "the field is an array" };
  if (before.type === "nested" || after.type === "nested") {
    return { eligible: false, reason: "the field is nested" };
  }
  if (before.serial || after.serial) {
    return { eligible: false, reason: "the field uses a serial sequence" };
  }
  if (before.vector || after.vector) return { eligible: false, reason: "the field is a vector" };
  if (before.foreignKey || after.foreignKey) {
    return { eligible: false, reason: "the field is a foreign key" };
  }

  return { eligible: true };
}
