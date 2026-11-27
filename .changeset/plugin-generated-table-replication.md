---
"@tailor-platform/sdk": minor
---

**Breaking change (beta)**: A plugin can no longer call `.replication()` on a table it generates. Every command that loads TailorDB tables, such as `tailor generate`, `tailor deploy`, `tailor seed`, `tailor tailordb erd`, and `tailor remove`, fails with `PLUGIN_TABLE_INVALID` for such a plugin, even in a namespace without replications. To keep replicating the table, update the plugin and, in the same deploy, list the table in the `pluginTables` of each replication that copies it, with the `excludeFields` or `includeFields` the plugin passed to `.replication()`; a deploy that removes the table from a replication stops writing its BigQuery table and keeps the data already there.
