---
"@tailor-platform/sdk": patch
---

`tailor tailordb migration generate` no longer writes a `10000` migration directory, which no command reads, after a namespace reaches migration 9999. Before writing, it now checks that every namespace has enough migration numbers left, including with `--data-only` and for a field type conversion, which needs two. If any namespace does not, it fails with `MIGRATION_NUMBER_EXHAUSTED` without writing a migration in any namespace, and the error names the `tailor tailordb migration rebaseline` command to run.
