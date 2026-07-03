/**
 * Zod schemas for TailorDB migration snapshot and diff files.
 *
 * Each schema mirrors the corresponding hand-written interface from
 * snapshot-types.ts / diff-calculator.ts. Schemas are cast to
 * `z.ZodType<T>` to keep them aligned with the interfaces at compile time.
 *
 * All object schemas use `z.looseObject` so that unknown keys written
 * by newer CLI versions survive a load → save round-trip.
 */

import { z } from "zod";
import type {
  TypeSettingsPatch,
  SnapshotPermissionState,
  TypeAddedChange,
  TypeRemovedChange,
  TypeModifiedChange,
  TypeSettingsModifiedChange,
  SnapshotTypeSettingsState,
  FieldAddedChange,
  FieldRemovedChange,
  FieldModifiedChange,
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
  DiffChange,
  BreakingChangeInfo,
  WarningChangeInfo,
  MigrationDiff,
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
  SnapshotPermissionOperand,
  SnapshotPermissionCondition,
} from "./snapshot-types";

function snapshotRecordSchema<T>(valueSchema: z.ZodType<T>): z.ZodType<Record<string, T>> {
  return z
    .custom<Record<string, unknown>>(
      (value) => typeof value === "object" && value !== null && !Array.isArray(value),
      { message: "Expected record" },
    )
    .transform((value, ctx) => {
      const record = Object.create(null) as Record<string, T>;
      for (const key of Object.keys(value)) {
        const result = valueSchema.safeParse(value[key]);
        if (!result.success) {
          for (const issue of result.error.issues) {
            ctx.addIssue({ ...issue, path: [key, ...issue.path] });
          }
          continue;
        }
        record[key] = result.data;
      }
      return record;
    }) as z.ZodType<Record<string, T>>;
}

// ============================================================================
// Snapshot Leaf Types
// ============================================================================

export const snapshotHookSchema: z.ZodType<SnapshotHook> = z.looseObject({
  expr: z.string(),
});

export const snapshotValidationSchema: z.ZodType<SnapshotValidation> = z.looseObject({
  script: z.looseObject({ expr: z.string() }).optional() as z.ZodType<{ expr: string }>,
  errorMessage: z.string(),
});

export const snapshotSerialSchema: z.ZodType<SnapshotSerial> = z.looseObject({
  start: z.number(),
  maxValue: z.number().optional(),
  format: z.string().optional(),
});

export const snapshotEnumValueSchema: z.ZodType<SnapshotEnumValue> = z.looseObject({
  value: z.string(),
  description: z.string().optional(),
});

// SnapshotFieldConfig is self-referential (fields?: Record<string, SnapshotFieldConfig>)
// z.lazy handles the recursion; the outer cast closes the type cycle.
export const snapshotFieldConfigSchema: z.ZodType<SnapshotFieldConfig> = z.looseObject({
  type: z.string(),
  // `required` defaults to true to match the pre-validation `?? true` behaviour.
  required: z.boolean().default(true),
  array: z.boolean().optional(),
  index: z.boolean().optional(),
  unique: z.boolean().optional(),
  allowedValues: z.array(snapshotEnumValueSchema).optional(),
  foreignKey: z.boolean().optional(),
  foreignKeyType: z.string().optional(),
  foreignKeyField: z.string().optional(),
  description: z.string().optional(),
  vector: z.boolean().optional(),
  hooks: z
    .looseObject({
      create: snapshotHookSchema.optional(),
      update: snapshotHookSchema.optional(),
    })
    .optional(),
  validate: z.array(snapshotValidationSchema).optional(),
  serial: snapshotSerialSchema.optional(),
  scale: z.number().optional(),
  fields: z.lazy(() => snapshotRecordSchema(snapshotFieldConfigSchema)).optional(),
}) as z.ZodType<SnapshotFieldConfig>;

export const snapshotIndexConfigSchema: z.ZodType<SnapshotIndexConfig> = z.looseObject({
  fields: z.array(z.string()),
  unique: z.boolean().optional(),
});

export const snapshotRelationshipSchema: z.ZodType<SnapshotRelationship> = z.looseObject({
  targetType: z.string(),
  targetField: z.string(),
  sourceField: z.string(),
  isArray: z.boolean(),
  description: z.string(),
});

// ============================================================================
// Permission Types
// ============================================================================

// Structure validated; vocabulary kept open for platform evolution
const FIELD_REF_KEYS = ["user", "record", "newRecord", "oldRecord"] as const;

// Record-level operand: reject a plain object that contains two or more known
// ref keys — such an object is ambiguous and signals a malformed condition.
const snapshotPermissionOperandSchema = z.unknown().refine((v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return true;
  const keys = Object.keys(v as Record<string, unknown>);
  const refKeyCount = FIELD_REF_KEYS.filter((k) => keys.includes(k)).length;
  return refKeyCount < 2;
}, "Ambiguous field-ref operand: contains more than one of user/record/newRecord/oldRecord") as unknown as z.ZodType<SnapshotPermissionOperand>;

// GQL operand: same ambiguity check, plus reject record/newRecord/oldRecord refs.
const snapshotGqlPermissionOperandSchema = z
  .unknown()
  .refine((v) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return true;
    const keys = Object.keys(v as Record<string, unknown>);
    const refKeyCount = FIELD_REF_KEYS.filter((k) => keys.includes(k)).length;
    return refKeyCount < 2;
  }, "Ambiguous field-ref operand: contains more than one of user/record/newRecord/oldRecord")
  .refine((v) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return true;
    const keys = Object.keys(v as Record<string, unknown>);
    return !["record", "newRecord", "oldRecord"].some((k) => keys.includes(k));
  }, "GQL permissions only support { user } field references") as unknown as z.ZodType<SnapshotPermissionOperand>;

// Structure validated; vocabulary kept open for platform evolution
const snapshotPermissionOperatorSchema = z.string();

// SnapshotPermissionCondition is a readonly 3-tuple; extra trailing elements tolerated.
const snapshotPermissionConditionSchema = z
  .tuple([
    snapshotPermissionOperandSchema,
    snapshotPermissionOperatorSchema,
    snapshotPermissionOperandSchema,
  ])
  .rest(z.unknown()) as unknown as z.ZodType<SnapshotPermissionCondition>;

const snapshotGqlPermissionConditionSchema = z
  .tuple([
    snapshotGqlPermissionOperandSchema,
    snapshotPermissionOperatorSchema,
    snapshotGqlPermissionOperandSchema,
  ])
  .rest(z.unknown()) as unknown as z.ZodType<SnapshotPermissionCondition>;

export const snapshotActionPermissionSchema: z.ZodType<SnapshotActionPermission> = z.looseObject({
  conditions: z.array(snapshotPermissionConditionSchema),
  description: z.string().optional(),
  permit: z.enum(["allow", "deny"]),
});

export const snapshotRecordPermissionSchema: z.ZodType<SnapshotRecordPermission> = z.looseObject({
  create: z.array(snapshotActionPermissionSchema).default([]),
  read: z.array(snapshotActionPermissionSchema).default([]),
  update: z.array(snapshotActionPermissionSchema).default([]),
  delete: z.array(snapshotActionPermissionSchema).default([]),
});

// Structure validated; vocabulary kept open for platform evolution
const snapshotGqlActionSchema = z.string();

export const snapshotGqlPermissionPolicySchema: z.ZodType<SnapshotGqlPermissionPolicy> =
  z.looseObject({
    conditions: z.array(snapshotGqlPermissionConditionSchema),
    actions: z.array(snapshotGqlActionSchema),
    permit: z.enum(["allow", "deny"]),
    description: z.string().optional(),
  }) as unknown as z.ZodType<SnapshotGqlPermissionPolicy>;

// SnapshotGqlPermission = readonly SnapshotGqlPermissionPolicy[]
const snapshotGqlPermissionSchema: z.ZodType<SnapshotGqlPermission> = z.array(
  snapshotGqlPermissionPolicySchema,
);

// ============================================================================
// TailorDBSnapshotType
// ============================================================================

export const tailorDBSnapshotTypeSchema: z.ZodType<TailorDBSnapshotType> = z.looseObject({
  name: z.string(),
  // `pluralForm` is typed as required but legacy snapshots may omit it;
  // loadSnapshot backfills it via inflection so we accept undefined here.
  pluralForm: z.string().optional() as z.ZodType<string>,
  description: z.string().optional(),
  fields: snapshotRecordSchema(snapshotFieldConfigSchema),
  settings: z
    .looseObject({
      aggregation: z.boolean().optional(),
      bulkUpsert: z.boolean().optional(),
      gqlOperations: z
        .looseObject({
          create: z.boolean().optional(),
          update: z.boolean().optional(),
          delete: z.boolean().optional(),
          read: z.boolean().optional(),
        })
        .optional(),
      publishEvents: z.boolean().optional(),
    })
    .optional(),
  indexes: snapshotRecordSchema(snapshotIndexConfigSchema).optional(),
  files: snapshotRecordSchema(z.string()).optional(),
  forwardRelationships: snapshotRecordSchema(snapshotRelationshipSchema).optional(),
  backwardRelationships: snapshotRecordSchema(snapshotRelationshipSchema).optional(),
  permissions: z
    .looseObject({
      record: snapshotRecordPermissionSchema.optional(),
      gql: snapshotGqlPermissionSchema.optional(),
    })
    .optional(),
});

// ============================================================================
// SchemaSnapshot
// ============================================================================

export const schemaSnapshotSchema: z.ZodType<SchemaSnapshot> = z.looseObject({
  version: z.number(),
  namespace: z.string(),
  createdAt: z.string(),
  types: snapshotRecordSchema(tailorDBSnapshotTypeSchema),
});

// ============================================================================
// Diff Types
// ============================================================================

const typeSettingsPatchSchema: z.ZodType<TypeSettingsPatch> = z.looseObject({
  indexes: snapshotRecordSchema(snapshotIndexConfigSchema).optional(),
  files: snapshotRecordSchema(z.string()).optional(),
});

const snapshotTypeSettingsStateSchema: z.ZodType<SnapshotTypeSettingsState> = z.looseObject({
  description: z.string().optional(),
  pluralForm: z.string(),
  settings: z
    .looseObject({
      aggregation: z.boolean().optional(),
      bulkUpsert: z.boolean().optional(),
      gqlOperations: z
        .looseObject({
          create: z.boolean().optional(),
          update: z.boolean().optional(),
          delete: z.boolean().optional(),
          read: z.boolean().optional(),
        })
        .optional(),
      publishEvents: z.boolean().optional(),
    })
    .optional(),
});

const snapshotPermissionStateSchema: z.ZodType<SnapshotPermissionState> = z.looseObject({
  recordPermission: snapshotRecordPermissionSchema.optional(),
  gqlPermission: snapshotGqlPermissionSchema.optional(),
});

// Individual change schemas are typed as z.ZodType<T> after the looseObject
// cast so that z.discriminatedUnion can accept them.
const typeAddedChangeSchema = z.looseObject({
  kind: z.literal("type_added"),
  typeName: z.string(),
  reason: z.string().optional(),
  after: tailorDBSnapshotTypeSchema,
}) as unknown as z.ZodType<TypeAddedChange>;

const typeRemovedChangeSchema = z.looseObject({
  kind: z.literal("type_removed"),
  typeName: z.string(),
  reason: z.string().optional(),
  before: tailorDBSnapshotTypeSchema,
}) as unknown as z.ZodType<TypeRemovedChange>;

const typeModifiedChangeSchema = z.looseObject({
  kind: z.literal("type_modified"),
  typeName: z.string(),
  reason: z.string().optional(),
  before: typeSettingsPatchSchema.optional(),
  after: typeSettingsPatchSchema.optional(),
}) as unknown as z.ZodType<TypeModifiedChange>;

const typeSettingsModifiedChangeSchema = z.looseObject({
  kind: z.literal("type_settings_modified"),
  typeName: z.string(),
  reason: z.string().optional(),
  before: snapshotTypeSettingsStateSchema,
  after: snapshotTypeSettingsStateSchema,
}) as unknown as z.ZodType<TypeSettingsModifiedChange>;

const fieldAddedChangeSchema = z.looseObject({
  kind: z.literal("field_added"),
  typeName: z.string(),
  reason: z.string().optional(),
  fieldName: z.string(),
  after: snapshotFieldConfigSchema,
}) as unknown as z.ZodType<FieldAddedChange>;

const fieldRemovedChangeSchema = z.looseObject({
  kind: z.literal("field_removed"),
  typeName: z.string(),
  reason: z.string().optional(),
  fieldName: z.string(),
  before: snapshotFieldConfigSchema,
}) as unknown as z.ZodType<FieldRemovedChange>;

const fieldModifiedChangeSchema = z.looseObject({
  kind: z.literal("field_modified"),
  typeName: z.string(),
  reason: z.string().optional(),
  fieldName: z.string(),
  before: snapshotFieldConfigSchema,
  after: snapshotFieldConfigSchema,
}) as unknown as z.ZodType<FieldModifiedChange>;

const indexAddedChangeSchema = z.looseObject({
  kind: z.literal("index_added"),
  typeName: z.string(),
  reason: z.string().optional(),
  indexName: z.string(),
  after: snapshotIndexConfigSchema,
}) as unknown as z.ZodType<IndexAddedChange>;

const indexRemovedChangeSchema = z.looseObject({
  kind: z.literal("index_removed"),
  typeName: z.string(),
  reason: z.string().optional(),
  indexName: z.string(),
  before: snapshotIndexConfigSchema,
}) as unknown as z.ZodType<IndexRemovedChange>;

const indexModifiedChangeSchema = z.looseObject({
  kind: z.literal("index_modified"),
  typeName: z.string(),
  reason: z.string().optional(),
  indexName: z.string(),
  before: snapshotIndexConfigSchema,
  after: snapshotIndexConfigSchema,
}) as unknown as z.ZodType<IndexModifiedChange>;

const fileAddedChangeSchema = z.looseObject({
  kind: z.literal("file_added"),
  typeName: z.string(),
  reason: z.string().optional(),
  fieldName: z.string(),
  after: z.string(),
}) as unknown as z.ZodType<FileAddedChange>;

const fileRemovedChangeSchema = z.looseObject({
  kind: z.literal("file_removed"),
  typeName: z.string(),
  reason: z.string().optional(),
  fieldName: z.string(),
  before: z.string(),
}) as unknown as z.ZodType<FileRemovedChange>;

const fileModifiedChangeSchema = z.looseObject({
  kind: z.literal("file_modified"),
  typeName: z.string(),
  reason: z.string().optional(),
  fieldName: z.string(),
  before: z.string(),
  after: z.string(),
}) as unknown as z.ZodType<FileModifiedChange>;

const relationshipAddedChangeSchema = z.looseObject({
  kind: z.literal("relationship_added"),
  typeName: z.string(),
  reason: z.string().optional(),
  relationshipName: z.string(),
  relationshipType: z.enum(["forward", "backward"]).optional(),
  after: snapshotRelationshipSchema,
}) as unknown as z.ZodType<RelationshipAddedChange>;

const relationshipRemovedChangeSchema = z.looseObject({
  kind: z.literal("relationship_removed"),
  typeName: z.string(),
  reason: z.string().optional(),
  relationshipName: z.string(),
  relationshipType: z.enum(["forward", "backward"]).optional(),
  before: snapshotRelationshipSchema,
}) as unknown as z.ZodType<RelationshipRemovedChange>;

const relationshipModifiedChangeSchema = z.looseObject({
  kind: z.literal("relationship_modified"),
  typeName: z.string(),
  reason: z.string().optional(),
  relationshipName: z.string(),
  relationshipType: z.enum(["forward", "backward"]).optional(),
  before: snapshotRelationshipSchema,
  after: snapshotRelationshipSchema,
}) as unknown as z.ZodType<RelationshipModifiedChange>;

const permissionModifiedChangeSchema = z.looseObject({
  kind: z.literal("permission_modified"),
  typeName: z.string(),
  reason: z.string().optional(),
  before: snapshotPermissionStateSchema.optional(),
  after: snapshotPermissionStateSchema.optional(),
}) as unknown as z.ZodType<PermissionModifiedChange>;

type DiscriminableSchema = Parameters<typeof z.discriminatedUnion>[1][number];

export const diffChangeSchema: z.ZodType<DiffChange> = z.discriminatedUnion("kind", [
  typeAddedChangeSchema as unknown as DiscriminableSchema,
  typeRemovedChangeSchema as unknown as DiscriminableSchema,
  typeModifiedChangeSchema as unknown as DiscriminableSchema,
  typeSettingsModifiedChangeSchema as unknown as DiscriminableSchema,
  fieldAddedChangeSchema as unknown as DiscriminableSchema,
  fieldRemovedChangeSchema as unknown as DiscriminableSchema,
  fieldModifiedChangeSchema as unknown as DiscriminableSchema,
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
]) as z.ZodType<DiffChange>;

export const breakingChangeInfoSchema: z.ZodType<BreakingChangeInfo> = z.looseObject({
  typeName: z.string(),
  fieldName: z.string().optional(),
  reason: z.string(),
  unsupported: z.boolean().optional(),
  showThreeStepHint: z.boolean().optional(),
});

export const warningChangeInfoSchema: z.ZodType<WarningChangeInfo> = z.looseObject({
  typeName: z.string(),
  fieldName: z.string().optional(),
  reason: z.string(),
});

// MigrationDiff: `warnings` and `hasWarnings` are optional here so that
// older diff.json files that predate these fields still validate cleanly.
// loadDiff backfills both from the warnings array after validation.
export const migrationDiffSchema: z.ZodType<MigrationDiff> = z.looseObject({
  version: z.number(),
  namespace: z.string(),
  createdAt: z.string(),
  description: z.string().optional(),
  changes: z.array(diffChangeSchema),
  hasBreakingChanges: z.boolean(),
  breakingChanges: z.array(breakingChangeInfoSchema),
  // Optional for backward compat: loadDiff backfills these after validation.
  hasWarnings: z.boolean().optional() as z.ZodType<boolean>,
  warnings: z.array(warningChangeInfoSchema).optional() as z.ZodType<WarningChangeInfo[]>,
  requiresMigrationScript: z.boolean(),
});
