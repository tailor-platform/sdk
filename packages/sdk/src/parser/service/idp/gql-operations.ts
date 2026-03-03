import { z } from "zod";
import type { IdPGqlOperationsConfig, IdPGqlOperations } from "./types";

/**
 * Normalize IdPGqlOperationsConfig (alias or object) to IdPGqlOperations object.
 * "query" alias expands to read-only mode: { create: false, update: false, delete: false, read: true, sendPasswordResetEmail: false }
 * @param config - The IdPGqlOperationsConfig to normalize
 * @returns The normalized IdPGqlOperations object
 */
function normalizeIdPGqlOperations(config: IdPGqlOperationsConfig): IdPGqlOperations {
  if (config === "query") {
    return {
      create: false,
      update: false,
      delete: false,
      read: true,
      sendPasswordResetEmail: false,
    };
  }
  return config;
}

/**
 * Zod schema for IdPGqlOperations configuration with normalization transform.
 * Accepts "query" alias or detailed object, normalizes to IdPGqlOperations object.
 */
export const IdPGqlOperationsSchema = z
  .union([
    z.literal("query"),
    z.object({
      create: z.boolean().optional(),
      update: z.boolean().optional(),
      delete: z.boolean().optional(),
      read: z.boolean().optional(),
      sendPasswordResetEmail: z.boolean().optional(),
    }),
  ])
  .transform((val) => normalizeIdPGqlOperations(val));
