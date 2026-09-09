---
"@tailor-platform/sdk": patch
---

Upgraded the internal `zinfer` tool used to generate this package's TypeScript types from Zod schemas, fixing a case where a type reached only through another file's generated declaration (e.g. `Resolver.output`, `Resolver.input`) collapsed to `any` in the generated output instead of resolving to the real type (e.g. `TailorField`). Structurally identical `*Input` types are now aliased to their base type instead of duplicating the same fields, with no change to runtime behavior.
