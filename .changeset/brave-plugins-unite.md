---
"@tailor-platform/sdk": minor
---

Unify Plugin and Generator systems with a simplified hook architecture. Definition-time hooks (`onTypeLoaded`, `onNamespaceLoaded`) generate TailorDB types, resolvers, and executors. Generation-time hooks (`onTailorDBReady`, `onResolverReady`, `onExecutorReady`) receive all finalized data at each pipeline phase and directly produce output files. `defineGenerators()` is deprecated in favor of `definePlugins()` with generation hooks. Builtin plugins are moved to dedicated entry points (`@tailor-platform/sdk/plugin/kysely-type`, `@tailor-platform/sdk/plugin/enum-constants`, `@tailor-platform/sdk/plugin/file-utils`, `@tailor-platform/sdk/plugin/seed`) to avoid bundling the CLI layer when importing plugins in `tailor.config.ts`. Deprecated re-exports remain in `@tailor-platform/sdk/cli` for backward compatibility.
