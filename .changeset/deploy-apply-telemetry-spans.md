---
"@tailor-platform/sdk": minor
---

Trace each service's apply step and each TailorDB migration phase when OTLP tracing is enabled. `deploy` now emits `apply.<service>.createUpdate` spans under `apply.createUpdateServices` and `apply.createUpdateDependentServices`, plus `apply.tailorDB.migration.{prePhase,script,postPhase}` per pending migration, so a slow deploy can be attributed to a service or to a migration script rather than to a whole phase.
