---
"@tailor-platform/sdk": minor
---

Choose how `tailor deploy` replicates tables that plugins generate with a TailorDB namespace's `pluginTables` config, keyed by table name: a table's `replication` takes the same entries as `.replication()` and replaces what the plugin sets, and `false` leaves the table out.
