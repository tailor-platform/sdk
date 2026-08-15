import * as v from "valibot";
import { functionSchema } from "../common";
import { relationTypesKeys } from "./relation";
import type { TailorDBFieldOutput } from "#/parser/service/tailordb/types";

/**
 * Normalize GqlOperationsConfig (alias or object) to GqlOperations object.
 * "query" alias expands to read-only mode: { create: false, update: false, delete: false, read: true }
 * @param config - The config to normalize
 * @returns The normalized GqlOperations object
 */
function normalizeGqlOperations(
  config: "query" | { create?: boolean; update?: boolean; delete?: boolean; read?: boolean },
) {
  if (config === "query") {
    return { create: false, update: false, delete: false, read: true };
  }
  return config;
}

/**
 * Valibot schema for GqlOperations configuration with normalization transform.
 * Accepts "query" alias or detailed object, normalizes to GqlOperations object.
 */
export const GqlOperationsSchema = v.pipe(
  v.union([
    v.literal("query"),
    v.strictObject({
      create: v.optional(
        v.pipe(v.boolean(), v.description("Enable create mutation (default: true)")),
      ),
      update: v.optional(
        v.pipe(v.boolean(), v.description("Enable update mutation (default: true)")),
      ),
      delete: v.optional(
        v.pipe(v.boolean(), v.description("Enable delete mutation (default: true)")),
      ),
      read: v.optional(
        v.pipe(
          v.boolean(),
          v.description("Enable read queries - get, list, aggregation (default: true)"),
        ),
      ),
    }),
  ]),
  v.description(
    "Configuration for GraphQL operations on a TailorDB type.\nAll operations are enabled by default (undefined or true = enabled, false = disabled).",
  ),
  v.transform((val) => normalizeGqlOperations(val)),
);

const TailorFieldTypeSchema = v.picklist([
  "uuid",
  "string",
  "boolean",
  "integer",
  "float",
  "decimal",
  "enum",
  "date",
  "datetime",
  "time",
  "nested",
]);

const AllowedValueSchema = v.strictObject({
  value: v.string(),
  description: v.optional(v.string()),
});

export const DBFieldMetadataSchema = v.strictObject({
  required: v.optional(v.pipe(v.boolean(), v.description("Whether the field is required"))),
  array: v.optional(v.pipe(v.boolean(), v.description("Whether the field is an array"))),
  description: v.optional(v.pipe(v.string(), v.description("Field description"))),
  typeName: v.optional(v.pipe(v.string(), v.description("Type name for nested or enum fields"))),
  allowedValues: v.optional(
    v.pipe(v.array(AllowedValueSchema), v.description("Allowed values for enum fields")),
  ),
  index: v.optional(
    v.pipe(v.boolean(), v.description("Whether the field is indexed for faster queries")),
  ),
  unique: v.optional(v.pipe(v.boolean(), v.description("Whether the field value must be unique"))),
  vector: v.optional(
    v.pipe(v.boolean(), v.description("Whether the field is a vector field for similarity search")),
  ),
  foreignKey: v.optional(v.pipe(v.boolean(), v.description("Whether the field is a foreign key"))),
  foreignKeyType: v.optional(
    v.pipe(v.string(), v.description("Target type name for foreign key relations")),
  ),
  foreignKeyField: v.optional(
    v.pipe(v.string(), v.description("Target field name for foreign key relations")),
  ),
  hooks: v.optional(
    v.pipe(
      v.strictObject({
        create: v.optional(
          v.pipe(functionSchema, v.description("Hook function called on record creation")),
        ),
        update: v.optional(
          v.pipe(functionSchema, v.description("Hook function called on record update")),
        ),
      }),
      v.description("Lifecycle hooks for the field"),
    ),
  ),
  validate: v.optional(
    v.pipe(v.array(functionSchema), v.description("Validation functions for the field")),
  ),
  serial: v.optional(
    v.pipe(
      v.strictObject({
        start: v.pipe(v.number(), v.description("Starting value for the serial sequence")),
        maxValue: v.optional(
          v.pipe(v.number(), v.description("Maximum value for the serial sequence")),
        ),
        format: v.optional(
          v.pipe(v.string(), v.description("Format string for serial value (string type only)")),
        ),
      }),
      v.description("Serial (auto-increment) configuration"),
    ),
  ),
  scale: v.optional(
    v.pipe(
      v.number(),
      v.integer(),
      v.minValue(0),
      v.maxValue(12),
      v.description("Decimal scale (number of digits after decimal point, 0-12)"),
    ),
  ),
  default: v.optional(v.pipe(v.unknown(), v.description("Default value for the field on create"))),
});

const RelationTypeSchema = v.picklist(relationTypesKeys);

export const RawRelationConfigSchema = v.strictObject({
  type: v.pipe(RelationTypeSchema, v.description("Relation cardinality type")),
  toward: v.strictObject({
    type: v.pipe(v.string(), v.description("Target type name, or 'self' for self-relations")),
    as: v.optional(v.pipe(v.string(), v.description("Custom forward relation name"))),
    key: v.optional(v.pipe(v.string(), v.description("Target field to join on (default: 'id')"))),
  }),
  backward: v.optional(
    v.pipe(v.string(), v.description("Backward relation name on the target type")),
  ),
});

const TailorDBFieldSchema: v.GenericSchema<TailorDBFieldOutput> = v.lazy(() =>
  // strip unknown keys
  v.object({
    type: TailorFieldTypeSchema,
    fields: v.optional(v.record(v.string(), TailorDBFieldSchema)),
    metadata: DBFieldMetadataSchema,
    rawRelation: v.optional(RawRelationConfigSchema),
  }),
);

/**
 * Schema for TailorDB type settings.
 * Normalizes gqlOperations from alias ("query") to object format.
 */
export const TailorDBTypeSettingsSchema = v.strictObject({
  pluralForm: v.optional(
    v.pipe(v.string(), v.description("Custom plural form of the type name for GraphQL")),
  ),
  aggregation: v.optional(
    v.pipe(v.boolean(), v.description("Enable aggregation queries for this type")),
  ),
  bulkUpsert: v.optional(
    v.pipe(v.boolean(), v.description("Enable bulk upsert mutation for this type")),
  ),
  gqlOperations: v.optional(
    v.pipe(
      GqlOperationsSchema,
      v.description(
        'Configure GraphQL operations for this type. Use "query" for read-only mode, or an object for granular control.',
      ),
    ),
  ),
  publishEvents: v.optional(
    v.pipe(
      v.boolean(),
      v.description(
        "Enable publishing events for this type.\nWhen enabled, record creation/update/deletion events are published.\nIf not specified, this is automatically set to true when an executor uses this type\nwith recordCreated/recordUpdated/recordDeleted triggers. If explicitly set to false\nwhile an executor uses this type, an error will be thrown during apply.",
      ),
    ),
  ),
});

export const GQL_PERMISSION_INVALID_OPERAND_MESSAGE =
  "operand is not supported in gqlPermission. Use permission() for record-level conditions.";

const GqlPermissionOperandSchema = v.union(
  [
    v.strictObject({ user: v.string() }),
    v.string(),
    v.boolean(),
    v.array(v.string()),
    v.array(v.boolean()),
  ],
  (issue) => {
    if (typeof issue.input === "object" && issue.input !== null) {
      const keys = Object.keys(issue.input);
      if (keys.length === 1) {
        return `"${keys[0]}" ${GQL_PERMISSION_INVALID_OPERAND_MESSAGE}`;
      }
      return "Operand object must have exactly 1 key";
    }
    return "Invalid operand in gqlPermission";
  },
);

const RecordPermissionOperandSchema = v.union([
  GqlPermissionOperandSchema,
  v.strictObject({ record: v.string() }),
  v.strictObject({ oldRecord: v.string() }),
  v.strictObject({ newRecord: v.string() }),
]);

const PermissionOperatorSchema = v.picklist(["=", "!=", "in", "not in", "hasAny", "not hasAny"]);

const RecordPermissionConditionSchema = v.pipe(
  v.tuple([RecordPermissionOperandSchema, PermissionOperatorSchema, RecordPermissionOperandSchema]),
  v.readonly(),
);

const GqlPermissionConditionSchema = v.pipe(
  v.tuple([GqlPermissionOperandSchema, PermissionOperatorSchema, GqlPermissionOperandSchema]),
  v.readonly(),
);

const ActionPermissionSchema = v.union([
  // Object format: { conditions, description?, permit? }
  v.strictObject({
    conditions: v.union([
      RecordPermissionConditionSchema,
      v.pipe(v.array(RecordPermissionConditionSchema), v.readonly()),
    ]),
    description: v.optional(v.string()),
    permit: v.optional(v.boolean()),
  }),
  // Single condition tuple: [operand, operator, operand]
  v.pipe(
    v.tuple([
      RecordPermissionOperandSchema,
      PermissionOperatorSchema,
      RecordPermissionOperandSchema,
    ]),
    v.readonly(),
  ),
  // Single condition tuple with permit: [operand, operator, operand, permit]
  v.pipe(
    v.tuple([
      RecordPermissionOperandSchema,
      PermissionOperatorSchema,
      RecordPermissionOperandSchema,
      v.boolean(),
    ]),
    v.readonly(),
  ),
  // Multiple conditions with optional trailing permit
  v.pipe(
    v.array(v.union([RecordPermissionConditionSchema, v.boolean()])),
    v.check((arr) => {
      const boolIndex = arr.findIndex((item) => typeof item === "boolean");
      return boolIndex === -1 || boolIndex === arr.length - 1;
    }, "Boolean permit flag must only appear at the end"),
    v.readonly(),
  ),
]);

const GqlPermissionActionSchema = v.picklist([
  "read",
  "create",
  "update",
  "delete",
  "aggregate",
  "bulkUpsert",
]);

const GqlPermissionPolicySchema = v.strictObject({
  conditions: v.pipe(v.array(GqlPermissionConditionSchema), v.readonly()),
  actions: v.union([v.literal("all"), v.pipe(v.array(GqlPermissionActionSchema), v.readonly())]),
  permit: v.optional(v.boolean()),
  description: v.optional(v.string()),
});

export const RawPermissionsSchema = v.strictObject({
  record: v.optional(
    v.strictObject({
      create: v.pipe(v.array(ActionPermissionSchema), v.readonly()),
      read: v.pipe(v.array(ActionPermissionSchema), v.readonly()),
      update: v.pipe(v.array(ActionPermissionSchema), v.readonly()),
      delete: v.pipe(v.array(ActionPermissionSchema), v.readonly()),
    }),
  ),
  gql: v.optional(v.pipe(v.array(GqlPermissionPolicySchema), v.readonly())),
});

export const TailorDBTypeSchema = v.strictObject({
  name: v.string(),
  fields: v.record(v.string(), TailorDBFieldSchema),
  // Keep v.strictObject() so vinfer preserves the RawPermissions alias in generated types.
  metadata: v.strictObject({
    name: v.string(),
    description: v.optional(v.string()),
    settings: v.optional(TailorDBTypeSettingsSchema),
    permissions: RawPermissionsSchema,
    files: v.record(v.string(), v.string()),
    indexes: v.optional(
      v.record(
        v.string(),
        v.strictObject({
          fields: v.array(v.string()),
          unique: v.optional(v.boolean()),
        }),
      ),
    ),
    typeHook: v.optional(
      v.strictObject({
        create: v.optional(functionSchema),
        update: v.optional(functionSchema),
      }),
    ),
    typeValidate: v.optional(functionSchema),
  }),
});

const TailorDBMigrationConfigSchema = v.strictObject({
  directory: v.pipe(v.string(), v.description("Directory containing migration files")),
  machineUser: v.optional(
    v.pipe(v.string(), v.description("Machine user name for migration execution")),
  ),
});

/**
 * Schema for TailorDB service configuration.
 * Normalizes gqlOperations from alias ("query") to object format.
 */
export const TailorDBServiceConfigSchema = v.strictObject({
  files: v.pipe(
    v.array(v.string()),
    v.description("Glob patterns for TailorDB type definition files"),
  ),
  ignores: v.optional(
    v.pipe(v.array(v.string()), v.description("Glob patterns to exclude from type discovery")),
  ),
  migration: v.optional(
    v.pipe(TailorDBMigrationConfigSchema, v.description("Migration configuration")),
  ),
  gqlOperations: v.optional(
    v.pipe(
      GqlOperationsSchema,
      v.description("Default GraphQL operations for all types in this service"),
    ),
  ),
});
