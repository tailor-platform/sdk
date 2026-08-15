---
"@tailor-platform/sdk": patch
---

Rename the plugin authoring APIs that model TailorDB tables:

- `PluginGeneratedType` → `PluginGeneratedTable`
- `TailorDBTypeForPlugin` → `TailorDBTableForPlugin`
- `TypePluginOutput` → `TablePluginOutput`
- `PluginProcessContext` → `PluginTableProcessContext`
- `typeConfigRequired` → `tableConfigRequired`
- `onTypeLoaded` → `onTableLoaded`
- callback context `type` / `typeConfig` → `table` / `tableConfig`
- plugin output `types` → `tables`
- `TailorDBNamespaceData.types` → `TailorDBNamespaceData.tables`
- executor context `sourceType` → `sourceTable`
- `getGeneratedType` → `getGeneratedTable`
- `PluginGeneratedTypeSource` → `PluginGeneratedTableSource`
- `isPluginGeneratedType` → `isPluginGeneratedTable`
- source metadata `generatedTypeKind` → `generatedTableKind`

Update custom plugins, generated-table lookups, and CLI source metadata consumers to use the new names. The generated `.tailor/<plugin-id>/types` directory and the TailorDB ERD artifact's `generatedTypeKind` field are unchanged.
