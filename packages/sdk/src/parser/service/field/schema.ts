import { z } from "zod";
import { functionSchema } from "../common";

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

const AllowedValueSchema = /* strip unknown keys */ z.object({
  value: z.string().describe("The allowed value"),
  description: z.string().optional().describe("Description of the allowed value"),
});

const FieldMetadataSchema = /* strip unknown keys */ z.object({
  required: z.boolean().optional().describe("Whether the field is required"),
  array: z.boolean().optional().describe("Whether the field is an array"),
  description: z.string().optional().describe("Field description"),
  allowedValues: z.array(AllowedValueSchema).optional().describe("Allowed values for enum fields"),
  hooks: /* strip unknown keys */ z
    .object({
      create: functionSchema.optional().describe("Hook function called on creation"),
      update: functionSchema.optional().describe("Hook function called on update"),
    })
    .optional()
    .describe("Lifecycle hooks"),
  typeName: z.string().optional().describe("Type name for nested or enum fields"),
});

export const TailorFieldSchema = /* strip unknown keys */ z.object({
  type: TailorFieldTypeSchema.describe("Field data type"),
  metadata: FieldMetadataSchema.describe("Field metadata configuration"),
  get fields() {
    return z.record(z.string(), TailorFieldSchema);
  },
});
