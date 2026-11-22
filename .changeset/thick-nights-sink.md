---
"@tailor-platform/sdk": minor
---

The `tailor query` command takes `--namespace` to run a SQL query in that TailorDB namespace without inferring it from the tables the query names, and `tailor tailordb truncate` accepts `--namespace` together with table names to look the tables up in that namespace only. When a table name is found in several namespaces, both now stop with `TAILORDB_TABLE_NAMESPACE_AMBIGUOUS` instead of using the first namespace that has it.
