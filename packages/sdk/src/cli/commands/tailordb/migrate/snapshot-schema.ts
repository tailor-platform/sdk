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
import { SCHEMA_SNAPSHOT_VERSION } from "./diff-calculator";
import type {
  TypeSettingsPatch,
  SnapshotPermissionState,
  TypeAddedChange,
  TypeRemovedChange,
  TypeModifiedChange,
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
  SnapshotGqlAction,
  SnapshotGqlPermissionPolicy,
  SnapshotGqlPermission,
  TailorDBSnapshotType,
  SchemaSnapshot,
} from "./snapshot-types";

// ============================================================================
// Snapshot Leaf Types
// ============================================================================

export const snapshotHookSchema: z.ZodType<SnapshotHook> = z.looseObject({
  expr: z.string(),
});

export const snapshotValidationSchema: z.ZodType<SnapshotValidation> = z.looseObject({
  script: z.looseObject({ expr: z.string() }),
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
  // `required` is non-optional in the interface; the schema enforces this
  // so downstream code can safely drop the `?? true` guards.
  required: z.boolean(),
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
  fields: z.lazy(() => z.record(z.string(), snapshotFieldConfigSchema)).optional(),
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

const snapshotFieldRefOperandSchema = z.union([
  z.looseObject({ user: z.string() }),
  z.looseObject({ record: z.string() }),
  z.looseObject({ newRecord: z.string() }),
  z.looseObject({ oldRecord: z.string() }),
]);

// SnapshotValueOperand = string | boolean | string[] | boolean[]
// Arrays first so z.union picks them before string/boolean scalars.
const snapshotValueOperandSchema = z.union([
  z.array(z.string()),
  z.array(z.boolean()),
  z.string(),
  z.boolean(),
]);

const snapshotPermissionOperandSchema = z.union([
  snapshotFieldRefOperandSchema,
  snapshotValueOperandSchema,
]);

const snapshotPermissionOperatorSchema = z.enum(["eq", "ne", "in", "nin", "hasAny", "nhasAny"]);

// SnapshotPermissionCondition is a readonly 3-tuple
const snapshotPermissionConditionSchema = z.tuple([
  snapshotPermissionOperandSchema,
  snapshotPermissionOperatorSchema,
  snapshotPermissionOperandSchema,
]);

export const snapshotActionPermissionSchema: z.ZodType<SnapshotActionPermission> = z.looseObject({
  conditions: z.array(snapshotPermissionConditionSchema),
  description: z.string().optional(),
  permit: z.enum(["allow", "deny"]),
});

export const snapshotRecordPermissionSchema: z.ZodType<SnapshotRecordPermission> = z.looseObject({
  create: z.array(snapshotActionPermissionSchema),
  read: z.array(snapshotActionPermissionSchema),
  update: z.array(snapshotActionPermissionSchema),
  delete: z.array(snapshotActionPermissionSchema),
});

const snapshotGqlActionSchema: z.ZodType<SnapshotGqlAction> = z.enum([
  "read",
  "create",
  "update",
  "delete",
  "aggregate",
  "bulkUpsert",
  "all",
]);

export const snapshotGqlPermissionPolicySchema: z.ZodType<SnapshotGqlPermissionPolicy> =
  z.looseObject({
    conditions: z.array(snapshotPermissionConditionSchema),
    actions: z.array(snapshotGqlActionSchema),
    permit: z.enum(["allow", "deny"]),
    description: z.string().optional(),
  });

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
  fields: z.record(z.string(), snapshotFieldConfigSchema),
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
  indexes: z.record(z.string(), snapshotIndexConfigSchema).optional(),
  files: z.record(z.string(), z.string()).optional(),
  forwardRelationships: z.record(z.string(), snapshotRelationshipSchema).optional(),
  backwardRelationships: z.record(z.string(), snapshotRelationshipSchema).optional(),
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
  version: z.literal(SCHEMA_SNAPSHOT_VERSION),
  namespace: z.string(),
  createdAt: z.string(),
  types: z.record(z.string(), tailorDBSnapshotTypeSchema),
});

// ============================================================================
// Diff Types
// ============================================================================

const typeSettingsPatchSchema: z.ZodType<TypeSettingsPatch> = z.looseObject({
  indexes: z.record(z.string(), snapshotIndexConfigSchema).optional(),
  files: z.record(z.string(), z.string()).optional(),
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
  version: z.literal(SCHEMA_SNAPSHOT_VERSION),
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
