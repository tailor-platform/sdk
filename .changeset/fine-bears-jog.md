---
"@tailor-platform/sdk": patch
---

`tailor deploy` now prints the pending-migration summary and the other notices about the migration state (a checkpoint reset, tables left to delete, a migration to run again, a skipped script, ignored `steps`) once, before the plan, instead of repeating them after the confirmation. When the pending migrations change after the plan, for example because another deploy applied one, the deploy now stops with `DEPLOY_PLAN_STALE` instead of applying a different set than the one it showed.
