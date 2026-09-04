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
 *   value removed: keep the looser side until Post-phase. Members removed
 *   from a nested field are re-inserted so migrate.ts can read them.
 * - `field_renamed`: keep the old field (readable by migrate.ts) and relax
 *   the new field's required/unique constraints until Post-phase.
 * - `field_type_modified`: keep the complete previous field config until
 *   Post-phase so migrate.ts runs against the previous type contract.
 *
 * and the table-level index adjustments:
 *
 * - `index_added` with `unique: true`: withhold the index until Post-phase.
 * - `index_modified` that gains a unique constraint or re-points a unique
 *   index at different fields: keep the previous definition until Post-phase.
 *
 * Table-level deletions (`table_removed`) and renames (`table_renamed`) are
 * handled by the deploy flow rather than via this module: the old table is
 * retained until Post-phase, and a renamed table's new table is created with
 * its full constraints in the Pre-phase (the copy script writes complete
 * rows, so nothing needs relaxing).
 *
 * Post-phase then sends the final schema, after migrate.ts has had a chance
 * to fix up data.
 */

import { assertDefined } from "#/utils/assert";
import { collectNestedMemberChanges } from "./nested-members";
import { isBreakingIndexChange } from "./snapshot";
import {
  convertFieldConfigToProto,
  convertIndexToProto,
  processNestedFieldsFromSnapshot,
} from "./snapshot-manifest";
import type {
  DiffChange,
  FieldDiffChange,
  IndexDiffChange,
  TableScriptsModifiedChange,
} from "./diff-calculator";
import type { SnapshotFieldConfig, TailorDBSnapshotType } from "./snapshot-types";
import type { PendingMigration } from "./types";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  TailorDBType_FieldConfigSchema,
  TailorDBType_IndexSchema,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";

function defineRecordEntry<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * Diff change kinds that require pre-migration schema adjustments.
 */
const PRE_MIGRATION_FIELD_KINDS = new Set<DiffChange["kind"]>([
  "field_added",
  "field_modified",
  "field_type_modified",
  "field_removed",
  "field_renamed",
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
 * Map of pre-migration field changes: tableName -> fieldName -> change.
 *
 * Includes both breaking changes (required-add, unique-add, enum value
 * removal) and warning changes (field_removed). The Pre-phase needs to
 * adjust the schema for both so that migrate.ts can still see the previous
 * shape.
 */
export type PreMigrationChangesMap = Map<string, Map<string, FieldDiffChange>>;

/**
 * Create the table snapshot used to build a Pre-phase manifest.
 *
 * This adjustment happens before manifest generation because field hooks and
 * validators are aggregated into table-level scripts by the manifest builder.
 * Replacing only the generated field proto would leave those scripts on the
 * target field contract while migrate.ts still runs against the previous one.
 * @param snapshotType - Final snapshot state for this migration
 * @param typeChanges - Field changes for this table, keyed by field name
 * @param typeScriptsChange - Table-level scripts changed by the same migration
 * @returns A snapshot with Pre-phase field contracts
 */
export function createPreMigrationSnapshotType(
  snapshotType: TailorDBSnapshotType,
  typeChanges: Map<string, FieldDiffChange>,
  typeScriptsChange?: TableScriptsModifiedChange,
): TailorDBSnapshotType {
  const fields = structuredClone(snapshotType.fields);
  let hasFieldTypeChange = false;

  for (const [fieldName, change] of typeChanges) {
    if (change.kind !== "field_type_modified") continue;
    hasFieldTypeChange = true;
    defineRecordEntry(fields, fieldName, structuredClone(change.before));
  }

  const preSnapshotType = { ...snapshotType, fields };
  if (!hasFieldTypeChange || !typeScriptsChange) return preSnapshotType;

  const {
    typeHookExpr: _targetHook,
    typeValidateExpr: _targetValidate,
    ...withoutTypeScripts
  } = preSnapshotType;
  return {
    ...withoutTypeScripts,
    ...(typeScriptsChange.before.typeHookExpr && {
      typeHookExpr: structuredClone(typeScriptsChange.before.typeHookExpr),
    }),
    ...(typeScriptsChange.before.typeValidateExpr !== undefined && {
      typeValidateExpr: typeScriptsChange.before.typeValidateExpr,
    }),
  };
}

/**
 * Build a map of field changes that require pre-migration schema adjustment.
 * @param {PendingMigration[]} pendingMigrations - Pending migrations to scan
 * @returns {PreMigrationChangesMap} Map of changes keyed by tableName/fieldName
 */
export function buildPreMigrationChangesMap(
  pendingMigrations: PendingMigration[],
): PreMigrationChangesMap {
  const map: PreMigrationChangesMap = new Map();
  for (const migration of pendingMigrations) {
    for (const change of migration.diff.changes) {
      if (!isPreMigrationFieldChange(change)) continue;
      if (!change.fieldName) continue;
      const perType = map.get(change.tableName) ?? new Map<string, FieldDiffChange>();
      perType.set(change.fieldName, change);
      map.set(change.tableName, perType);
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
 * - Modified fields keep the looser side of unique/required/enum, and
 *   members removed from a nested field are re-inserted.
 *
 * @param {Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>>} fields - Field map to adjust (mutated in place)
 * @param {Map<string, FieldDiffChange>} typeChanges - Changes for this table, keyed by fieldName
 */
export function applyPreMigrationFieldAdjustments(
  fields: Record<string, MessageInitShape<typeof TailorDBType_FieldConfigSchema>>,
  typeChanges: Map<string, FieldDiffChange>,
): void {
  for (const [fieldName, change] of typeChanges) {
    if (change.kind === "field_removed") {
      defineRecordEntry(fields, fieldName, convertFieldConfigToProto(change.before));
      continue;
    }

    if (change.kind === "field_renamed") {
      // Expand the rename into "keep the old field + relax the new field":
      // the copy script reads the old field while both coexist, and the
      // Post-phase drops the old field and enforces the new field's
      // constraints. Unique is always deferred because stored values of a
      // previously removed field with the new name may still contain
      // duplicates until the copy overwrites them.
      defineRecordEntry(fields, change.previousFieldName, convertFieldConfigToProto(change.before));
      const newField = fields[fieldName];
      if (newField) {
        if (change.after.required) newField.required = false;
        if (change.after.unique ?? false) newField.unique = false;
      }
      continue;
    }

    const field = fields[fieldName];
    if (!field) continue;

    if (change.kind === "field_added") {
      if (change.after.required) {
        field.required = false;
      }
      continue;
    }

    if (change.kind === "field_type_modified") {
      defineRecordEntry(fields, fieldName, convertFieldConfigToProto(change.before));
      continue;
    }

    const { before, after } = change;

    restoreRemovedNestedMembers(field, before, after);

    if (!before.required && after.required) {
      field.required = false;
    }

    if (!(before.unique ?? false) && (after.unique ?? false)) {
      field.unique = false;
    }

    if (before.allowedValues && after.allowedValues) {
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

type ProtoFieldConfig = MessageInitShape<typeof TailorDBType_FieldConfigSchema>;

/**
 * Re-insert members removed from a nested field so migrate.ts can still read
 * them; the Post-phase drops them.
 * @param {ProtoFieldConfig} field - Pre-phase proto field to adjust (mutated in place)
 * @param {SnapshotFieldConfig} before - Field configuration before the change
 * @param {SnapshotFieldConfig} after - Field configuration after the change
 */
function restoreRemovedNestedMembers(
  field: ProtoFieldConfig,
  before: SnapshotFieldConfig,
  after: SnapshotFieldConfig,
): void {
  for (const change of collectNestedMemberChanges(before, after)) {
    if (change.kind !== "removed") continue;
    const memberPath = change.path.join(".");
    const parentMembers = assertDefined(
      change.path
        .slice(0, -1)
        .reduce<ProtoFieldConfig | undefined>(
          (current, segment) => current?.fields?.[segment],
          field,
        )?.fields,
      `parent of removed nested member "${memberPath}" missing from the Pre-phase field`,
    );
    const memberName = assertDefined(change.path.at(-1), "removed nested member path is empty");
    const restored = processNestedFieldsFromSnapshot({ [memberName]: change.before });
    defineRecordEntry(
      parentMembers,
      memberName,
      assertDefined(restored[memberName], `restored nested member "${memberPath}" missing`),
    );
  }
}

/**
 * Map of pre-migration index changes needing relaxation:
 * tableName -> indexName -> change.
 */
export type PreMigrationIndexChangesMap = Map<string, Map<string, IndexDiffChange>>;

/**
 * Build a map of table-level index changes that require pre-migration schema
 * adjustment (the breaking ones — see {@link isBreakingIndexChange}).
 * @param {PendingMigration[]} pendingMigrations - Pending migrations to scan
 * @returns {PreMigrationIndexChangesMap} Map of changes keyed by tableName/indexName
 */
export function buildPreMigrationIndexChangesMap(
  pendingMigrations: PendingMigration[],
): PreMigrationIndexChangesMap {
  const map: PreMigrationIndexChangesMap = new Map();
  for (const migration of pendingMigrations) {
    for (const change of migration.diff.changes) {
      if (change.kind !== "index_added" && change.kind !== "index_modified") continue;
      const before = change.kind === "index_modified" ? change.before : undefined;
      if (!isBreakingIndexChange(change.tableName, change.indexName, before, change.after)) {
        continue;
      }
      const perType = map.get(change.tableName) ?? new Map<string, IndexDiffChange>();
      perType.set(change.indexName, change);
      map.set(change.tableName, perType);
    }
  }
  return map;
}

/**
 * Apply pre-migration schema adjustments to a table's index map in place.
 *
 * The indexes map is the proto-shape `TailorDBType.schema.indexes` that will
 * be sent in the Pre-phase. We mutate it so that:
 *
 * - Newly added unique indexes are withheld until Post-phase.
 * - Modified indexes keep their previous definition until Post-phase.
 *
 * @param {Record<string, MessageInitShape<typeof TailorDBType_IndexSchema>>} indexes - Index map to adjust (mutated in place)
 * @param {Map<string, IndexDiffChange>} typeIndexChanges - Changes for this table, keyed by indexName
 */
export function applyPreMigrationIndexAdjustments(
  indexes: Record<string, MessageInitShape<typeof TailorDBType_IndexSchema>>,
  typeIndexChanges: Map<string, IndexDiffChange>,
): void {
  for (const [indexName, change] of typeIndexChanges) {
    if (change.kind === "index_added") {
      delete indexes[indexName];
      continue;
    }
    if (change.kind === "index_modified") {
      defineRecordEntry(indexes, indexName, convertIndexToProto(change.before));
    }
  }
}
