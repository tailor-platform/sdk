---
"@tailor-platform/sdk": patch
---

Add getGeneratedType helper function for plugin-generated types

- Add async `getGeneratedType(configPath, pluginId, sourceType, kind)` function to retrieve plugin-generated types
- Auto-resolve namespace and pluginConfig from tailor.config.ts
- Support both type-attached plugins (with sourceType) and namespace plugins (sourceType is null)
- Rename `process` to `processType` and `config` to `typeConfig` in plugin context
- Simplify `PluginNamespaceProcessContext` by removing `types` and `generatedTypes` parameters
- Results are cached per config path, plugin, namespace, and pluginConfig
