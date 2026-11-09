---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": minor
---

The plugin hook `onNamespaceLoaded` is renamed to `onTailorDBNamespaceLoaded`, which says that it runs once for each TailorDB namespace in the config (except external ones). Its context and output types are renamed to `TailorDBNamespaceLoadedContext` and `TailorDBNamespacePluginOutput`.

`onNamespaceLoaded`, `PluginNamespaceProcessContext`, and `NamespacePluginOutput` are deprecated and will be removed in v3; plugins that use them keep working until then. A plugin that defines both `onNamespaceLoaded` and `onTailorDBNamespaceLoaded` is rejected when the config loads. `tailor upgrade` runs the `v3/tailordb-namespace-loaded-rename` codemod, which renames the hook and the two types.

```ts
export const auditLogPlugin: Plugin = {
  id: "@example/audit-log",
  description: "Adds an audit log table",
  importPath: "@example/audit-log",
  onTailorDBNamespaceLoaded({ namespace }) {
    return { tables: { auditLog: db.table(`AuditLog_${namespace}`, { message: db.string() }) } };
  },
};
```
