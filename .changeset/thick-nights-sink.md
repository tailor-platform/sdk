---
"@tailor-platform/sdk": minor
---

`tailor query` takes `--namespace` to run a SQL query in that TailorDB namespace without inferring it from the tables the query names, and `--app` to name the application a GraphQL query runs against; `query()` takes `namespace` and `app` the same way. `tailor tailordb truncate` and `truncate()` accept a namespace together with table names, to look the tables up in that namespace only. When several namespaces have a table of the name given (compared with the same case, or ignoring case when no namespace has it with the same case), `tailor query` and `tailor tailordb truncate` now stop with `TAILORDB_TABLE_NAMESPACE_AMBIGUOUS` instead of using the first namespace that has it.
