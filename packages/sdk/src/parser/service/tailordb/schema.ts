import { z } from "zod";
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
 * Zod schema for GqlOperations configuration with normalization transform.
 * Accepts "query" alias or detailed object, normalizes to GqlOperations object.
 */
export const GqlOperationsSchema = z
  .union([
    z.literal("query"),
    z.strictObject({
      create: z.boolean().optional().describe("Enable create mutation (default: true)"),
      update: z.boolean().optional().describe("Enable update mutation (default: true)"),
      delete: z.boolean().optional().describe("Enable delete mutation (default: true)"),
      read: z
        .boolean()
        .optional()
        .describe("Enable read queries - get, list, aggregation (default: true)"),
    }),
  ])
  .describe(
    "Configuration for GraphQL operations on a TailorDB type.\nAll operations are enabled by default (undefined or true = enabled, false = disabled).",
  )
  .transform((val) => normalizeGqlOperations(val));

const TailorFieldTypeSchema = z.enum([
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

const AllowedValueSchema = z.strictObject({
  value: z.string(),
  description: z.string().optional(),
});

export const DBFieldMetadataSchema = z.strictObject({
  required: z.boolean().optional().describe("Whether the field is required"),
  array: z.boolean().optional().describe("Whether the field is an array"),
  description: z.string().optional().describe("Field description"),
  typeName: z.string().optional().describe("Type name for nested or enum fields"),
  allowedValues: z.array(AllowedValueSchema).optional().describe("Allowed values for enum fields"),
  index: z.boolean().optional().describe("Whether the field is indexed for faster queries"),
  unique: z.boolean().optional().describe("Whether the field value must be unique"),
  vector: z
    .boolean()
    .optional()
    .describe("Whether the field is a vector field for similarity search"),
  foreignKey: z.boolean().optional().describe("Whether the field is a foreign key"),
  foreignKeyType: z.string().optional().describe("Target type name for foreign key relations"),
  foreignKeyField: z.string().optional().describe("Target field name for foreign key relations"),
  hooks: z
    .strictObject({
      create: functionSchema.optional().describe("Hook function called on record creation"),
      update: functionSchema.optional().describe("Hook function called on record update"),
    })
    .optional()
    .describe("Lifecycle hooks for the field"),
  validate: z
    .array(z.union([functionSchema, z.tuple([functionSchema, z.string()])]))
    .optional()
    .describe("Validation functions for the field"),
  serial: z
    .strictObject({
      start: z.number().describe("Starting value for the serial sequence"),
      maxValue: z.number().optional().describe("Maximum value for the serial sequence"),
      format: z.string().optional().describe("Format string for serial value (string type only)"),
    })
    .optional()
    .describe("Serial (auto-increment) configuration"),
  scale: z
    .number()
    .int()
    .min(0)
    .max(12)
    .optional()
    .describe("Decimal scale (number of digits after decimal point, 0-12)"),
});

const RelationTypeSchema = z.enum(relationTypesKeys);

export const RawRelationConfigSchema = z.strictObject({
  type: RelationTypeSchema.describe("Relation cardinality type"),
  toward: z.strictObject({
    type: z.string().describe("Target type name, or 'self' for self-relations"),
    as: z.string().optional().describe("Custom forward relation name"),
    key: z.string().optional().describe("Target field to join on (default: 'id')"),
  }),
  backward: z.string().optional().describe("Backward relation name on the target type"),
});

const TailorDBFieldSchema: z.ZodType<TailorDBFieldOutput> = z.lazy(() =>
  // strip unknown keys
  z.object({
    type: TailorFieldTypeSchema,
    fields: z.record(z.string(), TailorDBFieldSchema).optional(),
    metadata: DBFieldMetadataSchema,
    rawRelation: RawRelationConfigSchema.optional(),
  }),
);

/**
 * Schema for TailorDB type settings.
 * Normalizes gqlOperations from alias ("query") to object format.
 */
export const TailorDBTypeSettingsSchema = z.strictObject({
  pluralForm: z.string().optional().describe("Custom plural form of the type name for GraphQL"),
  aggregation: z.boolean().optional().describe("Enable aggregation queries for this type"),
  bulkUpsert: z.boolean().optional().describe("Enable bulk upsert mutation for this type"),
  gqlOperations: GqlOperationsSchema.optional().describe(
    'Configure GraphQL operations for this type. Use "query" for read-only mode, or an object for granular control.',
  ),
  publishEvents: z
    .boolean()
    .optional()
    .describe(
      "Enable publishing events for this type.\nWhen enabled, record creation/update/deletion events are published.\nIf not specified, this is automatically set to true when an executor uses this type\nwith recordCreated/recordUpdated/recordDeleted triggers. If explicitly set to false\nwhile an executor uses this type, an error will be thrown during apply.",
    ),
});

export const GQL_PERMISSION_INVALID_OPERAND_MESSAGE =
  "operand is not supported in gqlPermission. Use permission() for record-level conditions.";

const GqlPermissionOperandSchema = z.union(
  [
    z.strictObject({ user: z.string() }),
    z.string(),
    z.boolean(),
    z.array(z.string()),
    z.array(z.boolean()),
  ],
  {
    error: (issue) => {
      if (typeof issue.input === "object" && issue.input !== null) {
        const keys = Object.keys(issue.input);
        if (keys.length === 1) {
          return `"${keys[0]}" ${GQL_PERMISSION_INVALID_OPERAND_MESSAGE}`;
        }
        return "Operand object must have exactly 1 key";
      }
      return "Invalid operand in gqlPermission";
    },
  },
);

const RecordPermissionOperandSchema = z.union([
  GqlPermissionOperandSchema,
  z.strictObject({ record: z.string() }),
  z.strictObject({ oldRecord: z.string() }),
  z.strictObject({ newRecord: z.string() }),
]);

const PermissionOperatorSchema = z.enum(["=", "!=", "in", "not in", "hasAny", "not hasAny"]);

const RecordPermissionConditionSchema = z
  .tuple([RecordPermissionOperandSchema, PermissionOperatorSchema, RecordPermissionOperandSchema])
  .readonly();

const GqlPermissionConditionSchema = z
  .tuple([GqlPermissionOperandSchema, PermissionOperatorSchema, GqlPermissionOperandSchema])
  .readonly();

const ActionPermissionSchema = z.union([
  // Object format: { conditions, description?, permit? }
  z.strictObject({
    conditions: z.union([
      RecordPermissionConditionSchema,
      z.array(RecordPermissionConditionSchema).readonly(),
    ]),
    description: z.string().optional(),
    permit: z.boolean().optional(),
  }),
  // Single condition tuple: [operand, operator, operand]
  z
    .tuple([RecordPermissionOperandSchema, PermissionOperatorSchema, RecordPermissionOperandSchema])
    .readonly(),
  // Single condition tuple with permit: [operand, operator, operand, permit]
  z
    .tuple([
      RecordPermissionOperandSchema,
      PermissionOperatorSchema,
      RecordPermissionOperandSchema,
      z.boolean(),
    ])
    .readonly(),
  // Multiple conditions with optional trailing permit
  z
    .array(z.union([RecordPermissionConditionSchema, z.boolean()]))
    .refine(
      (arr) => {
        const boolIndex = arr.findIndex((item) => typeof item === "boolean");
        return boolIndex === -1 || boolIndex === arr.length - 1;
      },
      { message: "Boolean permit flag must only appear at the end" },
    )
    .readonly(),
]);

const GqlPermissionActionSchema = z.enum([
  "read",
  "create",
  "update",
  "delete",
  "aggregate",
  "bulkUpsert",
]);

const GqlPermissionPolicySchema = z.strictObject({
  conditions: z.array(GqlPermissionConditionSchema).readonly(),
  actions: z.union([z.literal("all"), z.array(GqlPermissionActionSchema).readonly()]),
  permit: z.boolean().optional(),
  description: z.string().optional(),
});

export const RawPermissionsSchema = z.strictObject({
  record: z
    .strictObject({
      create: z.array(ActionPermissionSchema).readonly(),
      read: z.array(ActionPermissionSchema).readonly(),
      update: z.array(ActionPermissionSchema).readonly(),
      delete: z.array(ActionPermissionSchema).readonly(),
    })
    .optional(),
  gql: z.array(GqlPermissionPolicySchema).readonly().optional(),
});

export const TailorDBTypeSchema = z.strictObject({
  name: z.string(),
  fields: z.record(z.string(), TailorDBFieldSchema),
  // oxlint-disable-next-line zod/prefer-strict-object, tailor-zod/require-object-policy-comment -- Keep z.object().strict() so zinfer preserves the RawPermissions alias in generated types.
  metadata: z
    .object({
      name: z.string(),
      description: z.string().optional(),
      settings: TailorDBTypeSettingsSchema.optional(),
      permissions: RawPermissionsSchema,
      files: z.record(z.string(), z.string()),
      indexes: z
        .record(
          z.string(),
          z.strictObject({
            fields: z.array(z.string()),
            unique: z.boolean().optional(),
          }),
        )
        .optional(),
    })
    .strict(),
});

const TailorDBMigrationConfigSchema = z.strictObject({
  directory: z.string().describe("Directory containing migration files"),
  machineUser: z.string().optional().describe("Machine user name for migration execution"),
});

/**
 * Schema for TailorDB service configuration.
 * Normalizes gqlOperations from alias ("query") to object format.
 */
export const TailorDBServiceConfigSchema = z.strictObject({
  files: z.array(z.string()).describe("Glob patterns for TailorDB type definition files"),
  ignores: z.array(z.string()).optional().describe("Glob patterns to exclude from type discovery"),
  erdSite: z.string().optional().describe("URL for the ERD (Entity Relationship Diagram) site"),
  migration: TailorDBMigrationConfigSchema.optional().describe("Migration configuration"),
  gqlOperations: GqlOperationsSchema.optional().describe(
    "Default GraphQL operations for all types in this service",
  ),
});
