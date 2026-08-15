---
"@tailor-platform/sdk": patch
"@tailor-platform/create-sdk": patch
---

The remaining docs and editor tooltips now describe a `db.table()` definition as a table instead of a type. The TailorDB docs say table-level (matching the sentences around them that already say table), the file-upload runtime API documents its `typeName` parameters as table names, and the create-sdk tailordb template's test titles follow suit.
