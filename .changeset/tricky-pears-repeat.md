---
"@tailor-platform/sdk": minor
---

Add `tailor tailordb migration generate --data-only` to create a migration with no schema changes that exists to run a data transformation script. The entry ships an empty diff, a `migrate.ts` skeleton, and `db.ts` typed against the current schema, and deploys like any other migration script. Use `--namespace` to pick the target namespace when the project configures more than one.
