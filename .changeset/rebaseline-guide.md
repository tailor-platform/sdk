---
"@tailor-platform/sdk": patch
---

Diagnose the "Remote migration checkpoint is not in the local migration history" error from `deploy` and `tailordb migration validate` when its specific cause is an environment that fell behind before a `migration rebaseline` ran on another environment: the message now names the migration this environment must reach and points at a concrete recovery procedure (restore the pre-rebaseline `migrations/` directory from git history, deploy against it up to that migration, then switch back and deploy again). Documented the same error and recovery procedure in the migrations troubleshooting guide.
