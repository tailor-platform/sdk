---
"@tailor-platform/sdk": patch
---

Fix `tailor deploy --no-schema-check` leaving a table removed from the local definitions without a migration until the next deploy when its namespace has pending migrations. The table is now deleted in the same deploy, after those migrations complete.
