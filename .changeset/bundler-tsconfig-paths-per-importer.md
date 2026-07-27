---
"@tailor-platform/sdk": patch
---

Resolve tsconfig `paths` aliases against each importing file's own project when bundling resolvers, executors, workflows, auth hooks, HTTP adapters, TailorDB hooks, functions, seeds, queries, and migration scripts. A `tsconfig.json` nested nearer to an imported file previously shadowed the aliases declared in the project root, so an alias that worked when running the file directly failed to resolve at bundle time.
