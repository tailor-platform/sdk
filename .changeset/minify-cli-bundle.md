---
"@tailor-platform/sdk": patch
---

Minify the SDK's build output (function names are preserved for readable stack traces), shrinking the CLI bundle by roughly 40%. Pin the script expression generated for `db.fields.timestamps()`'s built-in `updatedAt` hook so it no longer changes across SDK builds, which previously could surface as a spurious "hooks modified" migration diff for every table using it.
