---
"@tailor-platform/sdk": minor
---

Trace each service's apply step and each TailorDB migration phase when OTLP tracing is enabled. `deploy` now emits `apply.<service>.createUpdate` spans under `apply.createUpdateServices` and `apply.createUpdateDependentServices`, plus `apply.tailorDB.migration.prePhase` and `.postPhase` per pending migration and `.script` for each migration that carries a `migrate.ts`, so a slow deploy can be attributed to a service or to a migration script rather than to a whole phase.
