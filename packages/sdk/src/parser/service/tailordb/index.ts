export { stringifyFunction, tailorUserMap } from "./field";
export { parseTypes, type TypeSourceInfo } from "./type-parser";
export { TailorDBTypeSchema } from "./schema";
export type * from "./types";

import type { GqlOperationsConfig, GqlOperations } from "./types";

/**
 * Normalize GqlOperationsConfig (alias or object) to GqlOperations object.
 * "query" alias expands to read-only mode: { create: false, update: false, delete: false, read: true }
 * @param config - The GqlOperationsConfig to normalize
 * @returns The normalized GqlOperations object
 */
export function normalizeGqlOperations(config: GqlOperationsConfig): GqlOperations {
  if (config === "query") {
    return { create: false, update: false, delete: false, read: true };
  }
  return config;
}
