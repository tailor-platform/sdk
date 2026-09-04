import * as inflection from "inflection";
import { assertDefined } from "#/utils/assert";
import {
  type MigrationDiff,
  type DiffChange,
  type FieldDiffChange,
  type BreakingChangeInfo,
  type SnapshotTypeSettingsState,
  type TypeScriptsState,
  type WarningChangeInfo,
  SCHEMA_SNAPSHOT_VERSION,
} from "./diff-calculator";
import { supportsInPlaceFieldTypeChange } from "./field-type-change";
import {
  assertValidFieldRenames,
  assertValidTypeRenames,
  isBreakingForeignKeyRetarget,
  type FieldRenameSpec,
  type TypeRenameSpec,
} from "./rename-detection";
import { copySnapshotRecord, normalizeSchemaSnapshot } from "./snapshot-normalization";
import {
  SNAPSHOT_FIELD_BOOLEAN_PROPS,
  type NormalizedSchemaSnapshot,
  type SchemaSnapshot,
  type SnapshotActionPermission,
  type SnapshotFieldConfig,
  type SnapshotGqlAction,
  type SnapshotGqlPermission,
  type SnapshotGqlOperations,
  type SnapshotIndexConfig,
  type SnapshotRecordPermission,
  type SnapshotRelationship,
  type SnapshotSettings,
  type TailorDBSnapshotType,
} from "./snapshot-types";
import {
  collectNestedMemberRemovalWarnings,
  FIELD_REMOVED_WARNING_REASON,
  TABLE_REMOVED_WARNING_REASON,
} from "./snapshot-warnings";
import type { ExpandContractPlan } from "./expand-contract";

// ============================================================================
// Snapshot Comparison
// ============================================================================

/**
 * Compare two field configs and determine if they are different
 * @param {SnapshotFieldConfig} oldField - Old field configuration
 * @param {SnapshotFieldConfig} newField - New field configuration
 * @returns {boolean} True if fields are different
 */
function areFieldsDifferent(oldField: SnapshotFieldConfig, newField: SnapshotFieldConfig): boolean {
  // Compare required properties
  if (oldField.type !== newField.type) return true;
  if (oldField.required !== newField.required) return true;

  // Compare optional boolean properties (default to false)
  for (const prop of SNAPSHOT_FIELD_BOOLEAN_PROPS) {
    if ((oldField[prop] ?? false) !== (newField[prop] ?? false)) return true;
  }

  // Compare foreign key properties
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

  const oldFields = oldField.fields ?? {};
  const newFields = newField.fields ?? {};
  const oldFieldNames = Object.keys(oldFields);
  const newFieldNames = Object.keys(newFields);
  if (oldFieldNames.length !== newFieldNames.length) return true;
  for (const fieldName of oldFieldNames) {
    const oldF = oldFields[fieldName];
    const newF = newFields[fieldName];
    if (!newF) return true;
    if (
      areFieldsDifferent(assertDefined(oldF, `field "${fieldName}" missing from oldFields`), newF)
    )
      return true;
  }

  return false;
}

/**
 * Collect breaking changes for a field change
 * @param {string} tableName - Name of the table containing the field
 * @param {string} fieldName - Name of the field being changed
 * @param {SnapshotFieldConfig | undefined} oldField - Old field configuration
 * @param {SnapshotFieldConfig | undefined} newField - New field configuration
 * @param {ReadonlyMap<string, string>} [typeRenameTargets] - Confirmed table renames (old name → new name)
 * @returns {BreakingChangeInfo[]} Breaking change information
 */
function getBreakingFieldChanges(
  tableName: string,
  fieldName: string,
  oldField: SnapshotFieldConfig | undefined,
  newField: SnapshotFieldConfig | undefined,
  typeRenameTargets?: ReadonlyMap<string, string>,
): BreakingChangeInfo[] {
  const breakingChanges: BreakingChangeInfo[] = [];

  // Field added as required - breaking (existing records don't have this value)
  if (!oldField && newField && newField.required) {
    breakingChanges.push({
      tableName,
      fieldName,
      reason: "Required field added",
    });
  }

  // Compatible scalar type changes use a phased in-place migration. Other
  // pairs still require expand-contract migration support.
  if (oldField && newField && oldField.type !== newField.type) {
    const supported = supportsInPlaceFieldTypeChange(oldField, newField);
    breakingChanges.push({
      tableName,
      fieldName,
      reason: `Field type changed from ${oldField.type} to ${newField.type}`,
      ...(!supported && { unsupported: true, showThreeStepHint: true }),
    });
  }

  // Optional to required - breaking
  if (oldField && newField && !oldField.required && newField.required) {
    breakingChanges.push({
      tableName,
      fieldName,
      reason: "Field changed from optional to required",
    });
  }

  // Array property changed - unsupported (requires 3-step migration)
  if (oldField && newField && (oldField.array ?? false) !== (newField.array ?? false)) {
    const [fromType, toType] = oldField.array
      ? ["array", "single value"]
      : ["single value", "array"];
    breakingChanges.push({
      tableName,
      fieldName,
      reason: `Field changed from ${fromType} to ${toType}`,
      unsupported: true,
      showThreeStepHint: true,
    });
  }

  // Foreign key relationship changed - breaking (existing references may become
  // invalid), unless it retargets a confirmed table rename: record ids are
  // preserved by the rename copy, so the stored references stay valid.
  if (oldField && newField && isBreakingForeignKeyRetarget(oldField, newField, typeRenameTargets)) {
    breakingChanges.push({
      tableName,
      fieldName,
      reason: `Foreign key target type changed from ${oldField.foreignKeyType} to ${newField.foreignKeyType}`,
    });
  }

  // Unique constraint added - breaking (existing duplicate values would violate constraint)
  if (oldField && newField && !(oldField.unique ?? false) && (newField.unique ?? false)) {
    breakingChanges.push({
      tableName,
      fieldName,
      reason: "Unique constraint added to field",
    });
  }

  // Decimal scale changed - breaking (rows stored under the old scale must be
  // re-saved so their stored precision matches the new schema)
  if (
    oldField?.type === "decimal" &&
    newField?.type === "decimal" &&
    oldField.scale !== newField.scale
  ) {
    breakingChanges.push({
      tableName,
      fieldName,
      reason: `Decimal scale changed from ${oldField.scale} to ${newField.scale}`,
    });
  }

  // Enum values removed - breaking (existing records may have removed values)
  if (oldField && newField && oldField.type === "enum" && newField.type === "enum") {
    const oldAllowed = oldField.allowedValues ?? [];
    const newAllowed = newField.allowedValues ?? [];
    const oldValues = oldAllowed.map((v) => v.value);
    const newValuesSet = new Set(newAllowed.map((v) => v.value));
    const removedValues = oldValues.filter((v) => !newValuesSet.has(v));
    if (removedValues.length > 0) {
      breakingChanges.push({
        tableName,
        fieldName,
        reason: `Enum values removed: ${removedValues.join(", ")}`,
      });
    }
  }

  return breakingChanges;
}

/**
 * Context for collecting diff changes, breaking changes, and warnings
 */
interface DiffContext {
  changes: DiffChange[];
  breakingChanges: BreakingChangeInfo[];
  warnings: WarningChangeInfo[];
  /** Confirmed table renames (old name → new name), for reference retargets. */
  typeRenameTargets?: ReadonlyMap<string, string>;
}

function addChange(
  ctx: DiffContext,
  change: FieldDiffChange,
  oldField: SnapshotFieldConfig | undefined,
  newField: SnapshotFieldConfig | undefined,
): void {
  ctx.changes.push(change);

  if (!change.fieldName) return;

  // A removed nested member is data loss regardless of any breaking change on the field.
  if (change.kind === "field_modified") {
    ctx.warnings.push(
      ...collectNestedMemberRemovalWarnings(
        change.tableName,
        change.fieldName,
        change.before,
        change.after,
      ),
    );
  }

  const breakingChanges = getBreakingFieldChanges(
    change.tableName,
    change.fieldName,
    oldField,
    newField,
    ctx.typeRenameTargets,
  );
  if (breakingChanges.length > 0) {
    ctx.breakingChanges.push(...breakingChanges);
    return;
  }

  // Non-breaking removal still risks losing schema access: surface a warning so users
  // can decide whether to add a migration script (e.g. JOIN through a
  // soon-to-be-dropped foreign key before it disappears).
  if (change.kind === "field_removed") {
    ctx.warnings.push({
      tableName: change.tableName,
      fieldName: change.fieldName,
      reason: FIELD_REMOVED_WARNING_REASON,
    });
  }
}

function compareTypeFields(
  ctx: DiffContext,
  tableName: string,
  prevType: TailorDBSnapshotType,
  currType: TailorDBSnapshotType,
  fieldRenames: readonly FieldRenameSpec[] = [],
): void {
  const prevFieldNames = new Set(Object.keys(prevType.fields));
  const currFieldNames = new Set(Object.keys(currType.fields));
  const renamedFromNames = new Set(fieldRenames.map((r) => r.previousFieldName));
  const renamedToNames = new Set(fieldRenames.map((r) => r.fieldName));

  for (const rename of fieldRenames) {
    const prevField = assertDefined(
      prevType.fields[rename.previousFieldName],
      `renamed field "${rename.previousFieldName}" missing from prevType`,
    );
    const currField = assertDefined(
      currType.fields[rename.fieldName],
      `renamed field "${rename.fieldName}" missing from currType`,
    );
    ctx.changes.push({
      kind: "field_renamed",
      tableName,
      fieldName: rename.fieldName,
      previousFieldName: rename.previousFieldName,
      before: prevField,
      after: currField,
    });
    ctx.breakingChanges.push({
      tableName,
      fieldName: rename.fieldName,
      reason: `Field renamed from ${rename.previousFieldName} to ${rename.fieldName} (existing values must be copied by the migration script)`,
    });
  }

  // Check for added fields
  for (const fieldName of currFieldNames) {
    if (renamedToNames.has(fieldName)) continue;
    if (!prevFieldNames.has(fieldName)) {
      const currField = assertDefined(
        currType.fields[fieldName],
        `field "${fieldName}" missing from currType`,
      );
      addChange(
        ctx,
        {
          kind: "field_added",
          tableName,
          fieldName,
          after: currField,
        },
        undefined,
        currField,
      );
    }
  }

  // Check for removed fields
  for (const fieldName of prevFieldNames) {
    if (renamedFromNames.has(fieldName)) continue;
    if (!currFieldNames.has(fieldName)) {
      const prevField = assertDefined(
        prevType.fields[fieldName],
        `field "${fieldName}" missing from prevType`,
      );
      addChange(
        ctx,
        {
          kind: "field_removed",
          tableName,
          fieldName,
          before: prevField,
        },
        prevField,
        undefined,
      );
    }
  }

  // Check for modified fields
  for (const fieldName of currFieldNames) {
    if (!prevFieldNames.has(fieldName)) continue;

    const prevField = assertDefined(
      prevType.fields[fieldName],
      `field "${fieldName}" missing from prevType`,
    );
    const currField = assertDefined(
      currType.fields[fieldName],
      `field "${fieldName}" missing from currType`,
    );

    if (areFieldsDifferent(prevField, currField)) {
      addChange(
        ctx,
        {
          kind: prevField.type === currField.type ? "field_modified" : "field_type_modified",
          tableName,
          fieldName,
          before: prevField,
          after: currField,
        },
        prevField,
        currField,
      );
    }
  }
}

/**
 * Determine if a table-level index change is breaking. Mirrors the field-level
 * unique reasoning: enforcing a unique constraint over existing rows can fail
 * on duplicates, so both adding a unique index and re-pointing an existing
 * unique index at a different field set require a data migration.
 * @param {string} tableName - Name of the table containing the index
 * @param {string} indexName - Name of the index being changed
 * @param {SnapshotIndexConfig | undefined} oldIndex - Old index configuration
 * @param {SnapshotIndexConfig | undefined} newIndex - New index configuration
 * @returns {BreakingChangeInfo | null} Breaking change info or null if not breaking
 */
export function isBreakingIndexChange(
  tableName: string,
  indexName: string,
  oldIndex: SnapshotIndexConfig | undefined,
  newIndex: SnapshotIndexConfig | undefined,
): BreakingChangeInfo | null {
  if (!newIndex || !(newIndex.unique ?? false)) return null;

  // Unique index added, or unique constraint added to an existing index
  if (!oldIndex || !(oldIndex.unique ?? false)) {
    return {
      tableName,
      reason: `Unique constraint added to index "${indexName}"`,
    };
  }

  // Unique index re-pointed at a different field set: the old constraint is
  // dropped and a new one enforced, so duplicates are just as possible.
  if (JSON.stringify(oldIndex.fields.toSorted()) !== JSON.stringify(newIndex.fields.toSorted())) {
    return {
      tableName,
      reason: `Unique index fields changed on index "${indexName}"`,
    };
  }

  return null;
}

/**
 * Compare table-level indexes
 * @param {DiffContext} ctx - Diff context
 * @param {string} tableName - Table name
 * @param {Record<string, SnapshotIndexConfig> | undefined} oldIndexes - Previous indexes
 * @param {Record<string, SnapshotIndexConfig> | undefined} newIndexes - Current indexes
 * @returns {void}
 */
function compareIndexes(
  ctx: DiffContext,
  tableName: string,
  oldIndexes: Record<string, SnapshotIndexConfig> | undefined,
  newIndexes: Record<string, SnapshotIndexConfig> | undefined,
): void {
  const oldKeys = new Set(Object.keys(oldIndexes || {}));
  const newKeys = new Set(Object.keys(newIndexes || {}));

  // Index added
  for (const [indexName, indexConfig] of Object.entries(newIndexes ?? {})) {
    if (!oldKeys.has(indexName)) {
      ctx.changes.push({
        kind: "index_added",
        tableName,
        indexName,
        after: indexConfig,
      });
      const breaking = isBreakingIndexChange(tableName, indexName, undefined, indexConfig);
      if (breaking) {
        ctx.breakingChanges.push(breaking);
      }
    }
  }

  // Index removed
  for (const [indexName, indexConfig] of Object.entries(oldIndexes ?? {})) {
    if (!newKeys.has(indexName)) {
      ctx.changes.push({
        kind: "index_removed",
        tableName,
        indexName,
        before: indexConfig,
      });
    }
  }

  // Index modified
  for (const [indexName, newIndex] of Object.entries(newIndexes ?? {})) {
    if (oldKeys.has(indexName)) {
      const oldIndex = assertDefined(
        assertDefined(oldIndexes, "oldIndexes is undefined when oldKeys has entry")[indexName],
        `index "${indexName}" missing from oldIndexes`,
      );

      const oldFieldsStr = JSON.stringify(oldIndex.fields.toSorted());
      const newFieldsStr = JSON.stringify(newIndex.fields.toSorted());

      if (
        oldFieldsStr !== newFieldsStr ||
        (oldIndex.unique ?? false) !== (newIndex.unique ?? false)
      ) {
        const reasons: string[] = [];
        if (oldFieldsStr !== newFieldsStr) reasons.push("fields changed");
        if ((oldIndex.unique ?? false) !== (newIndex.unique ?? false))
          reasons.push("unique constraint changed");
        ctx.changes.push({
          kind: "index_modified",
          tableName,
          indexName,
          reason: reasons.join(", "),
          before: oldIndex,
          after: newIndex,
        });
        const breaking = isBreakingIndexChange(tableName, indexName, oldIndex, newIndex);
        if (breaking) {
          ctx.breakingChanges.push(breaking);
        }
      }
    }
  }
}

/**
 * Compare table-level file fields
 * @param {DiffContext} ctx - Diff context
 * @param {string} tableName - Table name
 * @param {Record<string, string> | undefined} oldFiles - Previous file fields
 * @param {Record<string, string> | undefined} newFiles - Current file fields
 * @returns {void}
 */
function compareFiles(
  ctx: DiffContext,
  tableName: string,
  oldFiles: Record<string, string> | undefined,
  newFiles: Record<string, string> | undefined,
): void {
  const oldKeys = new Set(Object.keys(oldFiles || {}));
  const newKeys = new Set(Object.keys(newFiles || {}));

  // File field added
  for (const [fileName, fileDesc] of Object.entries(newFiles ?? {})) {
    if (!oldKeys.has(fileName)) {
      ctx.changes.push({
        kind: "file_added",
        tableName,
        fieldName: fileName,
        after: fileDesc,
      });
    }
  }

  // File field removed
  for (const [fileName, fileDesc] of Object.entries(oldFiles ?? {})) {
    if (!newKeys.has(fileName)) {
      ctx.changes.push({
        kind: "file_removed",
        tableName,
        fieldName: fileName,
        before: fileDesc,
      });
    }
  }

  // File field modified (description changed)
  for (const [fileName, newDesc] of Object.entries(newFiles ?? {})) {
    if (oldKeys.has(fileName)) {
      const oldDesc = assertDefined(
        assertDefined(oldFiles, "oldFiles is undefined when oldKeys has entry")[fileName],
        `file "${fileName}" missing from oldFiles`,
      );
      if (oldDesc !== newDesc) {
        ctx.changes.push({
          kind: "file_modified",
          tableName,
          fieldName: fileName,
          reason: "description changed",
          before: oldDesc,
          after: newDesc,
        });
      }
    }
  }
}

/**
 * Compare table-level relationships
 * @param {DiffContext} ctx - Diff context
 * @param {string} tableName - Table name
 * @param {"forward" | "backward"} relationshipType - Relationship direction to compare
 * @param {Record<string, SnapshotRelationship> | undefined} oldRelationships - Previous relationships
 * @param {Record<string, SnapshotRelationship> | undefined} newRelationships - Current relationships
 * @returns {void}
 */
function compareRelationships(
  ctx: DiffContext,
  tableName: string,
  relationshipType: "forward" | "backward",
  oldRelationships: Record<string, SnapshotRelationship> | undefined,
  newRelationships: Record<string, SnapshotRelationship> | undefined,
): void {
  const oldKeys = new Set(Object.keys(oldRelationships || {}));
  const newKeys = new Set(Object.keys(newRelationships || {}));

  // Relationship added
  for (const [relName, rel] of Object.entries(newRelationships ?? {})) {
    if (!oldKeys.has(relName)) {
      ctx.changes.push({
        kind: "relationship_added",
        tableName,
        relationshipName: relName,
        relationshipType,
        after: rel,
      });
    }
  }

  // Relationship removed
  for (const [relName, rel] of Object.entries(oldRelationships ?? {})) {
    if (!newKeys.has(relName)) {
      ctx.changes.push({
        kind: "relationship_removed",
        tableName,
        relationshipName: relName,
        relationshipType,
        before: rel,
      });
    }
  }

  // Relationship modified
  for (const [relName, newRel] of Object.entries(newRelationships ?? {})) {
    if (oldKeys.has(relName)) {
      const oldRel = assertDefined(
        assertDefined(oldRelationships, "oldRelationships is undefined when oldKeys has entry")[
          relName
        ],
        `relationship "${relName}" missing from oldRelationships`,
      );

      const reasons: string[] = [];
      if (oldRel.targetType !== newRel.targetType) reasons.push("targetType changed");
      if (oldRel.targetField !== newRel.targetField) reasons.push("targetField changed");
      if (oldRel.sourceField !== newRel.sourceField) reasons.push("sourceField changed");
      if (oldRel.isArray !== newRel.isArray) reasons.push("isArray changed");
      if (oldRel.description !== newRel.description) {
        reasons.push("description changed");
      }

      if (reasons.length > 0) {
        ctx.changes.push({
          kind: "relationship_modified",
          tableName,
          relationshipName: relName,
          relationshipType,
          reason: reasons.join(", "),
          before: oldRel,
          after: newRel,
        });
      }
    }
  }
}

/**
 * Compare table-level permissions
 * @param {DiffContext} ctx - Diff context
 * @param {string} tableName - Table name
 * @param {SnapshotRecordPermission | undefined} oldRecordPerm - Previous record permission
 * @param {SnapshotRecordPermission | undefined} newRecordPerm - Current record permission
 * @param {SnapshotGqlPermission | undefined} oldGqlPerm - Previous GQL permission
 * @param {SnapshotGqlPermission | undefined} newGqlPerm - Current GQL permission
 * @returns {void}
 */
function comparePermissions(
  ctx: DiffContext,
  tableName: string,
  oldRecordPerm: SnapshotRecordPermission | undefined,
  newRecordPerm: SnapshotRecordPermission | undefined,
  oldGqlPerm: SnapshotGqlPermission | undefined,
  newGqlPerm: SnapshotGqlPermission | undefined,
): void {
  // Compare record permissions
  const oldComparableRecordPerm = comparableRecordPermission(oldRecordPerm);
  const newComparableRecordPerm = comparableRecordPermission(newRecordPerm);
  const oldRecordStr = JSON.stringify(oldComparableRecordPerm ?? null);
  const newRecordStr = JSON.stringify(newComparableRecordPerm ?? null);
  const recordPermChanged = oldRecordStr !== newRecordStr;

  // Compare GQL permissions
  const oldComparableGqlPerm = comparableGqlPermission(oldGqlPerm);
  const newComparableGqlPerm = comparableGqlPermission(newGqlPerm);
  const oldGqlStr = JSON.stringify(oldComparableGqlPerm ?? null);
  const newGqlStr = JSON.stringify(newComparableGqlPerm ?? null);
  const gqlPermChanged = oldGqlStr !== newGqlStr;

  if (recordPermChanged || gqlPermChanged) {
    const reasons: string[] = [];
    if (recordPermChanged) reasons.push("record permission");
    if (gqlPermChanged) reasons.push("GQL permission");

    ctx.changes.push({
      kind: "permission_modified",
      tableName,
      reason: `${reasons.join(" and ")} changed`,
      before: { recordPermission: oldComparableRecordPerm, gqlPermission: oldComparableGqlPerm },
      after: { recordPermission: newComparableRecordPerm, gqlPermission: newComparableGqlPerm },
    });
  }
}

const GQL_ACTION_ORDER: Record<SnapshotGqlAction, number> = {
  all: 0,
  create: 1,
  read: 2,
  update: 3,
  delete: 4,
  aggregate: 5,
  bulkUpsert: 6,
};

// Policies and conditions combine as an order-independent set on the platform,
// so canonicalize their order before comparison to avoid false drift when the
// remote returns them in a different order than the local snapshot declares.
function sortByJson<T>(items: readonly T[]): T[] {
  return items
    .map((item) => [JSON.stringify(item), item] as const)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, item]) => item);
}

function comparableGqlPermission(
  permission: SnapshotGqlPermission | undefined,
): SnapshotGqlPermission | undefined {
  const policies = permission?.map((policy) => ({
    ...policy,
    conditions: sortByJson(policy.conditions),
    actions: policy.actions.toSorted(
      (left, right) => GQL_ACTION_ORDER[left] - GQL_ACTION_ORDER[right],
    ),
  }));
  return policies && policies.length > 0 ? sortByJson(policies) : undefined;
}

function comparableRecordPermission(
  permission: SnapshotRecordPermission | undefined,
): SnapshotRecordPermission | undefined {
  if (!permission) return undefined;
  if (!Object.values(permission).some((policies) => policies.length > 0)) return undefined;

  const canonical: SnapshotRecordPermission = {
    create: sortByJson(permission.create.map(canonicalActionPermission)),
    read: sortByJson(permission.read.map(canonicalActionPermission)),
    update: sortByJson(permission.update.map(canonicalActionPermission)),
    delete: sortByJson(permission.delete.map(canonicalActionPermission)),
  };
  return canonical;
}

function canonicalActionPermission(policy: SnapshotActionPermission): SnapshotActionPermission {
  return { ...policy, conditions: sortByJson(policy.conditions) };
}

function normalizeComparableGqlOperations(
  operations: SnapshotGqlOperations | undefined,
): SnapshotGqlOperations | undefined {
  if (!operations) return undefined;

  return {
    create: operations.create ?? true,
    update: operations.update ?? true,
    delete: operations.delete ?? true,
    read: operations.read ?? true,
  };
}

function normalizeComparableSettings(
  settings: TailorDBSnapshotType["settings"],
): TailorDBSnapshotType["settings"] | undefined {
  const normalized: SnapshotSettings = {};

  if (settings?.aggregation === true) normalized.aggregation = true;
  if (settings?.bulkUpsert === true) normalized.bulkUpsert = true;
  if (settings?.publishEvents === true) normalized.publishEvents = true;

  const gqlOperations = normalizeComparableGqlOperations(settings?.gqlOperations);
  if (gqlOperations) normalized.gqlOperations = gqlOperations;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function typeSettingsState(
  description: string | undefined,
  pluralForm: string,
  settings: TailorDBSnapshotType["settings"],
): SnapshotTypeSettingsState {
  return {
    ...(description ? { description } : {}),
    pluralForm,
    ...(settings && { settings }),
  };
}

function comparableTypeSettings(type: TailorDBSnapshotType): SnapshotTypeSettingsState {
  return typeSettingsState(
    type.description,
    inflection.camelize(type.pluralForm, true),
    normalizeComparableSettings(type.settings),
  );
}

function snapshotTypeSettingsState(type: TailorDBSnapshotType): SnapshotTypeSettingsState {
  return typeSettingsState(type.description, type.pluralForm, type.settings ?? {});
}

function compareTypeSettings(
  ctx: DiffContext,
  tableName: string,
  previous: TailorDBSnapshotType,
  current: TailorDBSnapshotType,
): void {
  const previousComparable = comparableTypeSettings(previous);
  const currentComparable = comparableTypeSettings(current);

  if (JSON.stringify(previousComparable) === JSON.stringify(currentComparable)) return;

  ctx.changes.push({
    kind: "table_settings_modified",
    tableName,
    reason: "settings changed",
    before: snapshotTypeSettingsState(previous),
    after: snapshotTypeSettingsState(current),
  });
}

function typeScriptsState(type: TailorDBSnapshotType): TypeScriptsState {
  return {
    ...(type.typeHookExpr && { typeHookExpr: type.typeHookExpr }),
    ...(type.typeValidateExpr !== undefined && { typeValidateExpr: type.typeValidateExpr }),
  };
}

function compareTypeScripts(
  ctx: DiffContext,
  tableName: string,
  previous: TailorDBSnapshotType,
  current: TailorDBSnapshotType,
): void {
  const prevState = typeScriptsState(previous);
  const currState = typeScriptsState(current);

  if (JSON.stringify(prevState) === JSON.stringify(currState)) return;

  ctx.changes.push({
    kind: "table_scripts_modified",
    tableName,
    reason: "table-level scripts changed",
    before: prevState,
    after: currState,
  });
}

/**
 * Restate the schema an expand migration starts from, with each converted field
 * relaxed to optional.
 *
 * The expand script clears the original field once it has carried the value
 * across. That write reaches the field under the contract recorded on the
 * removal, which the deploy restores for the duration of the migration, so a
 * field left required would reject it.
 * @param previous - Snapshot the expand migration starts from
 * @param plans - Field changes carried through temporary fields
 * @returns Snapshot to compare the expand migration against
 */
function buildExpandBaseSnapshot(
  previous: NormalizedSchemaSnapshot,
  plans: readonly ExpandContractPlan[],
): NormalizedSchemaSnapshot {
  const tables = copySnapshotRecord(previous.tables);
  for (const plan of plans) {
    const type = tables[plan.tableName];
    const original = type?.fields[plan.fieldName];
    if (!type || !original) continue;
    const fields = copySnapshotRecord(type.fields);
    fields[plan.fieldName] = { ...original, required: false };
    tables[plan.tableName] = { ...type, fields };
  }
  return normalizeSchemaSnapshot({ ...previous, tables });
}

/**
 * Build the diff for the migration that converts values into temporary fields.
 *
 * Adding an optional field and removing one are both non-breaking, so nothing
 * in the comparison marks the script as required — yet it is the only thing
 * carrying the values across before the original field is dropped.
 * @param previous - Snapshot the expand migration starts from
 * @param intermediate - Snapshot the expand migration produces
 * @param plans - Field changes carried through temporary fields
 * @returns Diff to write for the expand migration
 */
export function buildExpandDiff(
  previous: NormalizedSchemaSnapshot,
  intermediate: NormalizedSchemaSnapshot,
  plans: readonly ExpandContractPlan[],
): MigrationDiff {
  const diff = compareSnapshots(buildExpandBaseSnapshot(previous, plans), intermediate);
  return { ...diff, requiresMigrationScript: true };
}

/**
 * Build the schema state that sits between an expand and a contract migration:
 * each converted field is replaced by its temporary counterpart.
 *
 * The original field is dropped here rather than in the contract migration so
 * the contract can reuse its name. It stays readable while the expand script
 * runs, because a field removed by a migration is retained until that same
 * migration's post phase.
 *
 * The temporary field is optional and non-unique regardless of its final
 * contract, since the expand script fills it in batches.
 * @param previous - Snapshot the expand migration starts from
 * @param plans - Field changes carried through temporary fields
 * @returns Snapshot the contract migration compares against
 */
export function buildIntermediateSnapshot(
  previous: NormalizedSchemaSnapshot,
  plans: readonly ExpandContractPlan[],
): NormalizedSchemaSnapshot {
  const tables = copySnapshotRecord(previous.tables);
  for (const plan of plans) {
    const type = tables[plan.tableName];
    if (!type) continue;
    const fields = copySnapshotRecord(type.fields);
    // Hooks and validation stay off the temporary field: the rename re-applies
    // the real contract, and a non-idempotent update hook would otherwise run
    // once on the conversion and again on the copy.
    const { hooks: _hooks, validate: _validate, ...carried } = plan.after;
    fields[plan.tempFieldName] = { ...carried, required: false, unique: false };
    delete fields[plan.fieldName];
    tables[plan.tableName] = { ...type, fields };
  }
  return normalizeSchemaSnapshot({ ...previous, tables });
}

/**
 * Options for {@link compareSnapshots}.
 */
export interface CompareSnapshotsOptions {
  /**
   * Confirmed field renames. Each spec replaces the corresponding
   * `field_removed` + `field_added` pair with a single breaking
   * `field_renamed` change. Specs are validated against both snapshots.
   */
  fieldRenames?: readonly FieldRenameSpec[];
  /**
   * Confirmed table renames. Each spec replaces the corresponding
   * `table_removed` + `table_added` pair with a single breaking
   * `table_renamed` change. Specs are validated against both snapshots.
   */
  typeRenames?: readonly TypeRenameSpec[];
}

/**
 * Compare two normalized snapshots and generate a diff
 * @param {NormalizedSchemaSnapshot} previous - Previous normalized snapshot
 * @param {NormalizedSchemaSnapshot} current - Current normalized snapshot
 * @param {CompareSnapshotsOptions} [options] - Comparison options
 * @returns {MigrationDiff} Migration diff between snapshots
 */
export function compareSnapshots(
  previous: NormalizedSchemaSnapshot,
  current: NormalizedSchemaSnapshot,
  options?: CompareSnapshotsOptions,
): MigrationDiff {
  const fieldRenames = options?.fieldRenames ?? [];
  assertValidFieldRenames(previous, current, fieldRenames);
  const renamesByType = new Map<string, FieldRenameSpec[]>();
  for (const rename of fieldRenames) {
    const list = renamesByType.get(rename.tableName) ?? [];
    list.push(rename);
    renamesByType.set(rename.tableName, list);
  }
  const typeRenames = options?.typeRenames ?? [];
  assertValidTypeRenames(previous, current, typeRenames);
  const typeRenameTargets = new Map(typeRenames.map((r) => [r.previousTableName, r.tableName]));
  const renamedToTypeNames = new Set(typeRenames.map((r) => r.tableName));

  const ctx: DiffContext = {
    changes: [],
    breakingChanges: [],
    warnings: [],
    typeRenameTargets,
  };

  const previousTypeNames = new Set(Object.keys(previous.tables));
  const currentTypeNames = new Set(Object.keys(current.tables));

  // Record confirmed table renames
  for (const rename of typeRenames) {
    const prevType = assertDefined(
      previous.tables[rename.previousTableName],
      `renamed table "${rename.previousTableName}" missing from previous snapshot`,
    );
    const currType = assertDefined(
      current.tables[rename.tableName],
      `renamed table "${rename.tableName}" missing from current snapshot`,
    );
    ctx.changes.push({
      kind: "table_renamed",
      tableName: rename.tableName,
      previousTableName: rename.previousTableName,
      before: prevType,
      after: currType,
    });
    ctx.breakingChanges.push({
      tableName: rename.tableName,
      reason: `Table renamed from ${rename.previousTableName} to ${rename.tableName} (existing records must be copied by the migration script)`,
    });
    ctx.breakingChanges.push({
      tableName: rename.tableName,
      reason:
        `GraphQL API names derived from ${rename.previousTableName}/${prevType.pluralForm} change to ` +
        `${rename.tableName}/${currType.pluralForm} — breaking for API clients`,
    });
  }

  // Check for added tables
  for (const [tableName, type] of Object.entries(current.tables)) {
    if (renamedToTypeNames.has(tableName)) continue;
    if (!previousTypeNames.has(tableName)) {
      ctx.changes.push({
        kind: "table_added",
        tableName,
        after: type,
      });
    }
  }

  // Check for removed tables
  for (const [tableName, type] of Object.entries(previous.tables)) {
    if (typeRenameTargets.has(tableName)) continue;
    if (!currentTypeNames.has(tableName)) {
      ctx.changes.push({
        kind: "table_removed",
        tableName,
        before: type,
      });
      ctx.warnings.push({
        tableName,
        reason: TABLE_REMOVED_WARNING_REASON,
      });
    }
  }

  // Check for modified tables
  for (const tableName of currentTypeNames) {
    if (!previousTypeNames.has(tableName)) continue;

    const prevType = assertDefined(
      previous.tables[tableName],
      `table "${tableName}" missing from previous snapshot`,
    );
    const currType = assertDefined(
      current.tables[tableName],
      `table "${tableName}" missing from current snapshot`,
    );

    // Compare table-level settings and metadata
    compareTypeSettings(ctx, tableName, prevType, currType);

    // Compare table-level hook/validate scripts
    compareTypeScripts(ctx, tableName, prevType, currType);

    // Compare fields
    compareTypeFields(ctx, tableName, prevType, currType, renamesByType.get(tableName));

    // Compare indexes
    compareIndexes(ctx, tableName, prevType.indexes, currType.indexes);

    // Compare file fields
    compareFiles(ctx, tableName, prevType.files, currType.files);

    // Compare relationships
    compareRelationships(
      ctx,
      tableName,
      "forward",
      prevType.forwardRelationships,
      currType.forwardRelationships,
    );
    compareRelationships(
      ctx,
      tableName,
      "backward",
      prevType.backwardRelationships,
      currType.backwardRelationships,
    );

    // Compare permissions
    comparePermissions(
      ctx,
      tableName,
      prevType.permissions?.record,
      currType.permissions?.record,
      prevType.permissions?.gql,
      currType.permissions?.gql,
    );
  }

  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace: current.namespace,
    createdAt: new Date().toISOString(),
    changes: ctx.changes,
    hasBreakingChanges: ctx.breakingChanges.length > 0,
    breakingChanges: ctx.breakingChanges,
    hasWarnings: ctx.warnings.length > 0,
    warnings: ctx.warnings,
    requiresMigrationScript: ctx.breakingChanges.length > 0,
  };
}

/**
 * Compare a snapshot against canonical TailorDBSnapshotType-shaped local tables.
 * Callers are expected to pre-convert TailorDBService.types to TailorDBSnapshotType via
 * `createSnapshotType`. As a safety net, both sides are re-run through idempotent
 * normalization here, so a caller that forgets will still get correct
 * comparisons (no silent false drift).
 * @param {SchemaSnapshot} snapshot - Schema snapshot to compare against
 * @param {Record<string, TailorDBSnapshotType>} localTypes - Local snapshot-shaped tables
 * @param {string} namespace - Namespace for comparison
 * @returns {MigrationDiff} Migration diff
 */
export function compareLocalTypesWithSnapshot(
  snapshot: SchemaSnapshot,
  localTypes: Record<string, TailorDBSnapshotType>,
  namespace: string,
): MigrationDiff {
  const currentSnapshot: SchemaSnapshot = {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace,
    createdAt: new Date().toISOString(),
    tables: localTypes,
  };
  return compareSnapshots(
    normalizeSchemaSnapshot(snapshot),
    normalizeSchemaSnapshot(currentSnapshot),
  );
}
