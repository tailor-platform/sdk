---
"@tailor-platform/sdk": minor
---

Add `tailor tailordb migration script --long-running` for data migrations that exceed the 60-second script execution limit.

A migration marked this way runs as a workflow job rather than a synchronous script execution, so it is no longer bound by that limit. `tailor deploy` waits for it and reports its logs as before. Migrations without the flag keep running exactly as they do today.
