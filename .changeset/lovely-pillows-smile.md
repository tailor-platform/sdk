---
"@tailor-platform/sdk": minor
---

**Breaking change**: Remove `relation` and `as` from the type of a TailorDB field's `metadata`. The SDK never set either key on a TailorDB field, so reading them always returned `undefined`; delete any code that reads them
