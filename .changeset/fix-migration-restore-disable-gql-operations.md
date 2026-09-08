---
"@tailor-platform/sdk": patch
---

Harden `deploy`'s TailorDB migration restore step so it always sends a fully specified `disableGqlOperations` record when restoring a table's GraphQL operation restrictions, instead of relying on the platform response to populate every field.
