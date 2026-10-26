---
"@tailor-platform/sdk": minor
---

`tailor tailordb migration generate --init` now accepts `--namespace <name>` to reset only that namespace's `migrations/` directory and recreate its `0000`. Other namespaces' migration files are left untouched, and the confirmation lists only the target namespace. Without `--namespace`, `--init` still deletes the migrations of every namespace that has migrations configured.
