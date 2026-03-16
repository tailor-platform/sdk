---
"@tailor-platform/sdk": patch
---

fix: use `@tailor-platform/sdk/kysely` re-export in seed bundler instead of importing `kysely` directly, so seed works without users installing kysely as a direct dependency
