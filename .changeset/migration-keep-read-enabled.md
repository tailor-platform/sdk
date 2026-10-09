---
"@tailor-platform/sdk": patch
---

Stop disabling the GraphQL `read` operation of a table while `tailor deploy` applies a TailorDB migration. Create, update, delete, and bulk upsert are still disabled and record events are still not published. `read` keeps the table's live setting when the restrictions begin, and then follows the schema of each migration, so a migration that changes `read` changes it before its script runs
