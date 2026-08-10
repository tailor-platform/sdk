---
"@tailor-platform/sdk": patch
---

Fail `deploy` and `tailordb migration validate` when a migration has both a recorded `--no-script` acknowledgment and a `migrate.ts`, instead of warning and running the script against the committed record. The error names the two ways out: rerun `tailordb migration script <n>` to clear the stale acknowledgment (the script then runs on the next deploy), or delete `migrate.ts` to keep the skip.
