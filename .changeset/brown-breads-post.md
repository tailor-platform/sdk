---
"@tailor-platform/sdk": patch
---

`tailor deploy` now checks, while planning and so also with `--dry-run`, that each pending migration script can run: auth is configured, a machine user is available and defined in `auth.machineUsers`, and the script can be bundled. Previously these failures surfaced only after prerequisite resources were applied, and a missing machine user only after tables entered maintenance mode. A `migration.machineUser` not defined in `auth.machineUsers` is now rejected with `MACHINE_USER_NOT_FOUND` before the deploy instead of failing when the script starts, and a bundle failure that had no error code now reports `MIGRATION_SCRIPT_BUNDLE_FAILED` with the namespace and migration number. `tailor tailordb migration test --machine-user` now also runs the pending migration scripts as that machine user.
