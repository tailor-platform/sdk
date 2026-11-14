---
"@tailor-platform/sdk": patch
---

Fix `getExtendedTable` and `getGeneratedTable` for a table with `.plugin()` that is imported under a URL with a query string, as the generated seed schema files are when `tailor seed studio` loads them: `getExtendedTable` failed with `Could not resolve namespace for table`, and `getGeneratedTable` returned the table generated from an earlier definition after the source table was imported again.
