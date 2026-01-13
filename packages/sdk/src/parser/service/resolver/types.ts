import type { QueryTypeSchema, ResolverSchema, TailorFieldSchema } from "./schema";
import type { z } from "zod";

export type TailorField = z.output<typeof TailorFieldSchema>;
export type TailorFieldInput = z.input<typeof TailorFieldSchema>;
export type QueryType = z.output<typeof QueryTypeSchema>;
export type ResolverInput = z.input<typeof ResolverSchema>;
export type Resolver = z.output<typeof ResolverSchema>;
