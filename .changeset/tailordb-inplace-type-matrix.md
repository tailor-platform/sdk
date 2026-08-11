---
"@tailor-platform/sdk": minor
---

Support more TailorDB field type changes as single in-place migrations. `string` now converts to `integer`, `float`, `decimal`, `boolean`, and `uuid`; `integer` to `string`, `decimal`, and `boolean`; `float` to `string` and `decimal`; `decimal` to `float`; and `boolean` to `string`. Date, datetime, and time conversions remain on the 3-step migration path because their stored values do not round-trip through another type.
