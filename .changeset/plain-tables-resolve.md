---
"@tailor-platform/sdk": patch
---

Fix `getExtendedTable` failing with `Could not resolve namespace for table` for a table with `.plugin()` that is imported under a URL with a query string, as the generated seed schema files are when `tailor seed studio` loads them.
