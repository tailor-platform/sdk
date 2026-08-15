import * as v from "valibot";
import { functionSchema } from "../common";

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
  value: v.pipe(v.string(), v.description("The allowed value")),
  description: v.optional(v.pipe(v.string(), v.description("Description of the allowed value"))),
});

const FieldMetadataSchema = v.strictObject({
  required: v.optional(v.pipe(v.boolean(), v.description("Whether the field is required"))),
  array: v.optional(v.pipe(v.boolean(), v.description("Whether the field is an array"))),
  description: v.optional(v.pipe(v.string(), v.description("Field description"))),
  allowedValues: v.optional(
    v.pipe(v.array(AllowedValueSchema), v.description("Allowed values for enum fields")),
  ),
  hooks: v.optional(
    v.pipe(
      v.strictObject({
        create: v.optional(
          v.pipe(functionSchema, v.description("Hook function called on creation")),
        ),
        update: v.optional(v.pipe(functionSchema, v.description("Hook function called on update"))),
      }),
      v.description("Lifecycle hooks"),
    ),
  ),
  validate: v.optional(
    v.pipe(v.array(functionSchema), v.description("Validation functions for the field")),
  ),
  typeName: v.optional(v.pipe(v.string(), v.description("Type name for nested or enum fields"))),
  default: v.optional(v.pipe(v.unknown(), v.description("Default value for the field on create"))),
});

export interface TailorFieldShape {
  type:
    | "uuid"
    | "string"
    | "boolean"
    | "integer"
    | "float"
    | "decimal"
    | "enum"
    | "date"
    | "datetime"
    | "time"
    | "nested";
  metadata: {
    required?: boolean;
    array?: boolean;
    description?: string;
    allowedValues?: { value: string; description?: string }[];
    // oxlint-disable-next-line typescript/no-unsafe-function-type
    hooks?: { create?: Function; update?: Function };
    // oxlint-disable-next-line typescript/no-unsafe-function-type
    validate?: Function[];
    typeName?: string;
    default?: unknown;
  };
  fields: Record<string, TailorFieldShape>;
}

// strip unknown keys
export const TailorFieldSchema = v.object({
  type: v.pipe(TailorFieldTypeSchema, v.description("Field data type")),
  metadata: v.pipe(FieldMetadataSchema, v.description("Field metadata configuration")),
  get fields(): v.GenericSchema<Record<string, TailorFieldShape>> {
    return v.record(v.string(), TailorFieldSchema);
  },
});
