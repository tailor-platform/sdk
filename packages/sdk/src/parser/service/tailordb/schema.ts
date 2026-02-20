import { z } from "zod";
import { functionSchema } from "../common";
import { GqlOperationsSchema } from "./gql-operations";
import { relationTypesKeys } from "./relation";
import type { TailorDBFieldOutput } from "./types";

const TailorFieldTypeSchema = z.enum([
  "uuid",
  "string",
  "boolean",
  "integer",
  "float",
  "enum",
  "date",
  "datetime",
  "time",
  "nested",
]);

const AllowedValueSchema = z.object({
  value: z.string(),
  description: z.string().optional(),
});

export const DBFieldMetadataSchema = z.object({
  required: z.boolean().optional(),
  array: z.boolean().optional(),
  description: z.string().optional(),
  typeName: z.string().optional(),
  allowedValues: z.array(AllowedValueSchema).optional(),
  index: z.boolean().optional(),
  unique: z.boolean().optional(),
  vector: z.boolean().optional(),
  foreignKey: z.boolean().optional(),
  foreignKeyType: z.string().optional(),
  foreignKeyField: z.string().optional(),
  hooks: z
    .object({
      create: functionSchema.optional(),
      update: functionSchema.optional(),
    })
    .optional(),
  validate: z.array(z.union([functionSchema, z.tuple([functionSchema, z.string()])])).optional(),
  serial: z
    .object({
      start: z.number(),
      maxValue: z.number().optional(),
      format: z.string().optional(),
    })
    .optional(),
});

const RelationTypeSchema = z.enum(relationTypesKeys);

export const RawRelationConfigSchema = z.object({
  type: RelationTypeSchema,
  toward: z.object({
    type: z.string(),
    as: z.string().optional(),
    key: z.string().optional(),
  }),
  backward: z.string().optional(),
});

const TailorDBFieldSchema: z.ZodType<TailorDBFieldOutput> = z.lazy(() =>
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
export const TailorDBTypeSettingsSchema = z.object({
  pluralForm: z.string().optional(),
  aggregation: z.boolean().optional(),
  bulkUpsert: z.boolean().optional(),
  gqlOperations: GqlOperationsSchema.optional(),
});

export const GQL_PERMISSION_INVALID_OPERAND_MESSAGE =
  "operand is not supported in gqlPermission. Use permission() for record-level conditions.";

const GqlPermissionOperandSchema = z.union(
  [
    z.object({ user: z.string() }).strict(),
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
  z.object({ record: z.string() }),
  z.object({ oldRecord: z.string() }),
  z.object({ newRecord: z.string() }),
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
  z.object({
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

const GqlPermissionPolicySchema = z.object({
  conditions: z.array(GqlPermissionConditionSchema).readonly(),
  actions: z.union([z.literal("all"), z.array(GqlPermissionActionSchema).readonly()]),
  permit: z.boolean().optional(),
  description: z.string().optional(),
});

export const RawPermissionsSchema = z.object({
  record: z
    .object({
      create: z.array(ActionPermissionSchema).readonly(),
      read: z.array(ActionPermissionSchema).readonly(),
      update: z.array(ActionPermissionSchema).readonly(),
      delete: z.array(ActionPermissionSchema).readonly(),
    })
    .optional(),
  gql: z.array(GqlPermissionPolicySchema).readonly().optional(),
});

export const TailorDBTypeSchema = z.object({
  name: z.string(),
  fields: z.record(z.string(), TailorDBFieldSchema),
  metadata: z.object({
    name: z.string(),
    description: z.string().optional(),
    settings: TailorDBTypeSettingsSchema.optional(),
    permissions: RawPermissionsSchema,
    files: z.record(z.string(), z.string()),
    indexes: z
      .record(
        z.string(),
        z.object({
          fields: z.array(z.string()),
          unique: z.boolean().optional(),
        }),
      )
      .optional(),
  }),
});

const TailorDBMigrationConfigSchema = z.object({
  directory: z.string(),
  machineUser: z.string().optional(),
});

/**
 * Schema for TailorDB service configuration.
 * Normalizes gqlOperations from alias ("query") to object format.
 */
export const TailorDBServiceConfigSchema = z.object({
  files: z.array(z.string()),
  ignores: z.array(z.string()).optional(),
  erdSite: z.string().optional(),
  migration: TailorDBMigrationConfigSchema.optional(),
  gqlOperations: GqlOperationsSchema.optional(),
});

/**
 * Input type for TailorDB service configuration (before schema parsing).
 * gqlOperations accepts both alias ("query") and object format.
 */
export type TailorDBServiceConfigInput = z.input<typeof TailorDBServiceConfigSchema>;

/**
 * Parsed TailorDB service configuration (after schema parsing).
 * gqlOperations is normalized to object format.
 */
export type TailorDBServiceConfig = z.output<typeof TailorDBServiceConfigSchema>;

export type TailorDBExternalConfig = { external: true };

export type TailorDBServiceInput = {
  [namespace: string]: TailorDBServiceConfigInput | TailorDBExternalConfig;
};
