---
"@tailor-platform/sdk": minor
---

Add TypeConfig/PluginConfig type parameters to Plugin interface and remove TailorField schema requirements

- Add `Plugin<TypeConfig, PluginConfig>` type parameters for type-safe arbitrary config
- Remove `configSchema`, `pluginConfigSchema`, and `configTypeTemplate` properties from Plugin interface
- Merge `PluginWithConfig`/`PluginNamespaceOnly` into a single `Plugin` interface
- Wire TypeConfig/PluginConfig through `processType`/`processNamespace` contexts
- Remove TailorField-based runtime validation from plugin config processing
- Introduce `TypePluginOutput` for processType (extends `PluginOutput` with `extends` field)
- Make `PluginOutput` the base type without `extends` (used by processNamespace)
- Use `TailorAnyDBField` for `PluginExtends.fields` type
