---
"@tailor-platform/sdk": minor
---

Auto-enable `publishUserEvents` on IdP services when the project defines executors with `idpUser` triggers (`idpUserCreatedTrigger`, `idpUserUpdatedTrigger`, `idpUserDeletedTrigger`, or `idpUserTrigger`). Previously, omitting `publishUserEvents` defaulted to `false`, silently preventing those executors from firing. The SDK now auto-configures `publishUserEvents: true` for every IdP in the project when any executor uses an `idpUser` trigger, and warns if an IdP explicitly sets `publishUserEvents: false` while such executors are present. Set `publishUserEvents: false` explicitly to opt out.
