import { z } from "zod";
import { functionSchema } from "#src/parser/service/common";
import type { Plugin } from "#src/plugin/types";

// Custom plugin schema (object form)
// Using passthrough() to preserve additional properties on Plugin instances
export const PluginConfigSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    importPath: z.string().optional(),
    pluginConfig: z.unknown().optional(),
    typeConfigRequired: z.union([z.boolean(), functionSchema]).optional(),
    // Definition-time hooks
    onTypeLoaded: functionSchema.optional(),
    onNamespaceLoaded: functionSchema.optional(),
    // Generation-time hooks
    onTailorDBReady: functionSchema.optional(),
    onResolverReady: functionSchema.optional(),
    onExecutorReady: functionSchema.optional(),
  })
  .passthrough()
  .refine(
    (p) => {
      // importPath is required when plugin has definition-time hooks
      const hasDefineHooks = p.onTypeLoaded || p.onNamespaceLoaded;
      return !hasDefineHooks || !!p.importPath;
    },
    {
      message:
        "importPath is required when plugin has definition-time hooks (onTypeLoaded/onNamespaceLoaded)",
    },
  )
  .transform((plugin) => plugin as Plugin);
