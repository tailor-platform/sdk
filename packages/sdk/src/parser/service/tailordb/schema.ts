import { z } from "zod";
import { functionSchema } from "../common";
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
  validate: z.array(z.unknown()).optional(),
  serial: z
    .object({
      start: z.number(),
      maxValue: z.number().optional(),
      format: z.string().optional(),
    })
    .optional(),
});

const RelationTypeSchema = z.enum(["1-1", "oneToOne", "n-1", "manyToOne", "N-1", "keyOnly"]);

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

export const TailorDBTypeSchema = z.object({
  name: z.string(),
  fields: z.record(z.string(), TailorDBFieldSchema),
  metadata: z.object({
    name: z.string(),
    description: z.string().optional(),
    settings: z.unknown().optional(),
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
