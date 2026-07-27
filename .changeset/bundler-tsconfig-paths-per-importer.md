---
"@tailor-platform/sdk": patch
---

Resolve tsconfig `paths` aliases against each importing file's own project when bundling resolvers, executors, workflows, auth hooks, HTTP adapters, TailorDB hooks and validators, functions, seeds, queries, and migration scripts. A nested `tsconfig.json` that declares no `paths` of its own previously shadowed the aliases declared in the project root, so an alias that worked when running the file directly failed to resolve at bundle time. Aliases only fill in where an import does not already resolve, so a real package still wins over a `paths` pattern that would otherwise match it.
