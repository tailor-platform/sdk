import { z } from "zod";
import { functionSchema } from "../common";

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

const DBFieldMetadataSchema = z.object({
  required: z.boolean().optional(),
  array: z.boolean().optional(),
  description: z.string().optional(),
  typeName: z.string().optional(),
  allowedValues: z.array(AllowedValueSchema).optional(),
  index: z.boolean().optional(),
  unique: z.boolean().optional(),
  vector: z.boolean().optional(),
  hooks: z
    .object({
      create: functionSchema.optional(),
      update: functionSchema.optional(),
    })
    .optional(),
  validate: z.array(z.unknown()).optional(),
  serial: z
    .object({
      start: z.number(),
      maxValue: z.number().optional(),
      format: z.string().optional(),
    })
    .optional(),
});

const TailorDBFieldSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: TailorFieldTypeSchema,
    fields: z.record(z.string(), TailorDBFieldSchema).optional(),
    _metadata: DBFieldMetadataSchema,
  }),
);

export const TailorDBTypeSchema = z.object({
  name: z.string(),
  fields: z.record(z.string(), TailorDBFieldSchema),
  metadata: z.object({
    name: z.string(),
    description: z.string().optional(),
    settings: z
      .object({
        pluralForm: z.string().optional(),
        aggregation: z.boolean().optional(),
        bulkUpsert: z.boolean().optional(),
      })
      .optional(),
    permissions: z.unknown(),
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
