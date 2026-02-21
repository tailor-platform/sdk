---
"@tailor-platform/sdk": minor
---

Unify Plugin and Generator systems with a simplified hook architecture. Definition-time hooks (`onTypeLoaded`, `onNamespaceLoaded`) generate TailorDB types, resolvers, and executors. Generation-time hooks (`onTailorDBReady`, `onResolverReady`, `onExecutorReady`) receive all finalized data at each pipeline phase and directly produce output files. `defineGenerators()` is deprecated in favor of `definePlugins()` with generation hooks. Builtin plugin wrappers (`kyselyTypePlugin`, `enumConstantsPlugin`, `fileUtilsPlugin`, `seedPlugin`) are exported from `@tailor-platform/sdk/cli`.
