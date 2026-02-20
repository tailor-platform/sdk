import { z } from "zod";
import { functionSchema } from "@/parser/service/common";
import type { Plugin } from "./types";

// Custom plugin schema (object form)
// Using passthrough() to preserve additional properties on Plugin instances
const CustomPluginSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    importPath: z.string(),
    pluginConfig: z.unknown().optional(),
    processType: functionSchema.optional(),
    processNamespace: functionSchema.optional(),
    typeConfigRequired: z.union([z.boolean(), functionSchema]).optional(),
  })
  .passthrough();

/**
 * Creates a PluginConfigSchema for custom plugins
 * @returns Plugin config schema that validates and transforms Plugin instances
 */
export function createPluginConfigSchema() {
  return CustomPluginSchema.transform((plugin) => plugin as Plugin);
}
