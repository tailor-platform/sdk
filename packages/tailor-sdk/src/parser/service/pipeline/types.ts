import type { z } from "zod";
import type {
  QueryTypeSchema,
  ResolverBodyOptionsSchema,
  ResolverSchema,
} from "./schema";

export type QueryType = z.infer<typeof QueryTypeSchema>;
export type ResolverBodyOptions = z.infer<typeof ResolverBodyOptionsSchema>;
export type ResolverInput = z.input<typeof ResolverSchema>;
export type Resolver = z.infer<typeof ResolverSchema>;
