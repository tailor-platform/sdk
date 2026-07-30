---
"@tailor-platform/sdk": patch
---

Use each importing file's nearest tsconfig `paths` aliases as a fallback when bundling resolvers, executors, workflows, auth hooks, HTTP adapters, TailorDB hooks and validators, functions, seeds, queries, and migration scripts. A local dependency belonging to a different TypeScript project could previously leave an import unresolved when the bundle entry's project could not resolve it. Normal bundle resolution still takes precedence, so the importing file's aliases apply only when the import would otherwise be unresolved.
