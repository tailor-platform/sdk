/**
 * Pre-migration field config adjustments
 *
 * The Pre-phase sends a "relaxed" version of the target schema so that
 * `migrate.ts` scripts can still operate on the previous shape of the data.
 * This module handles the field-level adjustments:
 *
 * - `field_removed`: re-insert the removed field so migrate.ts can read it
 *   (the physical drop happens in Post-phase).
 * - `field_added` with `required: true`: relax to `required: false`.
 * - `field_modified` optional→required, unique constraint added, enum
 *   value removed: keep the looser side until Post-phase.
 *
 * Type-level deletions (`type_removed`) are handled by the deploy flow,
 * which retains the type until Post-phase rather than via this module.
 *
 * Post-phase then sends the final schema, after migrate.ts has had a chance
 * to fix up data.
 */

import { convertFieldConfigToProto } from "./snapshot-manifest";
import type { DiffChange, FieldDiffChange } from "./diff-calculator";
import type { PendingMigration } from "./types";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { TailorDBType_FieldConfigSchema } from "@tailor-proto/tailor/v1/tailordb_resource_pb";

/**
 * Diff change kinds that require pre-migration schema adjustments.
 */
const PRE_MIGRATION_FIELD_KINDS = new Set<DiffChange["kind"]>([
  "field_added",
  "field_modified",
  "field_removed",
]);

/**
 * Type guard: is the change a field-level change that needs pre-migration
 * schema adjustment?
 * @param {DiffChange} change - Diff change to test
 * @returns {boolean} True if the change is a field-level change
 */
function isPreMigrationFieldChange(change: DiffChange): change is FieldDiffChange {
  return PRE_MIGRATION_FIELD_KINDS.has(change.kind);
}

/**
 * Map of pre-migration field changes: typeName -> fieldName -> change.
 *
 * Includes both breaking changes (required-add, unique-add, enum value
 * removal) and warning changes (field_removed). The Pre-phase needs to
 * adjust the schema for both so that migrate.ts can still see the previous
 * shape.
 */
export type PreMigrationChangesMap = Map<string, Map<string, FieldDiffChange>>;

/**
 * Build a map of field changes that require pre-migration schema adjustment.
 * @param {PendingMigration[]} pendingMigrations - Pending migrations to scan
 * @returns {PreMigrationChangesMap} Map of changes keyed by typeName/fieldName
 */
export function buildPreMigrationChangesMap(
  pendingMigrations: PendingMigration[],
): PreMigrationChangesMap {
  const map: PreMigrationChangesMap = new Map();
  for (const migration of pendingMigrations) {
    for (const change of migration.diff.changes) {
      if (!isPreMigrationFieldChange(change)) continue;
      if (!change.fieldName) continue;
      const perType = map.get(change.typeName) ?? new Map<string, FieldDiffChange>();
      perType.set(change.fieldName, change);
      map.set(change.typeName, perType);
    }
  }
  return map;
}

/**
 * Apply pre-migration schema adjustments to a single field map in place.
 *
 * The fields map is the proto-shape `TailorDBType.schema.fields` that will
 * be sent in the Pre-phase. We mutate it so that:
 *
 * - Removed fields are re-inserted using their pre-migration config.
 * - Newly added required fields are relaxed to optional.
 * - Modified fields keep the looser side of unique/required/enum.
 *
 * @param {Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>>} fields - Field map to adjust (mutated in place)
 * @param {Map<string, FieldDiffChange>} typeChanges - Changes for this type, keyed by fieldName
 */
export function applyPreMigrationFieldAdjustments(
  fields: Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>>,
  typeChanges: Map<string, FieldDiffChange>,
): void {
  for (const [fieldName, change] of typeChanges) {
    if (change.kind === "field_removed") {
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (change.before) {
        fields[fieldName] = convertFieldConfigToProto(change.before);
      }
      continue;
    }

    const field = fields[fieldName];
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (!field) continue;

    if (change.kind === "field_added") {
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (change.after?.required) {
        field.required = false;
      }
      continue;
    }

    const { before, after } = change;

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (!before?.required && after?.required) {
      field.required = false;
    }

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (!(before?.unique ?? false) && (after?.unique ?? false)) {
      field.unique = false;
    }

    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (before?.allowedValues && after?.allowedValues) {
      const afterValues = new Set(after.allowedValues.map((v) => v.value));
      const removedValues = before.allowedValues.filter((v) => !afterValues.has(v.value));
      if (removedValues.length > 0) {
        const valueMap = new Map<string, string>();
        for (const v of before.allowedValues) {
          valueMap.set(v.value, v.description ?? "");
        }
        for (const v of after.allowedValues) {
          if (!valueMap.has(v.value)) {
            valueMap.set(v.value, v.description ?? "");
          }
        }
        field.allowedValues = Array.from(valueMap.entries()).map(([value, description]) => ({
          value,
          description,
        }));
      }
    }
  }
}
