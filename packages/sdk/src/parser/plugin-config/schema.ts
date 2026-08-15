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
    typeConfigRequired: v.optional(v.union([v.boolean(), functionSchema])),
    // Definition-time hooks
    onTypeLoaded: v.optional(functionSchema),
    onNamespaceLoaded: v.optional(functionSchema),
    // Generation-time hooks
    onTailorDBReady: v.optional(functionSchema),
    onResolverReady: v.optional(functionSchema),
    onExecutorReady: v.optional(functionSchema),
  }),
  v.check((p) => {
    // importPath is required when plugin has definition-time hooks
    const hasDefineHooks = p.onTypeLoaded || p.onNamespaceLoaded;
    return !hasDefineHooks || !!p.importPath;
  }, "importPath is required when plugin has definition-time hooks (onTypeLoaded/onNamespaceLoaded)"),
  v.transform((plugin) => plugin as Plugin),
);
