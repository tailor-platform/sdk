import { z } from "zod";
import { functionSchema } from "#/parser/service/common";
import {
  BOTH_TAILORDB_NAMESPACE_HOOKS_MESSAGE,
  DEFINITION_TIME_HOOK_KEYS,
  definesBothTailorDBNamespaceHooks,
  hasDefinitionTimeHooks,
} from "./definition-hooks";
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
    onTailorDBNamespaceLoaded: functionSchema.optional(),
    onNamespaceLoaded: functionSchema.optional(),
    // Generation-time hooks
    onTailorDBReady: functionSchema.optional(),
    onResolverReady: functionSchema.optional(),
    onExecutorReady: functionSchema.optional(),
    onDeployed: functionSchema.optional(),
  })
  .refine((p) => !hasDefinitionTimeHooks(p) || !!p.importPath, {
    message: `importPath is required when plugin has definition-time hooks (${DEFINITION_TIME_HOOK_KEYS.join("/")})`,
  })
  .refine((p) => !definesBothTailorDBNamespaceHooks(p), {
    message: BOTH_TAILORDB_NAMESPACE_HOOKS_MESSAGE,
    path: ["onNamespaceLoaded"],
  })
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
