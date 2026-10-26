---
"@tailor-platform/sdk": patch
---

TailorDB namespaces that set the same `migration.directory` now fail with `MIGRATION_DIRECTORY_CONFLICT`, naming the namespaces and the shared directory, before any migration command or `tailor deploy` reads or writes migration files. Before, `migration generate` failed with a misleading "Possible rename(s) detected" error, and `migration generate --init` rebuilt the history of every namespace sharing the directory. Give each namespace its own `migration.directory`.
