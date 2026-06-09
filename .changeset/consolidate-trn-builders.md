---
"@tailor-platform/sdk": patch
---

Internal refactoring: consolidate the per-resource TRN builder functions and inline `${trnPrefix(...)}:<kind>:<name>` template literals scattered across the deploy commands into a single typed `resourceTrn(workspaceId, kind, name)` helper. No user-facing behavior change.
