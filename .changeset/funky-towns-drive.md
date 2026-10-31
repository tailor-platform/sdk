---
"@tailor-platform/sdk": patch
---

The recovery commands that `tailor deploy` and the `tailor tailordb migration` commands suggest for a migration now target the workspace the run used. A suggested `tailor tailordb migration status`, `sync`, `set`, or `resolve` command keeps the run's `--config`, `--workspace-id`, and `--profile`, and for `deploy` also its `--env-file` or `--env-file-if-exists`; a suggested `tailor workflow executions` command keeps the same options except `--config`. Previously these suggestions dropped them, so running one as shown could target the workspace of the shell environment instead, and `sync` could rewrite the tables there.
