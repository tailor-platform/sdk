---
"@tailor-platform/sdk": patch
---

Fix generated Kysely types importing `ObjectColumnType` / `ArrayColumnType` they never use when an enum allowed value contains the wrapper name
