---
"@tailor-platform/sdk": patch
---

Fix generated Kysely types for `db.date()` fields to use `Timestamp` instead of `string`, matching `db.datetime()` and allowing `insertInto`/`updateTable` calls to accept a `Date` value.
