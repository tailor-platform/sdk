---
"@tailor-platform/sdk": patch
---

Fix seed and query bundlers to use `@tailor-platform/sdk/kysely` re-export instead of importing `kysely` and `@tailor-platform/function-kysely-tailordb` directly, so they work without users installing these as direct dependencies
