---
"@tailor-platform/sdk": minor
---

Support more TailorDB field type changes as single in-place migrations: `integer` now converts to `string` and `decimal`, `float` to `string` and `decimal`, `decimal` to `float`, and `boolean` to `string`. A field that is already unique keeps to the 3-step migration when converting to `decimal`, because rounding to the target scale can merge distinct values.
