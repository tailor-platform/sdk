---
"@tailor-platform/sdk": minor
---

Unify Plugin and Generator systems by adding generation-time hooks to the Plugin interface. Plugins now support both definition-time hooks (onTypeDefined, onNamespaceDefined) and generation-time hooks (onTypeLoaded, onTailorDBNamespaceLoaded, onResolverLoaded, onResolverNamespaceLoaded, onExecutorLoaded, generate) for producing output files. Existing processType/processNamespace hooks are renamed to onTypeDefined/onNamespaceDefined. defineGenerators() is deprecated in favor of definePlugins() with generation hooks. Builtin plugin wrappers (kyselyTypePlugin, enumConstantsPlugin, fileUtilsPlugin, seedPlugin) are exported from @tailor-platform/sdk/cli.
