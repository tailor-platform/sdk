---
"@tailor-platform/sdk": patch
---

Reject `.serial()` on fields inside `db.object()`. TailorDB cannot number a serial field nested in an object, so a create that omitted the value failed with an internal error. It is now a type error, and a build that still defines one fails; remove `.serial()` from the nested field (or move the field out of the object) to upgrade.
