---
"@tailor-platform/sdk": patch
---

Stop saying that removed fields lose their data in the `tailor tailordb migration resolve --rollback` warning and in the suggestions from `tailor deploy` and `tailor tailordb migration validate` (namespace without a migration checkpoint) and `tailor tailordb migration rebaseline` (workspace tables that differ from the latest migration). They now say the fields are removed and only the deleted tables lose their data. The TailorDB migration guide also notes that a field removed by `tailor tailordb migration sync` may come back with its earlier values when a migration adds it again.
