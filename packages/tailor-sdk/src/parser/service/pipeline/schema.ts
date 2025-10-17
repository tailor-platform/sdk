import { z } from "zod";

export const QueryTypeSchema = z.union([
  z.literal("query"),
  z.literal("mutation"),
]);

export const ResolverBodyOptionsSchema = z.object({
  dbNamespace: z.string().optional(),
});

const TailorTypeSchema = z.object({
  fields: z.record(z.string(), z.any()),
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
