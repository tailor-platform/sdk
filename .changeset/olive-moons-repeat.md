---
"@tailor-platform/sdk": patch
---

Fix `seed apply --upsert` rejecting rows that omit fields the platform fills in on create, such as the `createdAt` / `updatedAt` fields from `db.fields.timestamps()` or any field declared with `.default()`
