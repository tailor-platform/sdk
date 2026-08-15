/**
 * Valibot schemas for TailorDB migration snapshot and diff files.
 *
 * Each schema mirrors the corresponding hand-written interface from
 * snapshot-types.ts / diff-calculator.ts. Schemas are cast to
 * `v.GenericSchema<T>` to keep them aligned with the interfaces at compile time.
 *
 * All object schemas use `v.looseObject` so that unknown keys written
 * by newer CLI versions survive a load → save round-trip.
 */

import * as v from "valibot";
import { MIGRATION_HISTORY_ID_PATTERN } from "./types";
import type {
  TypeSettingsPatch,
  SnapshotPermissionState,
  TableAddedChange,
  TableRemovedChange,
  TableRenamedChange,
  TableModifiedChange,
  TableSettingsModifiedChange,
  SnapshotTypeSettingsState,
  FieldAddedChange,
  FieldRemovedChange,
  FieldModifiedChange,
  FieldRenamedChange,
  FieldTypeModifiedChange,
  IndexAddedChange,
  IndexRemovedChange,
  IndexModifiedChange,
  FileAddedChange,
  FileRemovedChange,
  FileModifiedChange,
  RelationshipAddedChange,
  RelationshipRemovedChange,
  RelationshipModifiedChange,
  PermissionModifiedChange,
  TableScriptsModifiedChange,
  TypeScriptsState,
  DiffChange,
  BreakingChangeInfo,
  WarningChangeInfo,
  MigrationDiff,
  ScriptSkippedInfo,
} from "./diff-calculator";
import type {
  SnapshotHook,
  SnapshotValidation,
  SnapshotSerial,
  SnapshotEnumValue,
  SnapshotFieldConfig,
  SnapshotIndexConfig,
  SnapshotRelationship,
  SnapshotActionPermission,
  SnapshotRecordPermission,
  SnapshotGqlPermissionPolicy,
  SnapshotGqlPermission,
  TailorDBSnapshotType,
  SchemaSnapshot,
  RebaselineMarker,
  SnapshotPermissionOperand,
  SnapshotPermissionCondition,
} from "./snapshot-types";

function snapshotRecordSchema<T>(
  valueSchema: v.GenericSchema<T>,
): v.GenericSchema<Record<string, T>> {
  return v.pipe(
    v.custom<Record<string, unknown>>(
      (value) => typeof value === "object" && value !== null && !Array.isArray(value),
      "Expected record",
    ),
    v.rawTransform(({ dataset, addIssue, NEVER }) => {
      const input = dataset.value;
      const record = Object.create(null) as Record<string, T>;
      let hasIssue = false;
      for (const key of Object.keys(input)) {
        const result = v.safeParse(valueSchema, input[key]);
        if (!result.success) {
          hasIssue = true;
          for (const issue of result.issues) {
            addIssue({
              message: issue.message,
              path: [
                { type: "object", origin: "value", input, key, value: input[key] },
                ...(issue.path ?? []),
              ],
            });
          }
          continue;
        }
        record[key] = result.output;
      }
      return hasIssue ? NEVER : record;
    }),
  ) as unknown as v.GenericSchema<Record<string, T>>;
}

// ============================================================================
// Snapshot Leaf Types
// ============================================================================

export const snapshotHookSchema: v.GenericSchema<SnapshotHook> = v.looseObject({
  expr: v.string(),
});

export const snapshotValidationSchema: v.GenericSchema<SnapshotValidation> = v.looseObject({
  script: v.optional(v.looseObject({ expr: v.string() })) as unknown as v.GenericSchema<{
    expr: string;
  }>,
  errorMessage: v.string(),
});

export const snapshotSerialSchema: v.GenericSchema<SnapshotSerial> = v.looseObject({
  start: v.number(),
  maxValue: v.optional(v.number()),
  format: v.optional(v.string()),
});

export const snapshotEnumValueSchema: v.GenericSchema<SnapshotEnumValue> = v.looseObject({
  value: v.string(),
  description: v.optional(v.string()),
});

// SnapshotFieldConfig is self-referential (fields?: Record<string, SnapshotFieldConfig>)
// v.lazy handles the recursion; the outer cast closes the type cycle.
export const snapshotFieldConfigSchema: v.GenericSchema<SnapshotFieldConfig> = v.looseObject({
  type: v.string(),
  // `required` defaults to true to match the pre-validation `?? true` behaviour.
  required: v.optional(v.boolean(), true),
  array: v.optional(v.boolean()),
  index: v.optional(v.boolean()),
  unique: v.optional(v.boolean()),
  allowedValues: v.optional(v.array(snapshotEnumValueSchema)),
  foreignKey: v.optional(v.boolean()),
  foreignKeyType: v.optional(v.string()),
  foreignKeyField: v.optional(v.string()),
  description: v.optional(v.string()),
  vector: v.optional(v.boolean()),
  hooks: v.optional(
    v.looseObject({
      create: v.optional(snapshotHookSchema),
      update: v.optional(snapshotHookSchema),
    }),
  ),
  validate: v.optional(v.array(snapshotValidationSchema)),
  serial: v.optional(snapshotSerialSchema),
  scale: v.optional(v.number()),
  default: v.optional(v.unknown()),
  fields: v.optional(v.lazy(() => snapshotRecordSchema(snapshotFieldConfigSchema))),
}) as unknown as v.GenericSchema<SnapshotFieldConfig>;

export const snapshotIndexConfigSchema: v.GenericSchema<SnapshotIndexConfig> = v.looseObject({
  fields: v.array(v.string()),
  unique: v.optional(v.boolean()),
});

export const snapshotRelationshipSchema: v.GenericSchema<SnapshotRelationship> = v.looseObject({
  targetType: v.string(),
  targetField: v.string(),
  sourceField: v.string(),
  isArray: v.boolean(),
  description: v.string(),
});

// ============================================================================
// Permission Types
// ============================================================================

// Structure validated; vocabulary kept open for platform evolution
const FIELD_REF_KEYS = ["user", "record", "newRecord", "oldRecord"] as const;

// Record-level operand: reject a plain object that contains two or more known
// ref keys — such an object is ambiguous and signals a malformed condition.
const snapshotPermissionOperandSchema = v.pipe(
  v.unknown(),
  v.check((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return true;
    const keys = Object.keys(value as Record<string, unknown>);
    const refKeyCount = FIELD_REF_KEYS.filter((k) => keys.includes(k)).length;
    return refKeyCount < 2;
  }, "Ambiguous field-ref operand: contains more than one of user/record/newRecord/oldRecord"),
) as unknown as v.GenericSchema<SnapshotPermissionOperand>;

// GQL operand: same ambiguity check, plus reject record/newRecord/oldRecord refs.
const snapshotGqlPermissionOperandSchema = v.pipe(
  v.unknown(),
  v.check((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return true;
    const keys = Object.keys(value as Record<string, unknown>);
    const refKeyCount = FIELD_REF_KEYS.filter((k) => keys.includes(k)).length;
    return refKeyCount < 2;
  }, "Ambiguous field-ref operand: contains more than one of user/record/newRecord/oldRecord"),
  v.check((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return true;
    const keys = Object.keys(value as Record<string, unknown>);
    return !["record", "newRecord", "oldRecord"].some((k) => keys.includes(k));
  }, "GQL permissions only support { user } field references"),
) as unknown as v.GenericSchema<SnapshotPermissionOperand>;

// Structure validated; vocabulary kept open for platform evolution
const snapshotPermissionOperatorSchema = v.string();

// SnapshotPermissionCondition is a readonly 3-tuple; extra trailing elements tolerated.
const snapshotPermissionConditionSchema = v.tupleWithRest(
  [
    snapshotPermissionOperandSchema,
    snapshotPermissionOperatorSchema,
    snapshotPermissionOperandSchema,
  ],
  v.unknown(),
) as unknown as v.GenericSchema<SnapshotPermissionCondition>;

const snapshotGqlPermissionConditionSchema = v.tupleWithRest(
  [
    snapshotGqlPermissionOperandSchema,
    snapshotPermissionOperatorSchema,
    snapshotGqlPermissionOperandSchema,
  ],
  v.unknown(),
) as unknown as v.GenericSchema<SnapshotPermissionCondition>;

export const snapshotActionPermissionSchema: v.GenericSchema<SnapshotActionPermission> =
  v.looseObject({
    conditions: v.array(snapshotPermissionConditionSchema),
    description: v.optional(v.string()),
    permit: v.picklist(["allow", "deny"]),
  });

export const snapshotRecordPermissionSchema = v.looseObject({
  create: v.optional(v.array(snapshotActionPermissionSchema), []),
  read: v.optional(v.array(snapshotActionPermissionSchema), []),
  update: v.optional(v.array(snapshotActionPermissionSchema), []),
  delete: v.optional(v.array(snapshotActionPermissionSchema), []),
}) as unknown as v.GenericSchema<SnapshotRecordPermission>;

// Structure validated; vocabulary kept open for platform evolution
const snapshotGqlActionSchema = v.string();

export const snapshotGqlPermissionPolicySchema: v.GenericSchema<SnapshotGqlPermissionPolicy> =
  v.looseObject({
    conditions: v.array(snapshotGqlPermissionConditionSchema),
    actions: v.array(snapshotGqlActionSchema),
    permit: v.picklist(["allow", "deny"]),
    description: v.optional(v.string()),
  }) as unknown as v.GenericSchema<SnapshotGqlPermissionPolicy>;

// SnapshotGqlPermission = readonly SnapshotGqlPermissionPolicy[]
const snapshotGqlPermissionSchema: v.GenericSchema<SnapshotGqlPermission> = v.array(
  snapshotGqlPermissionPolicySchema,
);

// ============================================================================
// TailorDBSnapshotType
// ============================================================================

export const tailorDBSnapshotTypeSchema: v.GenericSchema<TailorDBSnapshotType> = v.looseObject({
  name: v.string(),
  // `pluralForm` is typed as required but legacy snapshots may omit it;
  // loadSnapshot backfills it via inflection so we accept undefined here.
  pluralForm: v.optional(v.string()) as unknown as v.GenericSchema<string>,
  description: v.optional(v.string()),
  fields: snapshotRecordSchema(snapshotFieldConfigSchema),
  settings: v.optional(
    v.looseObject({
      aggregation: v.optional(v.boolean()),
      bulkUpsert: v.optional(v.boolean()),
      gqlOperations: v.optional(
        v.looseObject({
          create: v.optional(v.boolean()),
          update: v.optional(v.boolean()),
          delete: v.optional(v.boolean()),
          read: v.optional(v.boolean()),
        }),
      ),
      publishEvents: v.optional(v.boolean()),
    }),
  ),
  indexes: v.optional(snapshotRecordSchema(snapshotIndexConfigSchema)),
  files: v.optional(snapshotRecordSchema(v.string())),
  forwardRelationships: v.optional(snapshotRecordSchema(snapshotRelationshipSchema)),
  backwardRelationships: v.optional(snapshotRecordSchema(snapshotRelationshipSchema)),
  permissions: v.optional(
    v.looseObject({
      record: v.optional(snapshotRecordPermissionSchema),
      gql: v.optional(snapshotGqlPermissionSchema),
    }),
  ),
});

// ============================================================================
// SchemaSnapshot
// ============================================================================

const rebaselineMarkerSchema: v.GenericSchema<RebaselineMarker> = v.looseObject({
  historyId: v.pipe(v.string(), v.regex(MIGRATION_HISTORY_ID_PATTERN)),
  replacedHistoryId: v.nullable(v.pipe(v.string(), v.regex(MIGRATION_HISTORY_ID_PATTERN))),
  replacedLatestMigration: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(9999)),
});

export const schemaSnapshotSchema: v.GenericSchema<SchemaSnapshot> = v.looseObject({
  version: v.number(),
  namespace: v.string(),
  createdAt: v.string(),
  tables: snapshotRecordSchema(tailorDBSnapshotTypeSchema),
  rebaseline: v.optional(rebaselineMarkerSchema),
});

// ============================================================================
// Diff Types
// ============================================================================

const typeSettingsPatchSchema: v.GenericSchema<TypeSettingsPatch> = v.looseObject({
  indexes: v.optional(snapshotRecordSchema(snapshotIndexConfigSchema)),
  files: v.optional(snapshotRecordSchema(v.string())),
});

const snapshotTypeSettingsStateSchema: v.GenericSchema<SnapshotTypeSettingsState> = v.looseObject({
  description: v.optional(v.string()),
  pluralForm: v.string(),
  settings: v.optional(
    v.looseObject({
      aggregation: v.optional(v.boolean()),
      bulkUpsert: v.optional(v.boolean()),
      gqlOperations: v.optional(
        v.looseObject({
          create: v.optional(v.boolean()),
          update: v.optional(v.boolean()),
          delete: v.optional(v.boolean()),
          read: v.optional(v.boolean()),
        }),
      ),
      publishEvents: v.optional(v.boolean()),
    }),
  ),
});

const snapshotPermissionStateSchema: v.GenericSchema<SnapshotPermissionState> = v.looseObject({
  recordPermission: v.optional(snapshotRecordPermissionSchema),
  gqlPermission: v.optional(snapshotGqlPermissionSchema),
});

// Individual change schemas are typed as v.GenericSchema<T> after the looseObject
// cast so that v.variant can accept them.
const typeAddedChangeSchema = v.looseObject({
  kind: v.literal("table_added"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  after: tailorDBSnapshotTypeSchema,
}) as unknown as v.GenericSchema<TableAddedChange>;

const typeRemovedChangeSchema = v.looseObject({
  kind: v.literal("table_removed"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  before: tailorDBSnapshotTypeSchema,
}) as unknown as v.GenericSchema<TableRemovedChange>;

const typeRenamedChangeSchema = v.looseObject({
  kind: v.literal("table_renamed"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  previousTableName: v.string(),
  before: tailorDBSnapshotTypeSchema,
  after: tailorDBSnapshotTypeSchema,
}) as unknown as v.GenericSchema<TableRenamedChange>;

const typeModifiedChangeSchema = v.looseObject({
  kind: v.literal("table_modified"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  before: v.optional(typeSettingsPatchSchema),
  after: v.optional(typeSettingsPatchSchema),
}) as unknown as v.GenericSchema<TableModifiedChange>;

const typeSettingsModifiedChangeSchema = v.looseObject({
  kind: v.literal("table_settings_modified"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  before: snapshotTypeSettingsStateSchema,
  after: snapshotTypeSettingsStateSchema,
}) as unknown as v.GenericSchema<TableSettingsModifiedChange>;

const fieldAddedChangeSchema = v.looseObject({
  kind: v.literal("field_added"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  fieldName: v.string(),
  after: snapshotFieldConfigSchema,
}) as unknown as v.GenericSchema<FieldAddedChange>;

const fieldRemovedChangeSchema = v.looseObject({
  kind: v.literal("field_removed"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  fieldName: v.string(),
  before: snapshotFieldConfigSchema,
}) as unknown as v.GenericSchema<FieldRemovedChange>;

const fieldModifiedChangeSchema = v.looseObject({
  kind: v.literal("field_modified"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  fieldName: v.string(),
  before: snapshotFieldConfigSchema,
  after: snapshotFieldConfigSchema,
}) as unknown as v.GenericSchema<FieldModifiedChange>;

const fieldRenamedChangeSchema = v.looseObject({
  kind: v.literal("field_renamed"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  fieldName: v.string(),
  previousFieldName: v.string(),
  before: snapshotFieldConfigSchema,
  after: snapshotFieldConfigSchema,
}) as unknown as v.GenericSchema<FieldRenamedChange>;

const fieldTypeModifiedChangeSchema = v.looseObject({
  kind: v.literal("field_type_modified"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  fieldName: v.string(),
  before: snapshotFieldConfigSchema,
  after: snapshotFieldConfigSchema,
}) as unknown as v.GenericSchema<FieldTypeModifiedChange>;

const indexAddedChangeSchema = v.looseObject({
  kind: v.literal("index_added"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  indexName: v.string(),
  after: snapshotIndexConfigSchema,
}) as unknown as v.GenericSchema<IndexAddedChange>;

const indexRemovedChangeSchema = v.looseObject({
  kind: v.literal("index_removed"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  indexName: v.string(),
  before: snapshotIndexConfigSchema,
}) as unknown as v.GenericSchema<IndexRemovedChange>;

const indexModifiedChangeSchema = v.looseObject({
  kind: v.literal("index_modified"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  indexName: v.string(),
  before: snapshotIndexConfigSchema,
  after: snapshotIndexConfigSchema,
}) as unknown as v.GenericSchema<IndexModifiedChange>;

const fileAddedChangeSchema = v.looseObject({
  kind: v.literal("file_added"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  fieldName: v.string(),
  after: v.string(),
}) as unknown as v.GenericSchema<FileAddedChange>;

const fileRemovedChangeSchema = v.looseObject({
  kind: v.literal("file_removed"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  fieldName: v.string(),
  before: v.string(),
}) as unknown as v.GenericSchema<FileRemovedChange>;

const fileModifiedChangeSchema = v.looseObject({
  kind: v.literal("file_modified"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  fieldName: v.string(),
  before: v.string(),
  after: v.string(),
}) as unknown as v.GenericSchema<FileModifiedChange>;

const relationshipAddedChangeSchema = v.looseObject({
  kind: v.literal("relationship_added"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  relationshipName: v.string(),
  relationshipType: v.optional(v.picklist(["forward", "backward"])),
  after: snapshotRelationshipSchema,
}) as unknown as v.GenericSchema<RelationshipAddedChange>;

const relationshipRemovedChangeSchema = v.looseObject({
  kind: v.literal("relationship_removed"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  relationshipName: v.string(),
  relationshipType: v.optional(v.picklist(["forward", "backward"])),
  before: snapshotRelationshipSchema,
}) as unknown as v.GenericSchema<RelationshipRemovedChange>;

const relationshipModifiedChangeSchema = v.looseObject({
  kind: v.literal("relationship_modified"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  relationshipName: v.string(),
  relationshipType: v.optional(v.picklist(["forward", "backward"])),
  before: snapshotRelationshipSchema,
  after: snapshotRelationshipSchema,
}) as unknown as v.GenericSchema<RelationshipModifiedChange>;

const permissionModifiedChangeSchema = v.looseObject({
  kind: v.literal("permission_modified"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  before: v.optional(snapshotPermissionStateSchema),
  after: v.optional(snapshotPermissionStateSchema),
}) as unknown as v.GenericSchema<PermissionModifiedChange>;

const typeScriptsStateSchema: v.GenericSchema<TypeScriptsState> = v.looseObject({
  typeHookExpr: v.optional(
    v.looseObject({
      create: v.optional(v.string()),
      update: v.optional(v.string()),
    }),
  ),
  typeValidateExpr: v.optional(v.string()),
});

const typeScriptsModifiedChangeSchema = v.looseObject({
  kind: v.literal("table_scripts_modified"),
  tableName: v.string(),
  reason: v.optional(v.string()),
  before: typeScriptsStateSchema,
  after: typeScriptsStateSchema,
}) as unknown as v.GenericSchema<TableScriptsModifiedChange>;

type DiscriminableSchema = v.VariantOptions<"kind">[number];

export const diffChangeSchema: v.GenericSchema<DiffChange> = v.variant("kind", [
  typeAddedChangeSchema as unknown as DiscriminableSchema,
  typeRemovedChangeSchema as unknown as DiscriminableSchema,
  typeRenamedChangeSchema as unknown as DiscriminableSchema,
  typeModifiedChangeSchema as unknown as DiscriminableSchema,
  typeSettingsModifiedChangeSchema as unknown as DiscriminableSchema,
  fieldAddedChangeSchema as unknown as DiscriminableSchema,
  fieldRemovedChangeSchema as unknown as DiscriminableSchema,
  fieldModifiedChangeSchema as unknown as DiscriminableSchema,
  fieldRenamedChangeSchema as unknown as DiscriminableSchema,
  fieldTypeModifiedChangeSchema as unknown as DiscriminableSchema,
  indexAddedChangeSchema as unknown as DiscriminableSchema,
  indexRemovedChangeSchema as unknown as DiscriminableSchema,
  indexModifiedChangeSchema as unknown as DiscriminableSchema,
  fileAddedChangeSchema as unknown as DiscriminableSchema,
  fileRemovedChangeSchema as unknown as DiscriminableSchema,
  fileModifiedChangeSchema as unknown as DiscriminableSchema,
  relationshipAddedChangeSchema as unknown as DiscriminableSchema,
  relationshipRemovedChangeSchema as unknown as DiscriminableSchema,
  relationshipModifiedChangeSchema as unknown as DiscriminableSchema,
  permissionModifiedChangeSchema as unknown as DiscriminableSchema,
  typeScriptsModifiedChangeSchema as unknown as DiscriminableSchema,
]) as unknown as v.GenericSchema<DiffChange>;

export const breakingChangeInfoSchema: v.GenericSchema<BreakingChangeInfo> = v.looseObject({
  tableName: v.string(),
  fieldName: v.optional(v.string()),
  reason: v.string(),
  unsupported: v.optional(v.boolean()),
  showThreeStepHint: v.optional(v.boolean()),
});

export const warningChangeInfoSchema: v.GenericSchema<WarningChangeInfo> = v.looseObject({
  tableName: v.string(),
  fieldName: v.optional(v.string()),
  reason: v.string(),
});

export const scriptSkippedInfoSchema: v.GenericSchema<ScriptSkippedInfo> = v.looseObject({
  reason: v.pipe(v.string(), v.trim(), v.minLength(1)),
  acknowledgedAt: v.string(),
});

// MigrationDiff: `warnings` and `hasWarnings` are optional here so that
// older diff.json files that predate these fields still validate cleanly.
// loadDiff backfills both from the warnings array after validation.
export const migrationDiffSchema: v.GenericSchema<MigrationDiff> = v.looseObject({
  version: v.number(),
  namespace: v.string(),
  createdAt: v.string(),
  description: v.optional(v.string()),
  changes: v.array(diffChangeSchema),
  hasBreakingChanges: v.boolean(),
  breakingChanges: v.array(breakingChangeInfoSchema),
  // Optional for backward compat: loadDiff backfills these after validation.
  hasWarnings: v.optional(v.boolean()) as unknown as v.GenericSchema<boolean>,
  warnings: v.optional(v.array(warningChangeInfoSchema)) as unknown as v.GenericSchema<
    WarningChangeInfo[]
  >,
  requiresMigrationScript: v.boolean(),
  scriptSkipped: v.optional(scriptSkippedInfoSchema),
});
