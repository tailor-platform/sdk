---
"@tailor-platform/sdk": patch
---

Resolve tsconfig `paths` aliases against each importing file's own project when bundling resolvers, executors, workflows, auth hooks, HTTP adapters, TailorDB hooks and validators, functions, seeds, queries, and migration scripts. A local dependency belonging to a different TypeScript project previously used the bundle entry's aliases instead of the dependency's nearest tsconfig. Aliases only fill in where an import does not already resolve, so a real package still wins over a `paths` pattern that would otherwise match it.
