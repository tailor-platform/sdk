---
"@tailor-platform/sdk": minor
---

Add dependencies-based execution order for generators

- Generators now declare their dependencies (`tailordb`, `resolver`, `executor`)
- Execution order is phased: TailorDB → Auth → TailorDB-only generators → Resolver → non-executor generators → Executor → executor-dependent generators
- This allows generated files to be imported by Resolvers and Executors
- Added utility types for aggregate input: `TailorDBInput`, `ResolverInput`, `ExecutorInput`, `FullInput`, `AggregateArgs`
- Fixed console output formatting with proper blank line placement
