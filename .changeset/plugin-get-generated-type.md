---
"@tailor-platform/sdk": minor
---

Add getGeneratedType helper function for plugin-generated types

- Add `getGeneratedType(plugin, sourceType, kind)` function to retrieve plugin-generated types
- Support both type-attached plugins (with sourceType) and namespace plugins (sourceType is null)
- Simplify `PluginNamespaceProcessContext` by removing `types` and `generatedTypes` parameters
- Results are cached per plugin and sourceType to avoid redundant processing
