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
 * - `relationship_removed`: re-insert the removed relationship so migrate.ts
 *   can still resolve `innerJoin` through the relationship being dropped in
 *   the same migration. The physical drop happens in Post-phase together
 *   with the underlying FK field.
 *
 * Type-level deletions (`type_removed`) are handled by the deploy flow,
 * which retains the type until Post-phase rather than via this module.
 *
 * Post-phase then sends the final schema, after migrate.ts has had a chance
 * to fix up data.
 */

import { convertFieldConfigToProto, convertRelationshipToProto } from "./snapshot-manifest";
import type { DiffChange } from "./diff-calculator";
import type { SnapshotFieldConfig, SnapshotRelationship } from "./snapshot";
import type { PendingMigration } from "./types";
import type { EnumValue } from "@/types/field-types";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  TailorDBType_FieldConfigSchema,
  TailorDBType_RelationshipConfigSchema,
} from "@tailor-proto/tailor/v1/tailordb_resource_pb";

/**
 * Diff change kinds that require pre-migration schema adjustments.
 */
const PRE_MIGRATION_FIELD_KINDS = new Set<DiffChange["kind"]>([
  "field_added",
  "field_modified",
  "field_removed",
]);

/**
 * Get the inner map for `key`, inserting an empty one if absent.
 * @param outer - Outer map keyed by typeName
 * @param key - Outer key (typeName)
 * @returns The inner map (existing or newly created)
 */
function getOrCreateInnerMap(
  outer: Map<string, Map<string, DiffChange>>,
  key: string,
): Map<string, DiffChange> {
  let inner = outer.get(key);
  if (!inner) {
    inner = new Map<string, DiffChange>();
    outer.set(key, inner);
  }
  return inner;
}

/**
 * Map of pre-migration field changes: typeName -> fieldName -> change.
 *
 * Includes both breaking changes (required-add, unique-add, enum value
 * removal) and warning changes (field_removed). The Pre-phase needs to
 * adjust the schema for both so that migrate.ts can still see the previous
 * shape.
 */
export type PreMigrationChangesMap = Map<string, Map<string, DiffChange>>;

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
      if (!PRE_MIGRATION_FIELD_KINDS.has(change.kind)) continue;
      if (!change.fieldName) continue;
      getOrCreateInnerMap(map, change.typeName).set(change.fieldName, change);
    }
  }
  return map;
}

/**
 * Field config subset for pre-migration adjustment heuristics.
 */
interface FieldConfig {
  required?: boolean;
  unique?: boolean;
  allowedValues?: EnumValue[];
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
 * @param {Map<string, DiffChange>} typeChanges - Changes for this type, keyed by fieldName
 */
export function applyPreMigrationFieldAdjustments(
  fields: Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>>,
  typeChanges: Map<string, DiffChange>,
): void {
  for (const [fieldName, change] of typeChanges) {
    if (change.kind === "field_removed") {
      const before = change.before as SnapshotFieldConfig | undefined;
      if (before) {
        fields[fieldName] = convertFieldConfigToProto(before);
      }
      continue;
    }

    const field = fields[fieldName];
    if (!field) continue;

    const before = change.before as FieldConfig | undefined;
    const after = change.after as FieldConfig | undefined;

    if (change.kind === "field_added" && after?.required) {
      field.required = false;
      continue;
    }

    if (change.kind !== "field_modified") {
      continue;
    }

    if (!before?.required && after?.required) {
      field.required = false;
    }

    if (!(before?.unique ?? false) && (after?.unique ?? false)) {
      field.unique = false;
    }

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

/**
 * Map of pre-migration relationship changes: typeName -> relationshipName -> change.
 *
 * Only `relationship_removed` is tracked — the Pre-phase reinstates the
 * removed relationship so that `migrate.ts` can resolve joins via it before
 * the Post-phase performs the physical drop alongside the underlying FK field.
 */
export type PreMigrationRelationshipChangesMap = Map<string, Map<string, DiffChange>>;

/**
 * Build a map of relationship changes that require pre-migration adjustment.
 * @param {PendingMigration[]} pendingMigrations - Pending migrations to scan
 * @returns {PreMigrationRelationshipChangesMap} Map keyed by typeName/relationshipName
 */
export function buildPreMigrationRelationshipChangesMap(
  pendingMigrations: PendingMigration[],
): PreMigrationRelationshipChangesMap {
  const map: PreMigrationRelationshipChangesMap = new Map();
  for (const migration of pendingMigrations) {
    for (const change of migration.diff.changes) {
      if (change.kind !== "relationship_removed") continue;
      if (!change.relationshipName) continue;
      getOrCreateInnerMap(map, change.typeName).set(change.relationshipName, change);
    }
  }
  return map;
}

/**
 * Restore relationships that were removed in this migration so the Pre-phase
 * schema still exposes them to `migrate.ts`. Mutates the supplied map in place.
 * @param {Record<string, MessageInitShape<typeof TailorDBType_RelationshipConfigSchema>>} relationships - Relationship map to adjust (mutated in place)
 * @param {Map<string, DiffChange>} typeChanges - Relationship changes for this type
 */
export function applyPreMigrationRelationshipAdjustments(
  relationships: Record<string, MessageInitShape<typeof TailorDBType_RelationshipConfigSchema>>,
  typeChanges: Map<string, DiffChange>,
): void {
  for (const [relationshipName, change] of typeChanges) {
    if (change.kind !== "relationship_removed") continue;
    const before = change.before as SnapshotRelationship | undefined;
    if (!before) continue;

    // Mirror the steady-state forward/backward field mapping so Pre-phase and
    // steady-state messages agree.
    const direction = change.relationshipType ?? "forward";
    relationships[relationshipName] = convertRelationshipToProto(before, direction);
  }
}
