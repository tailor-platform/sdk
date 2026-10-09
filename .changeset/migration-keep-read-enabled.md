---
"@tailor-platform/sdk": patch
---

Keep the GraphQL `read` operation of a table as it is while `tailor deploy` applies a TailorDB migration, instead of disabling it: create, update, delete, and bulk upsert are still disabled and record events are still not published, but a table that can be read before the migration can still be read during it
