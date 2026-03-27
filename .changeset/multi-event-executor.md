---
"@tailor-platform/sdk": minor
---

Add multi-event executor trigger support with `recordTrigger`, `idpUserTrigger`, and `authAccessTokenTrigger` factory functions that accept an `events` array to handle multiple event types in a single executor. Args include `event` (short name) and `rawEvent` (full event type string) for runtime type narrowing.
