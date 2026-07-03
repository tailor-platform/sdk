---
"@tailor-platform/sdk": patch
---

Fix TailorDB relations silently dropping a forward relationship when two fields on the same type default to the same forward name; this now throws a validation error instead, matching the existing behavior for duplicate backward relationship names
