---
"@tailor-platform/sdk": minor
---

Add `tailordb migration validate` command that runs the same schema checks as `deploy` without applying anything: migration file integrity (including required `migrate.ts` scripts), local types vs. the latest migration snapshot, and remote schema vs. the migration checkpoint. Issues are reported per namespace with type/field-level detail, `--json` emits a machine-readable report, and the command exits with a non-zero code when drift is found, making it usable as a CI safety gate before deploying.

As part of this, `deploy`'s remote schema verification now propagates migration state lookup failures instead of silently skipping verification; only a not-yet-deployed namespace is still treated as a first apply.
