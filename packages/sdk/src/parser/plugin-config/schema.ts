import * as v from "valibot";
import { functionSchema } from "#/parser/service/common";
import type { Plugin } from "#/plugin/types";

// Custom plugin schema (object form)
// Using looseObject() to preserve additional properties on Plugin instances
export const PluginConfigSchema = v.pipe(
  v.looseObject({
    id: v.string(),
    description: v.string(),
    importPath: v.optional(v.string()),
    pluginConfig: v.optional(v.unknown()),
    tableConfigRequired: v.optional(v.union([v.boolean(), functionSchema])),
    // Definition-time hooks
    onTableLoaded: v.optional(functionSchema),
    onNamespaceLoaded: v.optional(functionSchema),
    // Generation-time hooks
    onTailorDBReady: v.optional(functionSchema),
    onResolverReady: v.optional(functionSchema),
    onExecutorReady: v.optional(functionSchema),
  }),
  v.check((p) => {
    // importPath is required when plugin has definition-time hooks
    const hasDefineHooks = p.onTableLoaded || p.onNamespaceLoaded;
    return !hasDefineHooks || !!p.importPath;
  }, "importPath is required when plugin has definition-time hooks (onTableLoaded/onNamespaceLoaded)"),
  v.transform((plugin) => plugin as Plugin),
);
