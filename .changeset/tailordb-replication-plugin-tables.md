---
"@tailor-platform/sdk": minor
---

Replicate tables that plugins generate by listing them in a replication's `pluginTables`, keyed by table name, with the fields to copy as in `.replication()` (`{}` copies every field). Deploying (`tailor deploy` and `tailor tailordb migration test`) fails when a key names no table a plugin generates in the namespace.
