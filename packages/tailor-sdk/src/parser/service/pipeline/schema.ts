import { z } from "zod";

export const TailorFieldTypeSchema = z.enum([
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

export const QueryTypeSchema = z.union([
  z.literal("query"),
  z.literal("mutation"),
]);

export const ResolverBodyOptionsSchema = z.object({
  dbNamespace: z.string().optional(),
});

export const AllowedValueSchema = z.object({
  value: z.string(),
  description: z.string().optional(),
});

export const FieldMetadataSchema = z.object({
  required: z.boolean().optional(),
  array: z.boolean().optional(),
  description: z.string().optional(),
  allowedValues: z.array(AllowedValueSchema).optional(),
  assertNonNull: z.boolean().optional(),
});

export const TailorFieldSchema = z.object({
  type: TailorFieldTypeSchema,
  metadata: FieldMetadataSchema,
  get fields() {
    return z.record(z.string(), TailorFieldSchema);
  },
});

export const TailorTypeSchema = z.object({
  fields: z.record(z.string(), TailorFieldSchema),
});

export const ResolverSchema = z.object({
  operation: QueryTypeSchema,
  name: z.string(),
  description: z.string().optional(),
  input: TailorTypeSchema.optional(),
  options: ResolverBodyOptionsSchema.optional(),
  body: z.function(),
  output: TailorTypeSchema,
});
