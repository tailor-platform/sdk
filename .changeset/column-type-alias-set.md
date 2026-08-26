---
"@tailor-platform/sdk": patch
---

Keep the generated Kysely table types and migration types in agreement on which array columns need `ArrayColumnType`, so a future column type cannot pick up an array form that Kysely can read through in one and not the other.
