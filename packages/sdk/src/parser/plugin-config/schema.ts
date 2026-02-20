import { z } from "zod";
import { functionSchema } from "@/parser/service/common";
import type { Plugin } from "./types";

// Custom plugin schema (object form)
// Using passthrough() to preserve additional properties on Plugin instances
const CustomPluginSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    importPath: z.string().optional(),
    pluginConfig: z.unknown().optional(),
    typeConfigRequired: z.union([z.boolean(), functionSchema]).optional(),
    // Definition-time hooks
    onTypeDefine: functionSchema.optional(),
    onNamespaceDefine: functionSchema.optional(),
    // Generation-time hooks
    onTypeLoaded: functionSchema.optional(),
    onTailorDBNamespaceLoaded: functionSchema.optional(),
    onResolverLoaded: functionSchema.optional(),
    onResolverNamespaceLoaded: functionSchema.optional(),
    onExecutorLoaded: functionSchema.optional(),
    generate: functionSchema.optional(),
  })
  .passthrough()
  .refine(
    (p) => {
      // importPath is required when plugin has definition-time hooks
      const hasDefineHooks = p.onTypeDefine || p.onNamespaceDefine;
      return !hasDefineHooks || !!p.importPath;
    },
    {
      message:
        "importPath is required when plugin has definition-time hooks (onTypeDefine/onNamespaceDefine)",
    },
  );

/**
 * Creates a PluginConfigSchema for custom plugins
 * @returns Plugin config schema that validates and transforms Plugin instances
 */
export function createPluginConfigSchema() {
  return CustomPluginSchema.transform((plugin) => plugin as unknown as Plugin).brand("Plugin");
}
