---
"@tailor-platform/sdk": patch
---

Fix `db.fields.timestamps()` to respect user-specified `createdAt` / `updatedAt` values instead of always overwriting them with the current time. When a value is provided (e.g. seeding historical records), it is now used; when omitted, the current time is still applied as before.
