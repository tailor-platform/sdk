import type * as sdk from "@tailor-platform/sdk";

export const plugin: sdk.Plugin = {
  id: "@example/audit-log",
  description: "Adds an audit log table",
  importPath: "@example/audit-log",
  onTailorDBNamespaceLoaded(context: sdk.TailorDBNamespaceLoadedContext): sdk.TailorDBNamespacePluginOutput {
    return { tables: {} };
  },
};
