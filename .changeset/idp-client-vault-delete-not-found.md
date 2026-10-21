---
"@tailor-platform/sdk": patch
---

`tailor deploy` and `tailor remove` no longer fail when deleting an IdP client whose Secret Manager vault (`idp-<namespace>-<client>`) has already been deleted.
