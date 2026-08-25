import { z } from "zod";
import { functionSchema } from "#/parser/service/common";
import type { Plugin } from "#/plugin/types";

// Custom plugin schema (object form)
// Using passthrough() to preserve additional properties on Plugin instances
export const PluginConfigSchema = z
  .looseObject({
    id: z.string(),
    description: z.string(),
    importPath: z.string().optional(),
    pluginConfig: z.unknown().optional(),
    tableConfigRequired: z.union([z.boolean(), functionSchema]).optional(),
    // Definition-time hooks
    onTableLoaded: functionSchema.optional(),
    onNamespaceLoaded: functionSchema.optional(),
    // Generation-time hooks
    onTailorDBReady: functionSchema.optional(),
    onResolverReady: functionSchema.optional(),
    onExecutorReady: functionSchema.optional(),
  })
  .refine(
    (p) => {
      // importPath is required when plugin has definition-time hooks
      const hasDefineHooks = p.onTableLoaded || p.onNamespaceLoaded;
      return !hasDefineHooks || !!p.importPath;
    },
    {
      message:
        "importPath is required when plugin has definition-time hooks (onTableLoaded/onNamespaceLoaded)",
    },
  )
  .transform(
    (plugin) =>
      plugin as Plugin<
        unknown,
        unknown,
        // zinfer emits an unqualified, import-less reference for a named type
        // import used here, so this stays an inline import() type query so the
        // generated src/types/plugin-config.generated.ts resolves correctly.
        // oxlint-disable-next-line consistent-type-imports
        Record<string, import("#/configure/services/tailordb/types").TailorAnyDBField>
      >,
  );
