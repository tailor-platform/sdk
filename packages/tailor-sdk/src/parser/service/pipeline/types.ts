import type { z } from "zod";
import type {
  AllowedValueSchema,
  FieldMetadataSchema,
  QueryTypeSchema,
  ResolverBodyOptionsSchema,
  ResolverSchema,
  TailorFieldSchema,
  TailorFieldTypeSchema,
  TailorTypeSchema,
} from "./schema";

export type TailorFieldType = z.output<typeof TailorFieldTypeSchema>;
export type AllowedValue = z.output<typeof AllowedValueSchema>;
export type FieldMetadata = z.output<typeof FieldMetadataSchema>;
export type TailorField = z.output<typeof TailorFieldSchema>;
export type TailorFieldInput = z.input<typeof TailorFieldSchema>;
export type TailorType = z.output<typeof TailorTypeSchema>;
export type TailorTypeInput = z.input<typeof TailorTypeSchema>;
export type QueryType = z.output<typeof QueryTypeSchema>;
export type ResolverBodyOptions = z.output<typeof ResolverBodyOptionsSchema>;
export type ResolverInput = z.input<typeof ResolverSchema>;
export type Resolver = z.output<typeof ResolverSchema>;
