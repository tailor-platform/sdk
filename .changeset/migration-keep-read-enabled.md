---
"@tailor-platform/sdk": patch
---

Stop disabling the GraphQL `read` operation of a table while `tailor deploy` applies a TailorDB migration in maintenance mode. Create, update, delete, and bulk upsert are still disabled and record events are still not published. `read` keeps the table's live setting when the restrictions begin, and a table that a migration touches then follows that migration's schema, so a migration that changes `read` changes it before its script runs
