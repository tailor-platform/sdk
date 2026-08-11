import type { SnapshotFieldConfig } from "./snapshot-types";

/**
 * Scalar type changes whose complete source domain is accepted by the target
 * representation without relying on per-row index recreation.
 *
 * The whole source domain has to cast, not just the values present when the
 * script runs: the field keeps its previous type until the post-migration
 * phase, so an application can still write any value the source type allows
 * after the script has passed over the table. A pair that needs the script to
 * rewrite values first — `string` to `integer`, say, where `"abc"` never
 * casts — would fail that late write at the post-migration phase.
 *
 * Values must also read back with their meaning intact. Date, datetime, and
 * time values are not stored in the textual form they were written in, so
 * converting them to or from another type reads back as a different instant;
 * those pairs stay off this list even though the platform accepts the schema
 * change.
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
  "integer:decimal",
  "integer:float",
  "integer:string",
  "uuid:string",
]);

/**
 * Whether a conversion into this type can map two distinct source values onto
 * one target value, by rounding to a decimal scale or dropping a fraction.
 * @param after - Target field configuration
 * @returns Whether distinct values can converge
 */
function conversionCanCollapseValues(after: SnapshotFieldConfig): boolean {
  return after.type === "decimal" || after.type === "integer";
}

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

  // A field that is already unique gets no generated dedupe script, so a
  // conversion that can merge distinct values would fail the constraint after
  // the migration instead of surfacing the collision while it can be fixed.
  if ((before.unique ?? false) && conversionCanCollapseValues(after)) return false;

  return IN_PLACE_TYPE_CHANGES.has(`${before.type}:${after.type}`);
}
