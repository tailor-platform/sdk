import { z } from "zod";
import type { GqlOperationsConfig, GqlOperations } from "./types";

/**
 * Normalize GqlOperationsConfig (alias or object) to GqlOperations object.
 * "query" alias expands to read-only mode: { create: false, update: false, delete: false, read: true }
 * @param config - The GqlOperationsConfig to normalize
 * @returns The normalized GqlOperations object
 */
function normalizeGqlOperations(config: GqlOperationsConfig): GqlOperations {
  if (config === "query") {
    return { create: false, update: false, delete: false, read: true };
  }
  return config;
}

/**
 * Zod schema for GqlOperations configuration with normalization transform.
 * Accepts "query" alias or detailed object, normalizes to GqlOperations object.
 */
export const GqlOperationsSchema = z
  .union([
    z.literal("query"),
    z.object({
      create: z.boolean().optional(),
      update: z.boolean().optional(),
      delete: z.boolean().optional(),
      read: z.boolean().optional(),
    }),
  ])
  .transform((val) => normalizeGqlOperations(val));
