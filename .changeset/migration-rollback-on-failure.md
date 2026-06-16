---
"@tailor-platform/sdk": patch
---

Roll back a migration's pre-migration schema changes when its data migration (`migrate.ts`) fails during `apply`. A failed migration now leaves the workspace at its prior checkpoint and prior schema instead of half-applied, so subsequent deploys are no longer blocked by opaque "Remote schema drift detected" errors.
