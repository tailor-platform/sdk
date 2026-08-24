---
"@tailor-platform/sdk": major
---

Generate `Date`-based migration types for `date` columns, matching the values returned by the function runtime and the existing generated table types. Reading a `date` column in `migrate.ts` now yields a `Date` instead of a `string`, while writes accept either. Migration scripts can also read and write `date` and `datetime` array columns. Existing migration scripts that treat selected `date` values as strings must be updated.
