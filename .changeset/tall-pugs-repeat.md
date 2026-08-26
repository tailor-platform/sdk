---
"@tailor-platform/sdk": minor
---

Run TailorDB migration scripts as workflow jobs so they are no longer bound by the 60-second script execution limit.

A data migration that previously failed with `deadline_exceeded` — losing its logs along with any record of how far it got — now runs to completion. `tailor deploy` waits for it and reports its logs as before. This applies to every migration; no flag or migration-file change is required.
